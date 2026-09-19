# Agent instructions

`CLAUDE.md` is the full set of working notes for this repo — staff detection,
the git workflow, skill mappings. Read it. The rule below is repeated here
because it is the one most easily broken by accident.

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
