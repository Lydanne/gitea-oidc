# Release Checks

## Key Files

- `package.json`: scripts, package metadata, engines, dependencies.
- `pnpm-lock.yaml`: dependency lockfile.
- `rolldown.config.ts` and `rolldown.config.prod.ts`: ESM bundle output.
- `Dockerfile`, `docker-test.sh`, `tests/*.sh`, `gitea-server/`: container and integration checks.
- `README.md`, `README.en.md`, `docs/RELEASE_AND_CI_CD.md`: user-visible workflow.
- `commitlint.config.js`: Conventional Commits enforcement.

## Pre-Release Checklist

- `pnpm install` is only needed when lockfile or dependencies changed.
- `pnpm lint` passes.
- `pnpm test` passes.
- `pnpm build` produces the expected ESM entry under `dist/`.
- `pnpm build:prod` still works when production bundling changed.
- Docker image can build when Docker-related files change.
- README commands match `package.json` scripts.
- Version and changelog changes are intentional and release-tool compatible.

## Dependency Rules

- Runtime dependencies belong in `dependencies`; tools and types belong in `devDependencies`.
- Keep Node and pnpm engine assumptions aligned with README and CI.
- Avoid adding dependencies for small helpers already covered by Node.js, TypeScript, Fastify, Zod, or existing libraries.

## Commit Scope Rule

- For files governed by the root `package.json`, use scope `gitea-oidc`.
- If a future nested package appears, use the directory name containing the nearest `package.json`.
- Subject should be Chinese, imperative, concise, and without trailing punctuation.
