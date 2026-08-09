# Workflow

Work directly in the main checkout. Do not create or switch into an isolated
git worktree, even for large multi-file changes — work on a branch under
`.claude/worktrees/` cannot be followed while it is in progress.

Never stage or commit. No `git add`, no `git commit`. Leave the work as
uncommitted edits in the working tree so the diff can be reviewed before it
becomes history. Running tests, typecheck, lint and build is fine; none of those
touch git. Finish by reporting what changed, and leave staging and committing to
the author.

# Skill mappings
When working on Redux Toolkit state management, adopting Redux in a codebase
using useState/Context, or handling RTK Query / side effects, read and follow
the Redux Toolkit skills shipped in the installed package:
- node_modules/@reduxjs/toolkit/skills/*/*/SKILL.md