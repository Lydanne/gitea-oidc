# Testing Strategy

## Focused Test Selection

- Provider change: run the provider test and related `AuthCoordinator` tests.
- Repository change: run that repository test plus user ID generation tests if identity changed.
- Adapter change: run adapter tests plus factory tests.
- Config/schema change: run config and config validator tests.
- Utility change: run the utility test and any owner module that consumes it.
- Build/export change: run `pnpm build`.
- Markdown-only change: run `pnpm lint:md`.

## Broaden When

- A shared type or interface changed.
- Runtime startup wiring changed.
- Config shape, defaults, or validation changed.
- Auth flow, OAuth state, OIDC claims, or adapter persistence changed.
- A fix touches more than one owner module.

## Preferred Commands

- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `pnpm test:coverage`
- `pnpm lint:md`
- `./docker-test.sh test`

## Environment Note

The workspace and server require Node.js `24.22.1` and pnpm `>=10`. If the shell defaults are
older, use a Node 24.22.1 installation and Corepack-provided pnpm before reporting validation
failure. SDK compatibility checks intentionally switch to the package minimum Node version.
