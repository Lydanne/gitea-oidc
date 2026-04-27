import { describe, expect, it } from "vitest";
import { MemoryProviderTokenRepository } from "../MemoryProviderTokenRepository";

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
});
