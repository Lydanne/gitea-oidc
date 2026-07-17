# Quality Rubric

## Code Quality

- Names explain domain intent, not implementation trivia.
- Functions have one clear owner and avoid hidden cross-module side effects.
- Async resources are closed or cleaned up when the owning module supports cleanup.
- Errors use existing helpers such as `AuthErrors` where available.
- Logging explains operational events without leaking secrets.
- New dependencies are justified by real complexity reduction.

## Type And Contract Quality

- Public types describe real runtime behavior.
- Optional fields are optional in both TypeScript and Zod, not just one layer.
- Defaults are centralized where current patterns put them.
- Config changes include validation, examples, docs, and tests.
- Provider and adapter contracts remain compatible with existing tests and docs.

## Security And Protocol Quality

- OAuth state is random, scoped, validated, and single-use where applicable.
- External profile IDs used for identity are stable provider IDs.
- OIDC issuer, redirect URIs, and public server URL remain consistent.
- Production warnings remain conservative.
- Secrets, tokens, cookie keys, JWKS private material, and passwords are never logged.

## Maintainability Signals

- New tests describe behavior rather than implementation internals.
- Edge cases are handled near the module that owns the invariant.
- Docs tell users what to configure, not internal implementation details.
- The final diff can be reviewed by module: core, provider, repository, adapter, config, docs.
