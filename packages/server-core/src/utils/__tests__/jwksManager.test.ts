import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { generateJWKS, getOrGenerateJWKS } from "../jwksManager.js";

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("jwksManager file permissions", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates JWKS private key files with owner-only permissions", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gitea-oidc-jwks-"));
    const filePath = join(tempDir, "jwks.json");
    const previousUmask = process.umask(0);

    try {
      await generateJWKS(filePath, "test-key");
    } finally {
      process.umask(previousUmask);
    }

    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("tightens permissions before loading an existing JWKS file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gitea-oidc-jwks-"));
    const filePath = join(tempDir, "jwks.json");
    writeFileSync(filePath, JSON.stringify({ keys: [{ kty: "RSA", kid: "test-key" }] }), {
      encoding: "utf-8",
      mode: 0o644,
    });

    await getOrGenerateJWKS(filePath, "unused");

    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("concurrent initialization reuses one atomically persisted key set", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gitea-oidc-jwks-"));
    const filePath = join(tempDir, "jwks.json");

    const results = await Promise.all(
      Array.from({ length: 4 }, () => getOrGenerateJWKS(filePath, "concurrent-key")),
    );

    expect(new Set(results.map((jwks) => jwks.keys[0].kid))).toEqual(new Set(["concurrent-key"]));
    expect(JSON.parse(readFileSync(filePath, "utf-8")).keys).toHaveLength(1);
  });
});
