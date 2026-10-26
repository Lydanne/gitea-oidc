# Change Playbook

## Feature Work

1. Find the closest existing feature that behaves similarly.
2. Identify contracts that need to change: types, config, schema, route, provider, adapter, docs.
3. Add the smallest cohesive implementation with clear names and stable boundaries.
4. Keep user-facing behavior explicit: validation messages, auth errors, redirects, and docs.
5. Add tests for the new behavior plus at least one failure path.
6. Update examples/docs when users must configure or call the feature differently.

## Bug Fixes

1. Reproduce the behavior with an existing or new focused test when practical.
2. Trace the bug to one owner module before editing.
3. Fix the cause rather than only the symptom.
4. Add regression coverage that would have failed before the fix.
5. Check adjacent edge cases, especially auth state, TTL, config defaults, and async cleanup.

## Maintenance And Refactors

1. Preserve behavior unless the user explicitly asks for behavior change.
2. Keep diffs narrow and avoid mixing cleanup with feature semantics.
3. Prefer simplifying existing code over adding abstractions.
4. Move shared logic only when duplication causes real maintenance risk.
5. Run tests for both old and new owners when code moves across folders.

## Documentation Changes

1. Keep commands aligned with `package.json`.
2. Keep config snippets aligned with TypeScript interfaces and Zod schema.
3. Mention production caveats for cookie keys, JWKS, storage, proxy, and secrets.
4. Run Markdown lint after changing docs.
