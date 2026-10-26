# OIDC Adapter Contract

## Key Files

- `packages/server-core/src/adapters/OidcAdapterFactory.ts`: adapter type selection, validation,
  cleanup, and `oidc-provider` factory hook.
- `packages/server-core/src/adapters/SqliteOidcAdapter.ts`: SQLite-backed implementation.
- `packages/server-core/src/adapters/RedisOidcAdapter.ts`: Redis-backed implementation.
- `packages/server-core/src/schemas/configSchema.ts`: runtime validation for adapter config.
- `packages/server-core/src/config.ts`: defaults and merged config shape.
- `docs/ADAPTER_CONFIGURATION.md` and `docs/REDIS_ADAPTER_GUIDE.md`: user-facing behavior.

## Behavior Expectations

- `upsert(id, payload, expiresIn)` stores a complete payload with model-specific keying.
- `find(id)` returns the stored payload or `undefined`/empty result as existing tests expect.
- `consume(id)` marks a grant or token as consumed without destroying unrelated payload fields.
- `destroy(id)` removes only the targeted model record.
- `revokeByGrantId(grantId)` removes or invalidates all records sharing the grant ID.
- Lookup helpers such as `findByUid` and `findByUserCode` must use indexed fields or
  equivalent scans without changing public behavior.
- TTL must be honored consistently; expired OIDC data should not resurrect across process restarts.

## Config Checklist

- Add adapter option to `OidcAdapterConfig`.
- Add validation to `OidcAdapterConfigSchema`.
- Update default config only when the option has a safe default.
- Update example config and docs if users need to set it.
- Ensure factory errors are specific and actionable.

## Test Matrix

- Factory creates the right adapter for each type.
- Missing Redis config fails validation.
- Memory adapter warning remains development-only.
- `upsert` + `find` round trip preserves nested payloads.
- TTL expiry is covered where feasible.
- `destroy`, `consume`, and `revokeByGrantId` do not affect unrelated records.
- Cleanup closes external connections without breaking subsequent tests.
