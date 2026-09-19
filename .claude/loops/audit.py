#!/usr/bin/env python3
"""
Lean plan audit/fix convergence loop (Claude Agent SDK).

Repeatedly audits an implementation plan against the actual repo, fixes any
evidence-backed holes, and stops when the audit passes twice in a row.

Token-saving choices baked in (all draw from your subscription pool):
  - AUDIT  : stronger model, effort="medium"  (reasoning where it matters)
  - FIX    : cheaper model,  effort="low"      (mechanical editing)
  - Tests run ONLY with --run-tests (skips a full suite run every iteration)
  - Audit reads are scoped to --paths (no wandering the whole repo)
  - Stall detection: bail if a fix changes nothing
  - Fresh session each iteration: no accumulating context across rounds

Run:
    pip install claude-agent-sdk
    python3 .claude/loops/audit.py docs/plan.md --paths src/auth src/db
    python3 .claude/loops/audit.py --paths src/auth --run-tests "npm test"

Requires an authenticated Claude Code / subscription login in the environment.
"""

import argparse
import asyncio
import hashlib
import re
import sys

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

# ---- Config (edit these) ----------------------------------------------------
AUDIT_MODEL = "opus"   # Claude Code model alias; strong enough to verify claims
FIX_MODEL   = "sonnet"    # cheap model for mechanical edits
AUDIT_EFFORT = "high"  # low | medium | high | xhigh | max
FIX_EFFORT   = "medium"
MAX_ITERS = 8
REQUIRED_CLEAN = 2       # consecutive clean audits before declaring convergence
TURN_CAP = 30            # hard stop on tool-use round trips per call
LOAD_PROJECT_CONTEXT = True  # loads CLAUDE.md/skills; set False to save tokens
# ----------------------------------------------------------------------------

AUDIT_PROMPT = """\
You are a skeptical staff engineer reviewing an implementation plan that another
agent will execute. ASSUME the plan contains incorrect assumptions until you have
verified otherwise against the actual codebase.

The plan is at: {plan}
Restrict your investigation to these paths (read/grep only what you need here):
{scope}

For every assumption the plan makes about existing code -- function signatures,
exported symbols, file locations, data shapes{tests_clause} -- VERIFY it by reading
the relevant files or grepping. Do not speculate, and do not read files outside the
scoped paths unless a scoped file directly references them.

Report ONLY issues you can back with concrete evidence. For each, give:
  - the plan's claim
  - the contradicting evidence (file:line or grep result)
  - the concrete fix

Be efficient: read the plan once, verify the specific claims, then decide. Do not
re-read files you have already seen.

End your response with exactly one line, and nothing after it:
VERDICT: PASS   (no evidence-backed issues remain)
or
VERDICT: FAIL   (issues listed above)
"""

FIX_PROMPT = """\
Revise the implementation plan at {plan} to resolve every issue in the audit
findings below. Edit the file in place. Preserve its structure and intent; change
only what the findings require, and update any downstream steps that depended on a
corrected assumption. Do not add unrelated content. Do not mark anything resolved
that you did not actually change.

Audit findings:
{findings}
"""


def sha(path: str) -> str:
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except FileNotFoundError:
        return ""


async def run(prompt, model, effort, allowed, mode):
    """One headless call; returns (final_text, subtype, cost)."""
    text, subtype, cost = "", "unknown", 0.0
    options = ClaudeAgentOptions(
        model=model,
        effort=effort,
        allowed_tools=allowed,
        permission_mode=mode,
        max_turns=TURN_CAP,
        setting_sources=["project"] if LOAD_PROJECT_CONTEXT else [],
    )
    async for msg in query(prompt=prompt, options=options):
        if isinstance(msg, ResultMessage):
            subtype = msg.subtype
            if msg.total_cost_usd is not None:
                cost = msg.total_cost_usd
            if msg.subtype == "success" and msg.result:
                text = msg.result
    return text, subtype, cost


async def main(plan, scope_paths, test_cmd, max_iters):
    scope = "\n".join(f"  - {p}" for p in scope_paths) or "  - (whole repo)"
    if test_cmd:
        tests_clause = (
            f", and runtime behavior (you MAY run `{test_cmd}` via Bash to confirm "
            "a claim, but only when a structural check cannot settle it)"
        )
        audit_tools = ["Read", "Glob", "Grep", f"Bash({test_cmd})"]
    else:
        tests_clause = ""
        audit_tools = ["Read", "Glob", "Grep"]

    clean = 0
    total_cost = 0.0

    for i in range(1, max_iters + 1):
        print(f"\n=== Iteration {i}: auditing {plan} ===")
        audit_text, subtype, cost = await run(
            AUDIT_PROMPT.format(plan=plan, scope=scope, tests_clause=tests_clause),
            AUDIT_MODEL, AUDIT_EFFORT, audit_tools, "plan",
        )
        total_cost += cost
        print(f"[audit {subtype}]  step ${cost:.4f}  running ${total_cost:.4f}")

        if subtype != "success":
            print(f"Audit did not complete cleanly ({subtype}); stopping.", file=sys.stderr)
            return 1

        if re.search(r"^VERDICT:\s*PASS\s*$", audit_text, re.M):
            clean += 1
            print(f"Clean audit ({clean}/{REQUIRED_CLEAN})")
            if clean >= REQUIRED_CLEAN:
                print(f"\n[+] Converged after {i} iterations. Total ${total_cost:.4f}")
                return 0
            continue

        # FAIL -> fix
        clean = 0
        before = sha(plan)
        print("--- applying fixes ---")
        _, fix_subtype, cost = await run(
            FIX_PROMPT.format(plan=plan, findings=audit_text),
            FIX_MODEL, FIX_EFFORT, ["Read", "Edit", "Glob", "Grep"], "acceptEdits",
        )
        total_cost += cost
        print(f"[fix {fix_subtype}]  step ${cost:.4f}  running ${total_cost:.4f}")

        if sha(plan) == before:
            print("Plan unchanged after fix step (stall); stopping.", file=sys.stderr)
            print(f"Last findings:\n{audit_text}", file=sys.stderr)
            return 1

    print(f"\n[!] Hit max-iters ({max_iters}) without converging. "
          f"Total ${total_cost:.4f}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    argparser = argparse.ArgumentParser()
    argparser.add_argument("plan", help="path to the plan file, e.g. docs/plan.md")
    argparser.add_argument("--paths", nargs="*", default=[],
                    help="repo paths the audit is allowed to read (scopes the reads)")
    argparser.add_argument("--run-tests", metavar="CMD", default="",
                    help='enable test verification, e.g. --run-tests "npm test"')
    argparser.add_argument("--max-iters", type=int, default=MAX_ITERS)
    args = argparser.parse_args()

    sys.exit(asyncio.run(main(args.plan, args.paths, args.run_tests, args.max_iters)))