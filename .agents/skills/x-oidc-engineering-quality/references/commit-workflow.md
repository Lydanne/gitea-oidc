# AI Commit and Push Workflow

## Mandatory Delivery Rule

After a write task is complete and appropriately validated, create a commit without waiting for a
second user request, then push the current branch unless the user explicitly requested no push or
local commits only. Skip the commit only when the user explicitly requested no commit, the task is
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

## Automatic Push

- Inspect the current branch, remotes, upstream, and commits to publish before pushing.
- Fetch the target remote without tags. Use the configured upstream remote and branch explicitly.
  Without an upstream, use `origin` with the same branch name and set the upstream only when that
  target is unambiguous. For a new remote branch, inspect commits since the task's starting revision.
- Publish only task commits or commits already authorized by the user. If earlier unapproved local
  commits would be included, preserve the new commit and report the blocker.
- Stop on detached HEAD, ambiguous targets, divergent remote history, or rejected pushes. Never use
  force push, bypass hooks or branch protection, or automatically rewrite history to make push succeed.
- Verify the target branch SHA with `git ls-remote --heads` against local HEAD after pushing.
- This rule does not authorize tag creation, publication, PR creation, or PR merging.

## Handoff

Check `git status --short` and report the commit hash, push target and outcome, and remaining
uncommitted files. Distinguish a successful local commit from a failed or intentionally skipped push.
