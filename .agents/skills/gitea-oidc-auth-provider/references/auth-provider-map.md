# Auth Provider Map

## Key Files

- `packages/server-core/src/types/auth.ts`: `AuthProvider`, `AuthContext`, `AuthResult`, plugin route/static/webhook
  interfaces, permissions, and auth error codes.
- `packages/server-core/src/core/AuthCoordinator.ts`: provider registration, permission checks, route mounting,
  OAuth state lifecycle, and interaction completion.
- `packages/server-core/src/core/PermissionChecker.ts`: allowed plugin capabilities.
- `packages/server-core/src/providers/LocalAuthProvider.ts`: htpasswd-style password login implementation.
- `packages/server-core/src/providers/FeishuAuthProvider.ts`: OAuth 2.0 provider, callback route, static icon, webhook handling.
- `packages/server-core/src/repositories/*UserRepository.ts`: provider identity to internal user mapping.

## Provider Checklist

- `name` is lowercase and stable.
- `displayName` is human-readable Chinese unless provider branding requires otherwise.
- `initialize` validates required config before serving traffic.
- `canHandle` checks both `context.authMethod` and `context.body.authMethod` when form submissions are involved.
- `renderLoginUI` returns either a form fragment or a redirect/button definition compatible with the unified login page.
- `authenticate` returns structured `AuthResult` and uses `AuthErrors` helpers instead of raw strings where possible.
- `getUserInfo` returns repository data by stable `sub`.
- Any route/static/webhook/middleware registration has matching `getMetadata()` permissions.

## OAuth Flow Notes

- Generate OAuth state with `coordinator.generateOAuthState(interactionUid, providerName, metadata)`.
- Include useful metadata such as user agent and IP, but never include secrets.
- Callback must verify state before exchanging code.
- Handle provider token and userinfo failures separately to make errors actionable.
- Complete the OIDC interaction only after a user has been found or created.
- Prefer `union_id` or provider-specific immutable IDs over email for account identity.

## Testing Ideas

- Provider initializes with valid config and rejects missing critical config.
- `canHandle` recognizes the intended auth method only.
- Local auth verifies bcrypt and rejects missing user/password.
- OAuth callback rejects missing code/state and expired state.
- Provider maps external profile fields to `UserInfo` consistently.
- Permission metadata covers every route/static/webhook/middleware capability used.
