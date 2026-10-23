import { describe, expect, it } from "vitest";
import type { UserInfo } from "../../types/auth.js";
import { sanitizeForLog, summarizeClaimsForLog, summarizeUserForLog } from "../logSanitizer.js";

describe("logSanitizer", () => {
  it("redacts nested secrets, tokens, OAuth fields and PII", () => {
    const sanitized = sanitizeForLog({
      authorization: "Bearer oidc-token",
      code: "oauth-code",
      state: "oauth-state",
      body: {
        username: "alice",
        password: "plain-password",
        accessToken: "provider-access",
        refresh_token: "provider-refresh",
        email: "alice@example.com",
        providerProfile: {
          raw: { mobile: "13800000000" },
        },
      },
      headers: {
        cookie: "sid=session-id",
        "content-type": "application/json",
      },
    });

    expect(sanitized).toEqual({
      authorization: "[REDACTED]",
      code: "[REDACTED]",
      state: "[REDACTED]",
      body: {
        username: "[REDACTED]",
        password: "[REDACTED]",
        accessToken: "[REDACTED]",
        refresh_token: "[REDACTED]",
        email: "[REDACTED]",
        providerProfile: "[REDACTED]",
      },
      headers: {
        cookie: "[REDACTED]",
        "content-type": "application/json",
      },
    });
  });

  it("handles circular objects without throwing", () => {
    const circular: Record<string, unknown> = { value: "ok" };
    circular.self = circular;

    expect(sanitizeForLog(circular)).toEqual({ value: "ok", self: "[Circular]" });
  });

  it("redacts token-like text from error messages and non-sensitive string fields", () => {
    const sanitized = sanitizeForLog({
      error: new Error(
        "failed Authorization: Bearer provider-token access_token=provider-access refresh_token=provider-refresh app_access_token=provider-app-access",
      ),
      message:
        "client_secret=provider-secret code=oauth-code tenantAccessToken=provider-tenant-access",
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("provider-token");
    expect(serialized).not.toContain("provider-access");
    expect(serialized).not.toContain("provider-refresh");
    expect(serialized).not.toContain("provider-app-access");
    expect(serialized).not.toContain("provider-tenant-access");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("oauth-code");
  });

  it("summarizes users without raw profile, metadata or contact values", () => {
    const user: UserInfo = {
      id: "internal-user-1",
      sub: "user-1",
      username: "alice",
      name: "Alice",
      email: "alice@example.com",
      phone: "13800000000",
      authProvider: "feishu",
      externalId: "open-id",
      groups: [
        { id: "dev", name: "dev" },
        { id: "ops", name: "ops" },
      ],
      roles: ["admin"],
      status: "active",
      providerProfile: {
        provider: "feishu",
        externalId: "open-id",
        raw: { mobile: "13800000000" },
      },
      metadata: { accessToken: "token" },
    } as UserInfo;

    expect(summarizeUserForLog(user)).toEqual({
      sub: "user-1",
      authProvider: "feishu",
      status: "active",
      hasExternalId: true,
      groupCount: 2,
      roleCount: 1,
      hasEmail: true,
      hasPhone: true,
      hasProviderProfile: true,
      hasMetadata: true,
    });
  });

  it("summarizes claims without exposing contact claim values", () => {
    expect(
      summarizeClaimsForLog({
        sub: "user-1",
        name: "Alice",
        email: "alice@example.com",
        phone: "13800000000",
        picture: "https://example.com/avatar.png",
        groups: ["dev"],
        roles: ["admin"],
        status: "active",
      }),
    ).toEqual({
      claimKeys: ["email", "groups", "name", "phone", "picture", "roles", "status", "sub"],
      groupCount: 1,
      roleCount: 1,
      status: "active",
      hasEmail: true,
      hasPhone: true,
      hasPicture: true,
    });
  });
});
