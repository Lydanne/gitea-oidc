# Commit Workflow

## Mandatory Delivery Rule

After a write task is complete and appropriately validated, create a commit without waiting for a
second user request. Skip the commit only when the user explicitly requested no commit, the task is
read-only, or the implementation is incomplete or known to be broken.

## Safe Staging

1. Inspect `git status --short`, unstaged diff, and staged diff.
2. Stage only explicit task paths or selected hunks. Do not use `git add .` or `git add -A`.
3. Preserve unrelated staged, unstaged, and untracked files.
4. If a file mixes task changes with unrelated changes, split the hunk. If isolation is unsafe,
   stop and report the blocker instead of broadening the commit.
5. Inspect the full staged diff and run `git diff --cached --check` before committing.

## Commit Construction

- Use `type(scope): 中文祈使主题`; use `!` when the change breaks a public contract.
- Use the nearest `package.json` directory for a single package.
- Use `x-oidc` for root files or an atomic cross-package change.
- Split independent package changes when they can be reviewed and reverted separately.
- Do not use `--no-verify`; Husky and commitlint are required delivery gates.

## Handoff

After committing, inspect `git status --short` again. Report the commit hash and any remaining
uncommitted files. A local commit does not authorize push, tag creation, release, or pull-request
creation.
