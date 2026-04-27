---
name: gitea-oidc-release-quality
description: >-
  Use when preparing releases, changing build scripts, package metadata, Docker behavior,
  CI workflows, release-it configuration, README badges, changelog-related files,
  or final validation before publishing this gitea-oidc package.
---

# Gitea OIDC Release Quality

Use this skill for build, release, Docker, CI, and pre-publish validation work.

## Workflow

1. Inspect `package.json` scripts, build configs, Docker files, and the changed surface.
2. Run the smallest useful validation first, then broaden if package exports, runtime entrypoints,
   or deployment artifacts changed.
3. Keep generated artifacts such as `dist/`, coverage output, databases, and local secrets out
   of commits unless the repo explicitly tracks them.
4. Keep README, docs, and examples consistent with CLI scripts and package behavior.
5. Commit messages use Conventional Commits with scope `gitea-oidc` for root package files.

## Local References

- Read `references/release-checks.md` when touching release, build, Docker, CI, or docs that users run directly.

## Validation

- Typical final gate: `pnpm lint`, `pnpm test`, `pnpm build`.
- For Docker changes, use `./docker-test.sh test` if local Docker is available.
- For Markdown-only changes, run `pnpm lint:md`.
