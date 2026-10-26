import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PgsqlProviderTokenRepository } from "../PgsqlProviderTokenRepository.js";

// 使用独立测试库；两个连接池验证条件更新在数据库内生效。
describe.skipIf(!process.env.PGSQL_TEST_URL)("PostgreSQL Provider token 跨实例版本", () => {
  it("并发替换仅一次成功，删除、重建与撤销均使旧版本失效", async () => {
    const a = new PgsqlProviderTokenRepository(process.env.PGSQL_TEST_URL!, "A".repeat(32));
    await a.list({ limit: 1 });
    const b = new PgsqlProviderTokenRepository(process.env.PGSQL_TEST_URL!, "A".repeat(32));
    const ownerId = randomUUID();
    const token = {
      provider: "feishu",
      ownerType: "user" as const,
      ownerId,
      accessToken: "original",
      status: "valid" as const,
    };
    try {
      const original = await a.upsert(token);
      await b.updateStatus("feishu", "user", ownerId, "unknown", undefined, original.revision!);
      const results = await Promise.all([
        a.compareAndSwap({ ...original, accessToken: "a" }, original.revision!),
        b.compareAndSwap({ ...original, accessToken: "b" }, original.revision!),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      await b.updateStatus(
        "feishu",
        "user",
        ownerId,
        "refresh_failed",
        "stale",
        original.revision!,
      );
      expect((await a.find("feishu", "user", ownerId))?.status).toBe("valid");
      const beforeDelete = (await a.find("feishu", "user", ownerId))!;
      await b.deleteByOwnerId(ownerId);
      expect(
        await a.compareAndSwap({ ...beforeDelete, accessToken: "late" }, beforeDelete.revision!),
      ).toBeNull();
      await b.upsert(token);
      expect(
        await a.compareAndSwap({ ...beforeDelete, accessToken: "late" }, beforeDelete.revision!),
      ).toBeNull();
      const beforeRevoke = (await a.find("feishu", "user", ownerId))!;
      await b.updateStatus("feishu", "user", ownerId, "revoked");
      expect(
        await a.compareAndSwap({ ...beforeRevoke, accessToken: "late" }, beforeRevoke.revision!),
      ).toBeNull();
      expect((await a.find("feishu", "user", ownerId))?.status).toBe("revoked");
    } finally {
      await a.deleteByOwnerId(ownerId);
      await a.close();
      await b.close();
    }
  });
});
