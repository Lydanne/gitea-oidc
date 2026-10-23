---
name: x-oidc-config-safety
description: Use when changing configuration loading, defaults, Zod schemas, example x-oidc config files, JWKS handling, reverse proxy settings, production security warnings, or deployment-sensitive docs in this repository.
---

# X OIDC Config Safety

Use this skill for configuration, schema, example config, deployment, JWKS, and
production-hardening work.

## Workflow

1. Read `packages/server-core/src/config.ts`,
   `packages/server-core/src/schemas/configSchema.ts`, and the relevant docs or example config.
2. Keep TypeScript interfaces, Zod schemas, defaults, examples, and docs synchronized.
3. Preserve JS config precedence over JSON config.
4. Treat secrets as write-only user inputs; do not log or commit real values.
5. Check production impact for OIDC issuer, redirect URIs, cookie keys, JWKS persistence, `trustProxy`, and storage backends.

## Local References

- Read `references/config-safety-checklist.md` before changing config shape, validation, or production docs.

## Validation

- Run config-focused tests after schema/default changes.
- Run `pnpm build` when public config types change.
- Run Markdown lint for docs-only config changes.
