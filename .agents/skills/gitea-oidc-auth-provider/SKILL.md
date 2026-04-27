---
name: gitea-oidc-auth-provider
description: >-
  Use when adding, changing, testing, or reviewing authentication providers for
  this gitea-oidc repository, including LocalAuthProvider, FeishuAuthProvider,
  AuthCoordinator integration, OAuth callback routes, plugin permissions, and
  user repository interactions.
---

# Gitea OIDC Auth Provider

Use this skill for work touching `src/providers/`, `src/core/AuthCoordinator.ts`,
`src/core/PermissionChecker.ts`, auth-related types, or provider tests.

## Workflow

1. Read the relevant provider plus `src/types/auth.ts` and `src/core/AuthCoordinator.ts`.
2. Check whether the provider needs routes, static assets, webhooks, or middleware.
   Declare permissions with `PluginPermission`.
3. Keep provider names stable and URL-safe. Routes are mounted under `/auth/{provider.name}`.
4. For OAuth providers, generate state through the coordinator, validate it on callback,
   complete the original OIDC interaction, and handle expired or invalid state as user-facing auth errors.
5. Map external identities to a stable internal `sub` through `UserRepository.findOrCreate`.
   Do not derive `sub` from mutable display fields.
6. Add or update focused Vitest coverage next to the provider.

## Local References

- Read `references/auth-provider-map.md` when implementing a provider, callback, permission, or test flow.

## Validation

- For provider-only changes, run the matching test file, then `pnpm test` if shared contracts changed.
- If routes, forms, or callback URLs changed, also sanity-check the Fastify route path and OIDC interaction flow.
