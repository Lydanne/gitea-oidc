import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DistributedAdminSessionStore } from "../../admin/AdminSessionStore.js";
import { DistributedPortalSessionStore } from "../../portal/PortalSessionStore.js";
import { RedisStateStore } from "../../stores/RedisStateStore.js";
import { BffSessionRevokedError } from "../BffSessionRevocations.js";

describe.skipIf(!process.env.REDIS_TEST_URL)("Redis BFF 跨实例代际", () => {
  it("原子初始化只有一个胜者，后台撤销同时阻断其它实例门户 cookie 和旧回调", async () => {
    const prefix = `x-oidc:bff-test:${randomUUID()}:`;
    const first = new RedisStateStore({ url: process.env.REDIS_TEST_URL }, prefix);
    const second = new RedisStateStore({ url: process.env.REDIS_TEST_URL }, prefix);
    try {
      const winners = await Promise.all([
        first.compareAndSet("cas", null, { generation: "one" }, 60),
        second.compareAndSet("cas", null, { generation: "two" }, 60),
      ]);
      expect(winners.filter(Boolean)).toHaveLength(1);
      const expected = await first.get("cas");
      expect(await second.compareAndSet("cas", { generation: "wrong" }, {}, 60)).toBe(false);
      expect(await first.get("cas")).toEqual(expected);

      const admin = new DistributedAdminSessionStore(first, 60);
      const portal = new DistributedPortalSessionStore(second, 60);
      const adminSession = await admin.createSession("user-1");
      const portalSession = await portal.createSession("user-1");
      const callback = await portal.captureLoginGeneration();
      await (await admin.blockUserSessions("user-1")).commit();
      await admin.allowUserSessions("user-1");
      expect(await admin.getSession(adminSession.id)).toBeNull();
      expect(await portal.getSession(portalSession.id)).toBeNull();
      await expect(portal.createSession("user-1", callback)).rejects.toThrow(
        BffSessionRevokedError,
      );
      const fresh = await portal.createSession("user-1");
      const restarted = new DistributedPortalSessionStore(first, 60);
      expect(await restarted.getSession(fresh.id)).not.toBeNull();
      await first.delete("bff:user-generation:user-1");
      expect(await portal.getSession(fresh.id)).toBeNull();
      const recreated = await restarted.createSession("user-1");
      expect(recreated.generation).not.toBe(fresh.generation);
      expect(await portal.getSession(fresh.id)).toBeNull();
    } finally {
      await first.destroy();
      await second.destroy();
    }
  });
});
