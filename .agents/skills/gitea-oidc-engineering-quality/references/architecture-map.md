# Architecture Map

## Runtime Flow

- `src/server.ts` wires Fastify, static files, auth providers, OIDC provider, adapters, JWKS,
  and HTTP routes.
- `src/config.ts` loads JS/JSON/default config and exposes `GiteaOidcConfig`.
- `src/schemas/configSchema.ts` validates runtime config with Zod.
- `src/core/AuthCoordinator.ts` owns provider registration, unified login, OAuth state,
  provider callbacks, and OIDC interaction completion.
- `src/core/PermissionChecker.ts` guards provider capabilities.
- `src/providers/` implements login methods.
- `src/repositories/` maps provider identities to stable local users.
- `src/adapters/` persists `oidc-provider` model data.
- `src/stores/` stores short-lived OAuth state and auth flow data.
- `src/utils/` contains logging, JWKS, auth errors, config validation, and user ID helpers.

## Dependency Direction

- Providers depend on auth types, repositories, coordinator contracts, errors, and logging.
- Core code should depend on provider interfaces rather than concrete external systems.
- Repositories own durable user data and should not know about Fastify request details.
- OIDC adapters own token/session persistence and should not know about auth providers.
- Config/schema changes are cross-cutting and must update docs and examples.

## Public Surfaces

- Package entry: `src/server.ts` exports `start`.
- Config API: `GiteaOidcConfig`, config files, and example config.
- HTTP surface: `/`, `/oidc/*`, `/interaction/:uid`, `/auth/{provider}/*`.
- User-facing docs: `README.md`, `README.en.md`, and `docs/`.
- Operational scripts: `package.json` scripts and Docker test scripts.

## Common Risk Areas

- OIDC issuer and callback URL mismatches.
- OAuth state expiry or one-time-use mistakes.
- Mutable external profile fields becoming stable user IDs.
- Adapter TTL or grant revocation regressions.
- Config defaults that are fine locally but unsafe in production.
- Logs accidentally exposing secrets or tokens.
