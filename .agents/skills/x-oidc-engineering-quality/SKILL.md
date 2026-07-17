---
name: x-oidc-engineering-quality
description: >-
  Use as the default development skill for this x-oidc repository when
  implementing features, fixing bugs, refactoring, maintaining code, improving
  tests, or reviewing code quality across TypeScript, Fastify, OIDC, auth,
  storage, configuration, docs, and release surfaces.
---

# X OIDC Engineering Quality

Use this as the first skill for normal development work in this repository.
It is the broad engineering workflow; pull in narrower skills only when the
change touches their area.

## Start Here

1. Classify the task: feature, bug fix, refactor, maintenance, test, docs, or release support.
2. Identify the behavioral boundary: public API, config shape, OIDC protocol behavior,
   auth flow, storage contract, CLI/script behavior, or docs promise.
3. Read the smallest useful slice of code and tests before editing.
4. Choose the narrowest implementation that preserves current contracts.
5. Update tests and docs in the same change when behavior, config, or user workflow changes.
6. Run focused validation first, then broaden only when shared contracts changed.
7. For completed write tasks, stage only in-scope changes and create the required commit unless
   the user explicitly requested no commit.

## Pull In Specialized Skills

- Use `$x-oidc-auth-provider` for auth providers, OAuth callbacks, permissions, and users.
- Use `$x-oidc-oidc-storage` for OIDC adapters, Redis, SQLite, TTL, and cleanup.
- Use `$x-oidc-config-safety` for config loading, schema, JWKS, proxy, and production safety.
- Use `$x-oidc-docs-quality` for docs writing, cleanup, organization, links, and Markdown style.
- Use `$x-oidc-spec-drafts` for AI-generated temporary proposals and TODO plans.
- Use `$x-oidc-release-quality` for package, build, Docker, CI, changelog, and publish checks.

## Local References

- Read `references/architecture-map.md` when the task spans more than one folder.
- Read `references/change-playbook.md` when implementing a feature, bug fix, or refactor.
- Read `references/quality-rubric.md` before finishing non-trivial code changes.
- Read `references/testing-strategy.md` when choosing which tests or commands to run.
- Read `references/commit-workflow.md` before staging or committing changes.

## Definition Of Done

- The code follows existing local patterns and keeps module boundaries clear.
- Runtime errors are explicit and useful; secrets are never logged.
- Types, schema, examples, docs, and tests stay synchronized.
- Focused tests pass, and broader checks are run when the blast radius warrants it.
- Completed in-scope changes are committed; unrelated worktree changes remain untouched.
- The final response names any validation that could not be run.
