# Config Safety Checklist

## Key Files

- `src/config.ts`: `GiteaOidcConfig`, defaults, loading, merge behavior.
- `src/schemas/configSchema.ts`: runtime validation and defaults.
- `src/utils/configValidator.ts`: production warnings and validation helpers.
- `example.gitea-oidc.config.json`: user-facing baseline.
- `docs/PRODUCTION_SETUP.md`, `docs/REVERSE_PROXY_HTTPS.md`, `docs/PRODUCTION_WARNINGS*.md`: deployment guidance.

## Synchronization Rules

- New config field means update interface, schema, defaults or optionality, example config, README/docs, and tests.
- Removed or renamed field needs migration guidance in docs.
- Default values must be safe for local development and explicit about production caveats.
- Error messages should name the missing field and the expected shape.

## Security Rules

- `oidc.cookieKeys` must be at least 32 characters in validation.
- Production should not use default cookie keys, memory user repository, or memory OIDC adapter.
- JWKS should persist to disk or configured storage so token signing keys survive restarts.
- `server.url`, `oidc.issuer`, and client redirect/logout URIs must agree with public deployment URLs.
- `trustProxy` is required behind HTTPS reverse proxies that terminate TLS.
- Never log `client_secret`, cookie keys, JWKS private material, app secrets, database passwords, or raw tokens.

## Testing Ideas

- JS config wins over JSON config.
- Invalid URL fields fail Zod validation with useful messages.
- Cookie key length validation catches weak keys.
- PostgreSQL config requires `connectionString` or host-style fields.
- Redis adapter config requires `url` or `host`.
- Defaults preserve current local startup behavior.
