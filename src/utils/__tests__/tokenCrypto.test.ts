import { describe, expect, it } from "vitest";
import { sanitizeTokenErrorText, summarizeTokenError, TokenEncryptor } from "../tokenCrypto";

describe("TokenEncryptor", () => {
  it("encrypts and decrypts token values", () => {
    const encryptor = new TokenEncryptor("secret-key-for-provider-tokens-32");
    const encrypted = encryptor.encrypt("access-token");

    expect(encrypted).not.toBe("access-token");
    expect(encryptor.decrypt(encrypted)).toBe("access-token");
  });

  it("rejects too short secrets", () => {
    expect(() => new TokenEncryptor("short")).toThrow(/tokenEncryptionKey/);
  });

  it("summarizes errors without throwing", () => {
    expect(summarizeTokenError(new Error("boom"))).toBe("boom");
    expect(summarizeTokenError("plain")).toBe("plain");
  });

  it("redacts token-like values from error summaries", () => {
    const summary = summarizeTokenError(
      new Error(
        'failed access_token=provider-access refresh_token":"provider-refresh" Authorization: Bearer provider-bearer client_secret=provider-secret',
      ),
    );

    expect(summary).toContain("[REDACTED]");
    expect(summary).not.toContain("provider-access");
    expect(summary).not.toContain("provider-refresh");
    expect(summary).not.toContain("provider-bearer");
    expect(summary).not.toContain("provider-secret");
  });

  it("redacts provider-prefixed token keys from error summaries", () => {
    const summary = summarizeTokenError(
      new Error(
        'failed app_access_token=app-access tenant_access_token":"tenant-access" user_access_token=user-access appAccessToken=camel-access tenantAccessToken="camel-tenant"',
      ),
    );

    expect(summary).toContain("[REDACTED]");
    expect(summary).not.toContain("app-access");
    expect(summary).not.toContain("tenant-access");
    expect(summary).not.toContain("user-access");
    expect(summary).not.toContain("camel-access");
    expect(summary).not.toContain("camel-tenant");
  });

  it("sanitizes stored token error text", () => {
    const sanitized = sanitizeTokenErrorText(
      "failed Authorization: Bearer provider-token refresh_token=provider-refresh",
    );

    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("provider-token");
    expect(sanitized).not.toContain("provider-refresh");
    expect(sanitizeTokenErrorText()).toBeUndefined();
  });
});
