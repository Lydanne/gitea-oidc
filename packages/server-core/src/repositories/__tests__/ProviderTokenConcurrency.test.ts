import { afterEach, describe, expect, it } from "vitest";
import type { ProviderTokenRepository } from "../../types/providerApi.js";
import { MemoryProviderTokenRepository } from "../MemoryProviderTokenRepository.js";
import { SqliteProviderTokenRepository } from "../SqliteProviderTokenRepository.js";

describe.each(["memory", "sqlite"])("%s Provider token 原子版本契约", (backend) => {
  let repository: ProviderTokenRepository;
  afterEach(async () => {
    await repository?.close?.();
  });
  const create = () => {
    repository =
      backend === "memory"
        ? new MemoryProviderTokenRepository()
        : new SqliteProviderTokenRepository(":memory:", "A".repeat(32));
  };
  const token = {
    provider: "feishu",
    ownerType: "user" as const,
    ownerId: "u1",
    accessToken: "old",
    refreshToken: "refresh",
    status: "valid" as const,
  };
  it("同一版本的并发刷新只能提交一次", async () => {
    create();
    const original = await repository.upsert(token);
    const results = await Promise.all([
      repository.compareAndSwap({ ...original, accessToken: "a" }, original.revision!),
      repository.compareAndSwap({ ...original, accessToken: "b" }, original.revision!),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)?.revision).not.toBe(original.revision);
  });
  it.each(["delete", "revoke", "recreate"])("%s 后旧版本不能提交或重新创建", async (mutation) => {
    create();
    const original = await repository.upsert(token);
    if (mutation === "revoke") await repository.updateStatus("feishu", "user", "u1", "revoked");
    else {
      await repository.deleteByOwnerId("u1");
      if (mutation === "recreate") await repository.upsert(token);
    }
    expect(
      await repository.compareAndSwap({ ...original, accessToken: "late" }, original.revision!),
    ).toBeNull();
    const found = await repository.find("feishu", "user", "u1");
    expect(found?.accessToken).not.toBe("late");
    if (mutation === "revoke") expect(found?.status).toBe("revoked");
    if (mutation === "delete") expect(found).toBeNull();
  });
  it("健康状态变化不使正在进行的凭证刷新失效，旧状态不能覆盖新凭证", async () => {
    create();
    const original = await repository.upsert(token);
    await repository.updateStatus("feishu", "user", "u1", "unknown", undefined, original.revision!);
    const refreshed = await repository.compareAndSwap(
      { ...original, accessToken: "new" },
      original.revision!,
    );
    expect(refreshed?.accessToken).toBe("new");
    await repository.updateStatus(
      "feishu",
      "user",
      "u1",
      "refresh_failed",
      "stale failure",
      original.revision!,
    );
    expect((await repository.find("feishu", "user", "u1"))?.status).toBe("valid");
  });
});
