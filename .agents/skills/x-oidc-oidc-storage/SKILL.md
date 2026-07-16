---
name: x-oidc-oidc-storage
description: >-
  Use when changing OIDC persistence adapters, Redis or SQLite adapter behavior,
  oidc-provider Adapter contract handling, adapter configuration, cleanup behavior,
  storage tests, or related docs in this x-oidc repository.
---

# X OIDC Storage

Use this skill for work under `packages/server-core/src/adapters/`, adapter config/schema changes, or
tests that exercise OIDC persistence.

## Workflow

1. Read `packages/server-core/src/adapters/OidcAdapterFactory.ts` and the concrete adapter being changed.
2. Confirm the `oidc-provider` Adapter methods affected: `upsert`, `find`, `findByUid`,
   `findByUserCode`, `destroy`, `revokeByGrantId`, and `consume`.
3. Keep storage keys scoped by model name and preserve TTL semantics.
4. Update config types, Zod schema, examples, and docs when adapter options change.
5. Add focused tests for persistence behavior and factory validation.

## Local References

- Read `references/adapter-contract.md` when implementing or reviewing adapter behavior.

## Validation

- Run adapter-specific tests first, for example:
  `pnpm --filter x-oidc exec vitest run src/adapters/__tests__/SqliteOidcAdapter.test.ts`.
- Run `pnpm test` after shared factory, schema, or type changes.
- Run `pnpm build` if exports or runtime imports changed.
