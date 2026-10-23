import { describe, expect, it } from "vitest";
import { MemoryProviderTokenRepository } from "../MemoryProviderTokenRepository.js";

describe("MemoryProviderTokenRepository", () => {
  it("upserts, finds, lists and deletes token records", async () => {
    const repository = new MemoryProviderTokenRepository();

    const saved = await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });

    expect(saved.id).toBe("feishu:user:user-1");
    await repository.updateStatus("feishu", "user", "user-1", "unknown", "probe failed");

    const found = await repository.find("feishu", "user", "user-1");
    expect(found?.status).toBe("unknown");
    expect(found?.lastError).toBe("probe failed");

    const listed = await repository.list({ provider: "feishu", ownerType: "user" });
    expect(listed).toHaveLength(1);

    await repository.delete("feishu", "user", "user-1");
    expect(await repository.find("feishu", "user", "user-1")).toBeNull();
  });

  it("deletes every provider token owned by a removed user", async () => {
    const repository = new MemoryProviderTokenRepository();
    for (const [provider, ownerId] of [
      ["feishu", "user-1"],
      ["dingtalk", "user-1"],
      ["feishu", "user-2"],
    ]) {
      await repository.upsert({
        provider,
        ownerType: "user",
        ownerId,
        accessToken: `${provider}-${ownerId}`,
        status: "valid",
      });
    }

    await repository.deleteByOwnerId("user-1");

    expect(await repository.list({ ownerId: "user-1" })).toEqual([]);
    expect(await repository.find("feishu", "user", "user-2")).not.toBeNull();
  });

  it("sanitizes token-like values in stored lastError fields", async () => {
    const repository = new MemoryProviderTokenRepository();

    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      status: "valid",
      lastError: "Authorization: Bearer provider-token refresh_token=provider-refresh",
    });

    const found = await repository.find("feishu", "user", "user-1");
    expect(found?.lastError).toContain("[REDACTED]");
    expect(found?.lastError).not.toContain("provider-token");
    expect(found?.lastError).not.toContain("provider-refresh");

    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      status: "valid",
      lastError: undefined,
    });
    expect((await repository.find("feishu", "user", "user-1"))?.lastError).toBeUndefined();
  });

  it("rejects invalid list options", async () => {
    const repository = new MemoryProviderTokenRepository();

    await expect(repository.list({ ownerType: "tenant" as any })).rejects.toThrow(
      /Unsupported provider token owner type/,
    );
    await expect(repository.list({ status: "healthy" as any })).rejects.toThrow(
      /Unsupported provider token status/,
    );
    await expect(repository.list({ limit: -1 })).rejects.toThrow(/positive integer/);
  });

  it("returns a bounded set of probe candidates", async () => {
    const repository = new MemoryProviderTokenRepository();
    const now = Date.now();

    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "healthy",
      accessToken: "access",
      expiresAt: new Date(now + 3600_000),
      lastProbedAt: new Date(now),
      status: "valid",
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "unprobed",
      accessToken: "access",
      expiresAt: new Date(now + 3600_000),
      status: "valid",
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "expiring",
      accessToken: "access",
      expiresAt: new Date(now + 10_000),
      lastProbedAt: new Date(now),
      status: "valid",
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "unknown",
      accessToken: "access",
      expiresAt: new Date(now + 3600_000),
      lastProbedAt: new Date(now),
      status: "unknown",
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "revoked",
      accessToken: "access",
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
