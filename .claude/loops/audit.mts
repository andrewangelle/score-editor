#!/usr/bin/env -S npx tsx
/**
 * Lean plan audit/fix convergence loop (Claude Agent SDK, TypeScript).
 *
 * Repeatedly audits an implementation plan against the actual repo, fixes any
 * evidence-backed holes, and stops when the audit passes twice in a row.
 *
 * Setup (once):
 *   npm i -D @anthropic-ai/claude-agent-sdk tsx
 *   package.json:  "scripts": { "audit-plan": "tsx .claude/loops/audit.ts" }
 *
 * Run:
 *   npm run audit-plan -- virtualized-page-scroll --paths "src/auth src/db"
 *   npm run audit-plan -- .claude/plans/foo.md --run-tests "npm test"
 *
 * PLAN is a file path, or a plan name looked up in .claude/plans/ (with or
 * without .md). The agents always run from the repo root, wherever you call from.
 *
 * Output is color-coded when printed to a terminal. Colors are dropped automatically
 * when piped or redirected, or when NO_COLOR is set (FORCE_COLOR=1 forces them on).
 *
 * Requires an authenticated Claude Code / subscription login in the environment.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";
import {
  query,
  type EffortLevel,
  type Options,
  type PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";

// ---- Config (edit these) ----------------------------------------------------
const AUDIT_MODEL = "opus"; // strong enough to verify claims
const FIX_MODEL = "sonnet"; // cheaper model for mechanical edits
const AUDIT_EFFORT: EffortLevel = "high"; // low | medium | high | xhigh | max
const FIX_EFFORT: EffortLevel = "medium";
const MAX_ITERS = 8;
const REQUIRED_CLEAN = 2; // consecutive clean audits before declaring convergence
const TURN_CAP = 30; // hard stop on tool-use round trips per call
const LOAD_PROJECT_CONTEXT = true; // loads CLAUDE.md/skills; false saves tokens
// ----------------------------------------------------------------------------

// ---- Colors ------------------------------------------------------------------
//
// styleText strips the codes itself when the stream isn't a TTY or NO_COLOR is set.
type Style = Parameters<typeof styleText>[0];

const toStdout = (format: Style) => (text: string) =>
  styleText(format, text, { stream: process.stdout });

const toStderr = (format: Style) => (text: string) =>
  styleText(format, text, { stream: process.stderr });

const colors = {
  audit: toStdout(["bold", "cyan"]),
  fix: toStdout(["bold", "magenta"]),
  tool: toStdout("blue"),
  dim: toStdout("dim"),
  pass: toStdout(["bold", "green"]),
  fail: toStdout(["bold", "red"]),
  ok: toStdout("green"),
  success: toStdout(["bold", "green"]),
};

const errorColors = {
  error: toStderr("red"),
  warn: toStderr("yellow"),
  bold: toStderr("bold"),
};

/** Highlight the VERDICT line(s) in an agent's output. */
function colorVerdicts(text: string): string {
  return text
    .replace(/^VERDICT:\s*PASS\b.*$/gim, (line) => colors.pass(line))
    .replace(/^VERDICT:\s*FAIL\b.*$/gim, (line) => colors.fail(line));
}
// ----------------------------------------------------------------------------

// This file lives at <repo>/.claude/loops/audit.ts
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PLANS_DIR = resolve(REPO_ROOT, ".claude/plans");

interface AuditPromptArgs {
  plan: string;
  scope: string;
  testsClause: string;
}

const AUDIT_PROMPT = ({ plan, scope, testsClause }: AuditPromptArgs) => `\
You are a skeptical staff engineer reviewing an implementation plan that another
agent will execute. ASSUME the plan contains incorrect assumptions until you have
verified otherwise against the actual codebase.

The plan is at: ${plan}
Restrict your investigation to these paths (read/grep only what you need here):
${scope}

For every assumption the plan makes about existing code -- function signatures,
exported symbols, file locations, data shapes${testsClause} -- VERIFY it by reading
the relevant files or grepping. Do not speculate, and do not read files outside the
scoped paths unless a scoped file directly references them.

Report ONLY issues you can back with concrete evidence. For each, give:
  - the plan's claim
  - the contradicting evidence (file:line or grep result)
  - the concrete fix

Be efficient: read the plan once, verify the specific claims, then decide. Do not
re-read files you have already seen.

Put all of your explanation and findings ABOVE the verdict. Then finish with a
single final line that is EXACTLY one of the following, with no other text on that
line (no parentheses, no commentary):
VERDICT: PASS
VERDICT: FAIL
`;

interface FixPromptArgs {
  plan: string;
  findings: string;
}

const FIX_PROMPT = ({ plan, findings }: FixPromptArgs) => `\
Revise the implementation plan at ${plan} to resolve every issue in the audit
findings below. Edit the file in place. Preserve its structure and intent; change
only what the findings require, and update any downstream steps that depended on a
corrected assumption. Do not add unrelated content. Do not mark anything resolved
that you did not actually change.

When done, briefly summarize what you changed.

Audit findings:
${findings}
`;

function sha(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return "";
  }
}

/** True only if the last VERDICT line says PASS. Tolerates trailing text. */
function verdictIsPass(text: string): boolean {
  const verdicts = [...text.matchAll(/^VERDICT:\s*(PASS|FAIL)\b/gim)];
  return verdicts.length > 0 && verdicts.at(-1)![1].toUpperCase() === "PASS";
}

type RunResult = {
  text: string;
  subtype: string;
  cost: number;
}

type RunArgs = {
  prompt: string;
  model: string;
  effort: EffortLevel;
  allowedTools: string[];
  permissionMode: PermissionMode;
  disallowedTools?: string[];
}

/** One headless call. */
async function run({
  prompt,
  model,
  effort,
  allowedTools,
  permissionMode,
  disallowedTools = [],
}: RunArgs): Promise<RunResult> {
  let text = "";
  let subtype = "unknown";
  let cost = 0;

  const options: Options = {
    cwd: REPO_ROOT,
    model,
    effort,
    allowedTools,
    disallowedTools,
    permissionMode,
    maxTurns: TURN_CAP,
    settingSources: LOAD_PROJECT_CONTEXT ? ["project"] : [],
    ...(permissionMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
  };

  let turn = 0;
  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          turn++;
          const inp = (block.input ?? {}) as Record<string, unknown>;
          const detail = inp.file_path ?? inp.pattern ?? inp.command ?? "";
          console.log(`  ${colors.dim(`[${turn}/${TURN_CAP}]`)} ${colors.tool(block.name)} ${colors.dim(String(detail))}`);
        }
      }
    } else if (msg.type === "result") {
      subtype = msg.subtype;
      if (typeof msg.total_cost_usd === "number") cost = msg.total_cost_usd;
      if (msg.subtype === "success" && msg.result) text = msg.result;
    }
  }
  return { text, subtype, cost };
}

type MainArgs = {
  plan: string;
  scopePaths: string[];
  testCmd: string;
  maxIters: number;
}

async function main({ plan, scopePaths, testCmd, maxIters }: MainArgs): Promise<number> {
  const scope = scopePaths.map((p) => `  - ${p}`).join("\n") || "  - (whole repo)";
  let testsClause = "";
  let auditTools = ["Read", "Glob", "Grep"];
  if (testCmd) {
    testsClause =
      `, and runtime behavior (you MAY run \`${testCmd}\` via Bash to confirm ` +
      "a claim, but only when a structural check cannot settle it)";
    auditTools = [...auditTools, `Bash(${testCmd})`];
  }

  let clean = 0;
  let totalCost = 0;
  const bar = (ch: string) => ch.repeat(60);

  for (let i = 1; i <= maxIters; i++) {
    console.log(colors.audit(`\n${bar("=")}\n=== Iteration ${i}: AUDIT (${AUDIT_MODEL}/${AUDIT_EFFORT})\n${bar("=")}`));
    
    const audit = await run({
      prompt: AUDIT_PROMPT({ plan, scope, testsClause }),
      model: AUDIT_MODEL,
      effort: AUDIT_EFFORT,
      allowedTools: auditTools,
      permissionMode: "plan",
    });
    
    totalCost += audit.cost;
    
    console.log(colorVerdicts(audit.text.trim()) || colors.dim("(no audit output)\n"));
    console.log(colors.dim(`[audit ${audit.subtype}]  step $${audit.cost.toFixed(4)}  running $${totalCost.toFixed(4)}`));

    if (audit.subtype !== "success") {
      console.error(errorColors.error(`Audit did not complete cleanly (${audit.subtype}); stopping.`));
      return 1;
    }

    if (verdictIsPass(audit.text)) {
      clean++;
      
      console.log(colors.ok(`Clean audit (${clean}/${REQUIRED_CLEAN})`));
      
      if (clean >= REQUIRED_CLEAN) {
        console.log(colors.success(`\n[+] Converged after ${i} iterations. Total $${totalCost.toFixed(4)}`));
        return 0;
      }
      continue;
    }

    // FAIL -> fix, then loop back to re-audit
    clean = 0;
    const before = sha(plan);
    console.log(colors.fix(`\n${bar("-")}\n--- Iteration ${i}: FIX (${FIX_MODEL}/${FIX_EFFORT})\n${bar("-")}`));
    
    const fix = await run({
      prompt: FIX_PROMPT({ plan, findings: audit.text }),
      model: FIX_MODEL,
      effort: FIX_EFFORT,
      allowedTools: ["Read", "Edit", "Glob", "Grep"],
      // bypassPermissions: acceptEdits won't auto-approve edits under .claude/,
      // and headless has no one to answer a prompt. Deny Bash to stay bounded.
      permissionMode: "bypassPermissions",
      disallowedTools: ["Bash"],
    });
    
    totalCost += fix.cost;
    
    console.log(fix.text.trim() || colors.dim("(no fix summary)"));
    console.log(colors.dim(`\n[fix ${fix.subtype}]  step $${fix.cost.toFixed(4)}  running $${totalCost.toFixed(4)}`));

    if (sha(plan) === before) {
      console.error(errorColors.warn("\n[!] The fix step made NO change to the plan file."));
      console.error(errorColors.warn("    Either there was nothing concrete to change, or the fixer"));
      console.error(errorColors.warn("    could not apply edits. Stopping so it doesn't spin."));
      return 1;
    }
    console.log(colors.dim("\n    plan updated -> re-auditing..."));
  }

  console.error(errorColors.warn(`\n[!] Hit max-iters (${maxIters}) without converging. Total $${totalCost.toFixed(4)}`));
  return 1;
}

// ---- CLI ---------------------------------------------------------------------
const USAGE =
  "usage: audit.ts PLAN [--paths P]... [--run-tests CMD] [--max-iters N]\n" +
  "  PLAN         a plan file path, or a plan name in .claude/plans/\n" +
  '  --paths      repo paths the audit may read: "a b", a,b, or repeat the flag';

const isFile = (filePath: string) => existsSync(filePath) && statSync(filePath).isFile();

/** A path (relative to where you ran the command) first, then a name in .claude/plans/. */
function resolvePlan(arg: string): string | undefined {
  // `npm run` switches cwd to the package root; INIT_CWD is where you actually were.
  const callerDir = process.env.INIT_CWD ?? process.cwd();

  const candidates = [
    resolve(callerDir, arg),
    resolve(PLANS_DIR, arg),
    resolve(PLANS_DIR, `${arg}.md`),
  ];

  return candidates.find(isFile);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      paths: { type: "string", multiple: true, default: [] },
      "run-tests": { type: "string", default: "" },
      "max-iters": { type: "string", default: String(MAX_ITERS) },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (err) {
  console.error(`${errorColors.error(`error: ${(err as Error).message}`)}\n${USAGE}`);
  process.exit(2);
}

const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length !== 1) {
  console.error(`${errorColors.error("error: expected exactly one plan")}\n${USAGE}`);
  process.exit(2);
}

const plan = resolvePlan(positionals[0]);
if (!plan) {
  console.error(errorColors.error(`Plan not found: ${positionals[0]}`));

  let available: string[] = [];
  try {
    available = readdirSync(PLANS_DIR).filter((f) => isFile(resolve(PLANS_DIR, f)));
  } catch {
    // no plans directory
  }

  console.error(
    available.length
      ? `${errorColors.bold("Available plans:")}\n${available.map((f) => `  ${f}`).join("\n")}`
      : `No plans found in ${PLANS_DIR}`,
  );

  process.exit(1);
}

const maxIters = Number(values["max-iters"]);
if (!Number.isInteger(maxIters) || maxIters < 1) {
  console.error(errorColors.error("error: --max-iters must be a positive integer"));
  process.exit(2);
}

// Accept `--paths "a b"`, `--paths a,b`, and repeated `--paths a --paths b`.
const scopePaths = values.paths.flatMap((p) => p.split(/[\s,]+/)).filter(Boolean);
const result = await main({ plan, scopePaths, testCmd: values["run-tests"], maxIters });
process.exit(result);