import { describe, expect, it } from "vitest";
import { summarizeTokenError, TokenEncryptor } from "../tokenCrypto";

describe("TokenEncryptor", () => {
  it("encrypts and decrypts token values", () => {
    const encryptor = new TokenEncryptor("secret-key-for-provider-tokens");
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
});
