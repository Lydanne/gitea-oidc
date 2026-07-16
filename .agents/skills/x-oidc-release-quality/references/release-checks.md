# Release Checks

## Key Files

- Root `package.json`: private workspace orchestration and shared tools.
- `packages/server-core/package.json`: public package metadata, exports, engines, and dependencies.
- `apps/*/package.json`: application build and runtime boundaries.
- `pnpm-lock.yaml`: dependency lockfile.
- `packages/server-core/rolldown.config.ts` and `rolldown.config.prod.ts`: ESM bundle output.
- `Dockerfile`, `docker-test.sh`, `tests/*.sh`, `gitea-server/`: container and integration checks.
- `README.md`, `README.en.md`, `docs/dev/RELEASE_AND_CI_CD.md`: user-visible workflow.
- `commitlint.config.js`: Conventional Commits enforcement.

## Pre-Release Checklist

- `pnpm install` is only needed when lockfile or dependencies changed.
- `pnpm lint` passes.
- `pnpm test` passes.
- `pnpm build` produces the expected ESM entry under `packages/server-core/dist/` and the process
  entry under `apps/idp-server/dist/`.
- `pnpm test:pack` validates the real public tarball and all exported entry points.
- `pnpm build:prod` still works when production bundling changed.
- Docker image can build when Docker-related files change.
- README commands match `package.json` scripts.
- Version and changelog changes are intentional and release-tool compatible.

## Dependency Rules

- Runtime dependencies belong in `dependencies`; tools and types belong in `devDependencies`.
- Keep Node and pnpm engine assumptions aligned with README and CI.
- Avoid adding dependencies for small helpers already covered by Node.js, TypeScript, Fastify, Zod, or existing libraries.

## Commit Scope Rule

- Use the directory name containing the nearest `package.json`, such as `server-core`, `admin-web`,
  or `idp-server`.
- For root workspace files and atomic cross-package changes, use scope `x-oidc`.
- Subject should be Chinese, imperative, concise, and without trailing punctuation.
- Before committing, inspect the staged diff, run `git diff --cached --check`, and confirm the
  sensitive-file check still passes for release-facing changes.
- Never bypass repository hooks with `--no-verify`; automated release commits must satisfy the
  same commitlint rules as human and Agent commits.
