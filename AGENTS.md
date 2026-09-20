# Agent instructions

# Workflow

Work directly in the main checkout. Do not create or switch into an isolated
git worktree, even for large multi-file changes — work on a branch under
`.claude/worktrees/` cannot be followed while it is in progress.

Never stage or commit. No `git add`, no `git commit`. Leave the work as
uncommitted edits in the working tree so the diff can be reviewed before it
becomes history. Running tests, typecheck, lint and build is fine; none of those
touch git. Finish by reporting what changed, and leave staging and committing to
the author.

# Staff detection: what to suspect first

A part is identified by its *ordinal within a system*, so anything that makes a
system detect one staff too many or too few silently re-points every part below
it. The symptom is always the same — an extracted part contains the neighbouring
instrument — and the cause is almost never in `partExtraction.ts`.

Debug it with a whole-document histogram of `system.staves.length` rather than by
eye: a score with a fixed layout should report a single value for every system,
so any other value is a detection bug and needs no ground truth to spot. Render
suspect pages (`gs -sDEVICE=png16m`) and dump the consolidated rules around the
staff that moved.

Detection currently rests on three assumptions. Each was violated by a real score
at some point, and each has a known way it can still fail:

- **The longest rule in a merged group is the staff line.** Solid: merging exists
  to reunite pieces of one interrupted line, and a wrong pick is bounded by
  `ruleMergeTolerance`. Do not go back to averaging a group's height — beams sit
  a fraction of a point off a staff line and drag it until the staff no longer
  looks evenly spaced and is discarded whole.
- **All lines of a staff share the system's left and right edge**
  (`staffEdgeTolerance`, 2%). Structural in every engraver seen so far, but the
  2% was calibrated against one: real siblings differed by 0.35%, intruders by
  2.5% or more. If an engraver draws one line of a staff further out than that,
  the majority vote in `staffLinesOnly` drops it, leaving four lines with a
  double gap that the uniformity check then rejects — losing the whole staff.
  The fix if that turns up: let the uniformity check read a gap of ~2x the line
  spacing as a missing line instead of a disqualification.
- **A staff of under four lines spans the system like its neighbours.** Keeps
  one-line percussion while rejecting gliss pairs and 8va brackets. It does not
  catch a stray rule that genuinely runs margin to margin, and it stands down on
  a page with no four-line staff to compare against.

Confidence is per-engraver, not general: the fixtures in `testScoreFixture.ts`
prove the mechanisms but were written alongside the fix, so they cannot vouch for
the thresholds. Exports from MuseScore, LilyPond, Dorico and Finale are what
would actually settle it.

Detection is not the only way this goes wrong. Notation software hides empty
staves by default, and on a score that uses it the ordinals genuinely differ from
system to system — no amount of detection accuracy helps, and the only guard is
the irregular-systems warning. If a score reports many irregular systems, suspect
this before touching detection.

# Skill mappings
When working on Redux Toolkit state management, adopting Redux in a codebase
using useState/Context, or handling RTK Query / side effects, read and follow
the Redux Toolkit skills shipped in the installed package:
- node_modules/@reduxjs/toolkit/skills/*/*/SKILL.md

## Never generate visual regression baselines locally

Screenshot baselines live in `tests/e2e/__screenshots__/visual/` and are
generated **only in CI**. Do not run `pnpm test:visual:update`,
`playwright test --update-snapshots`, or any variant, and do not hand-write a
PNG into that directory. A baseline captured on a developer machine encodes the
local font stack, GPU and device pixel ratio; CI renders inside the
`mcr.microsoft.com/playwright:*-noble` container, so a locally produced file
fails on its first CI run and the diff cannot be reviewed.

When a task, test or state needs a screenshot, add **only the assertion**,
guarded on the `visual` Playwright project so it stays inert in the functional
runs across the other browsers and viewports:

```ts
if (test.info().project.name === 'visual') {
  await expect(page).toHaveScreenshot('edited-regions-before.png');
}
```

Place it where the state already has a functional assertion — the screenshot is
a second opinion, never the only check. Name the file after the test and the
state. See `tests/e2e/edited-regions.spec.ts` and `tests/e2e/annotations.spec.ts`.

Then stop: leave the baseline missing. Two CI routes produce and commit it:

- add the `update-snapshots` label to the PR (the `update-visual-baselines` job
  regenerates, commits to the branch, removes the label), or
- run the CI workflow via `workflow_dispatch` with `update_snapshots: true`.

A new assertion failing its first `visual` run with "snapshot doesn't exist" is
the flow working. Report that the baseline still has to be generated in CI, and
which route to use. Running `pnpm test:visual` locally to compare against
existing baselines is equally unhelpful — the same rendering differences make it
fail on unchanged UI.
