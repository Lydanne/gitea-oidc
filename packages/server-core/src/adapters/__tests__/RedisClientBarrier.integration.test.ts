import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OidcAdapterFactory as Factory } from "../OidcAdapterFactory.js";

// 指定独立 Redis 测试库后运行，实际执行 Lua 并模拟两个不共享进程内状态的实例。
describe.skipIf(!process.env.REDIS_TEST_URL)("Redis Client 跨实例栅栏", () => {
  const factories: (typeof Factory)[] = [];
  afterEach(async () => {
    for (const factory of factories.splice(0)) await factory.cleanup();
  });
  const setup = async () => {
    const prefix = `review:${randomUUID()}:`;
    const config = {
      type: "redis" as const,
      redis: { url: process.env.REDIS_TEST_URL, keyPrefix: prefix },
    };
    const a = (await import("../OidcAdapterFactory.js")).OidcAdapterFactory;
    a.configure(config);
    factories.push(a);
    vi.resetModules();
    const b = (await import("../OidcAdapterFactory.js")).OidcAdapterFactory;
    b.configure(config);
    factories.push(b);
    return { a, b };
  };
  it("跨实例阻止迟到写入，撤销旧记录，重新启用后两端都可写入", async () => {
    const { a, b } = await setup();
    const writer = b.create("RefreshToken")!;
    await writer.upsert("old", { accountId: "u1", clientId: "c1" }, 60);
    const lease = await a.acquireClientIdBlock("c1");
    for (const payload of [
      { clientId: "c1" },
      { client_id: "c1" },
      { params: { client_id: "c1" } },
      { accountId: "u1", clientId: "c1" },
    ]) {
      await expect(writer.upsert("late", payload, 60)).rejects.toMatchObject({
        code: "OIDC_CLIENT_REVOKED",
      });
    }
    await writer.upsert("other", { clientId: "c2" }, 60);
    await lease.commit();
    await a.revokeByClientId("c1");
    expect(await writer.find("old")).toBeUndefined();
    expect(await writer.find("other")).toBeTruthy();
    await expect(writer.upsert("late", { clientId: "c1" }, 60)).rejects.toMatchObject({
      code: "OIDC_CLIENT_REVOKED",
    });
    await b.allowClientId("c1");
    await a.create("RefreshToken")!.upsert("a-new", { clientId: "c1" }, 60);
    await writer.upsert("b-new", { accountId: "u1", clientId: "c1" }, 60);
    expect(await writer.find("old")).toBeUndefined();
    await a.revokeByClientId("c1");
    await a.revokeByClientId("c2");
    await b.allowClientId("c1");
    await b.allowClientId("c2");
  });
  it("释放单个失败操作不会解除其他操作的租约", async () => {
    const { a, b } = await setup();
    const writer = b.create("AuthorizationCode")!;
    const first = await a.acquireClientIdBlock("c1");
    const second = await a.acquireClientIdBlock("c1");
    await first.release();
    await b.allowClientId("c1");
    await expect(writer.upsert("late", { params: { client_id: "c1" } }, 60)).rejects.toMatchObject({
      code: "OIDC_CLIENT_REVOKED",
    });
    await second.release();
    await writer.upsert("allowed", { clientId: "c1" }, 60);
    await a.revokeByClientId("c1");
    await b.allowClientId("c1");
  });
});
