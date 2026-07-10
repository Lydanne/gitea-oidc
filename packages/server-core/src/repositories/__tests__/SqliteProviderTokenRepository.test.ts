import { afterEach, describe, expect, it } from "vitest";
import { SqliteProviderTokenRepository } from "../SqliteProviderTokenRepository.js";

describe("SqliteProviderTokenRepository", () => {
  let repository: SqliteProviderTokenRepository | undefined;

  afterEach(async () => {
    await repository?.close();
    repository = undefined;
  });

  it("encrypts tokens at rest and decrypts them when reading", async () => {
    repository = new SqliteProviderTokenRepository(":memory:", "A".repeat(32));

    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-01-01T00:00:00Z"),
      status: "valid",
      metadata: { openId: "open-1" },
    });

    const row = (repository as any).db
      .prepare('SELECT "accessToken", "refreshToken" FROM provider_tokens WHERE "ownerId" = ?')
      .get("user-1");
    expect(row.accessToken).not.toBe("access-token");
    expect(row.refreshToken).not.toBe("refresh-token");

    const found = await repository.find("feishu", "user", "user-1");
    expect(found).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      metadata: { openId: "open-1" },
    });
  });

  it("filters list results and updates token status", async () => {
    repository = new SqliteProviderTokenRepository(":memory:", "A".repeat(32));
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access-token",
      status: "valid",
    });

    await repository.updateStatus("feishu", "user", "user-1", "refresh_failed", "expired");
    const list = await repository.list({ provider: "feishu", status: "refresh_failed" });

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "refresh_failed", lastError: "expired" });
  });

  it("sanitizes token-like values in persisted lastError fields", async () => {
    repository = new SqliteProviderTokenRepository(":memory:", "A".repeat(32));
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access-token",
      status: "valid",
      lastError: "Authorization: Bearer provider-token refresh_token=provider-refresh",
    });

    const found = await repository.find("feishu", "user", "user-1");
    expect(found?.lastError).toContain("[REDACTED]");
    expect(found?.lastError).not.toContain("provider-token");
    expect(found?.lastError).not.toContain("provider-refresh");

    await repository.updateStatus("feishu", "user", "user-1", "unknown", "access_token=raw-access");
    expect((await repository.find("feishu", "user", "user-1"))?.lastError).not.toContain(
      "raw-access",
    );
  });

  it("rejects invalid list options before querying", async () => {
    repository = new SqliteProviderTokenRepository(":memory:", "A".repeat(32));

    await expect(repository.list({ ownerType: "tenant" as any })).rejects.toThrow(
      /Unsupported provider token owner type/,
    );
    await expect(repository.list({ status: "healthy" as any })).rejects.toThrow(
      /Unsupported provider token status/,
    );
    await expect(repository.list({ offset: -1 })).rejects.toThrow(/non-negative integer/);
  });

  it("returns a bounded set of probe candidates without scanning healthy tokens", async () => {
    repository = new SqliteProviderTokenRepository(":memory:", "A".repeat(32));
    const now = Date.now();

    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "healthy",
      accessToken: "access-token",
      expiresAt: new Date(now + 3600_000),
      lastProbedAt: new Date(now),
      status: "valid",
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "unprobed",
      accessToken: "access-token",
      expiresAt: new Date(now + 3600_000),
      status: "valid",
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "unknown",
      accessToken: "access-token",
      expiresAt: new Date(now + 3600_000),
      lastProbedAt: new Date(now),
      status: "unknown",
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "revoked",
      accessToken: "access-token",
      expiresAt: new Date(now + 3600_000),
      status: "revoked",
    });

    const candidates = await repository.listProbeCandidates({
      expiresBefore: new Date(now + 300_000),
      limit: 2,
    });

    expect(candidates.map((candidate) => candidate.ownerId)).toEqual(["unknown", "unprobed"]);
  });
});
