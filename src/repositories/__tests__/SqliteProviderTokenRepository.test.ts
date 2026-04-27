import { afterEach, describe, expect, it } from "vitest";
import { SqliteProviderTokenRepository } from "../SqliteProviderTokenRepository";

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
});
