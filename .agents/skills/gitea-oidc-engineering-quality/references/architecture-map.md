# Architecture Map

## Runtime Flow

- `packages/server-core/src/identityServer.ts` wires Fastify, static files, auth providers,
  OIDC provider, adapters, JWKS, and HTTP routes without listening.
- `packages/server-core/src/server.ts` preserves the public `start()` contract and direct-execution
  process lifecycle.
- `apps/idp-server/src/main.ts` is the production process entry.
- `apps/admin-web/` is the standalone Vue management application.
- `packages/server-core/src/config.ts` loads JS/JSON/default config and exposes `GiteaOidcConfig`.
- `packages/server-core/src/schemas/configSchema.ts` validates runtime config with Zod.
- `packages/server-core/src/core/AuthCoordinator.ts` owns provider registration, unified login, OAuth state,
  provider callbacks, and OIDC interaction completion.
- `packages/server-core/src/core/PermissionChecker.ts` guards provider capabilities.
- `packages/server-core/src/providers/` implements login methods.
- `packages/server-core/src/repositories/` maps provider identities to stable local users.
- `packages/server-core/src/adapters/` persists `oidc-provider` model data.
- `packages/server-core/src/stores/` stores short-lived OAuth state and auth flow data.
- `packages/server-core/src/utils/` contains logging, JWKS, auth errors, config validation, and user ID helpers.

## Dependency Direction

- Providers depend on auth types, repositories, coordinator contracts, errors, and logging.
- Core code should depend on provider interfaces rather than concrete external systems.
- Repositories own durable user data and should not know about Fastify request details.
- OIDC adapters own token/session persistence and should not know about auth providers.
- Config/schema changes are cross-cutting and must update docs and examples.

## Public Surfaces

- Package entry: `packages/server-core/src/server.ts` exports `createIdentityServer`, `start`, and
  `runIdentityServerProcess`.
- Config API: `GiteaOidcConfig`, config files, and example config.
- HTTP surface: `/`, `/oidc/*`, `/interaction/:uid`, `/auth/{provider}/*`.
- User-facing docs: `README.md`, `README.en.md`, and `docs/`.
- Operational scripts: private root `package.json`, package-level scripts, and Docker test scripts.

## Common Risk Areas

- OIDC issuer and callback URL mismatches.
- OAuth state expiry or one-time-use mistakes.
- Mutable external profile fields becoming stable user IDs.
- Adapter TTL or grant revocation regressions.
- Config defaults that are fine locally but unsafe in production.
- Logs accidentally exposing secrets or tokens.
