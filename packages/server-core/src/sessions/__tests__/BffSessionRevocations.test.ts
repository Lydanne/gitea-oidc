import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSessionStore, DistributedAdminSessionStore } from "../../admin/AdminSessionStore.js";
import {
  DistributedPortalSessionStore,
  PortalSessionStore,
} from "../../portal/PortalSessionStore.js";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import { BffSessionRevokedError, MemoryBffSessionRevocations } from "../BffSessionRevocations.js";

const backends: MemoryStateStore[] = [];
afterEach(() => {
  for (const store of backends.splice(0)) store.destroy();
  vi.restoreAllMocks();
});

function sharedStore() {
  const store = new MemoryStateStore();
  backends.push(store);
  return store;
}

for (const [name, SessionStore] of [
  ["admin", AdminSessionStore],
  ["portal", PortalSessionStore],
] as const) {
  describe(`${name} memory session lifecycle`, () => {
    it("撤销后恢复同一用户不会恢复旧会话或已开始的回调", () => {
      const store = new SessionStore(60);
      const first = store.createSession("user-1");
      const second = store.createSession("user-1");
      const other = store.createSession("user-2");
      const pendingLogin = store.captureLoginGeneration();
      store.blockUserSessions("user-1").commit();
      expect(store.getSession(first.id)).toBeNull();
      expect(() => store.createSession("user-1")).toThrow(BffSessionRevokedError);
      store.allowUserSessions("user-1");
      expect(store.getSession(second.id)).toBeNull();
      expect(store.getSession(other.id)).not.toBeNull();
      expect(() => store.createSession("user-1", pendingLogin)).toThrow(BffSessionRevokedError);
      expect(store.getSession(store.createSession("user-1").id)).not.toBeNull();
    });
  });
}

it("内存后台与门户共享撤销代际且过时租约不能解除新的停用", () => {
  const revocations = new MemoryBffSessionRevocations(60);
  const admin = new AdminSessionStore(
    60,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    revocations,
  );
  const portal = new PortalSessionStore(
    60,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    revocations,
  );
  const adminSession = admin.createSession("user-1");
  const portalSession = portal.createSession("user-1");
  const first = admin.blockUserSessions("user-1");
  const second = admin.blockUserSessions("user-1");
  first.release();
  expect(() => portal.createSession("user-1")).toThrow(BffSessionRevokedError);
  second.release();
  expect(admin.getSession(adminSession.id)).toBeNull();
  expect(portal.getSession(portalSession.id)).toBeNull();
  expect(portal.createSession("user-1")).toBeDefined();
});

for (const [name, SessionStore] of [
  ["admin", DistributedAdminSessionStore],
  ["portal", DistributedPortalSessionStore],
] as const) {
  describe(`${name} distributed session lifecycle`, () => {
    it("跨实例撤销、恢复及重新构造存储都不会恢复旧会话", async () => {
      const shared = sharedStore();
      const first = new SessionStore(shared, 60);
      const second = new SessionStore(shared, 60);
      const session = await first.createSession("user-1");
      const oldLogin = await second.captureLoginGeneration();
      await (await second.blockUserSessions("user-1")).commit();
      await second.allowUserSessions("user-1");
      const restarted = new SessionStore(shared, 60);
      expect(await restarted.getSession(session.id)).toBeNull();
      await expect(first.createSession("user-1", oldLogin)).rejects.toThrow(BffSessionRevokedError);
      const fresh = await restarted.createSession("user-1");
      expect(await first.getSession(fresh.id)).not.toBeNull();
    });

    it("撤销标记丢失后重建随机代际，旧 cookie 始终失效", async () => {
      const shared = sharedStore();
      const first = new SessionStore(shared, 60);
      const session = await first.createSession("user-1");
      await shared.delete("bff:user-generation:user-1");
      const second = new SessionStore(shared, 60);
      expect(await second.getSession(session.id)).toBeNull();
      const fresh = await second.createSession("user-1");
      expect(fresh.generation).not.toBe(session.generation);
      expect(await first.getSession(session.id)).toBeNull();
      expect(await first.getSession(fresh.id)).not.toBeNull();
    });

    it("会话写入期间发生撤销重建时拒绝旧回调并清理临时会话", async () => {
      const shared = sharedStore();
      const first = new SessionStore(shared, 60);
      const second = new SessionStore(shared, 60);
      let writeStarted!: () => void;
      let finishWrite!: () => void;
      const started = new Promise<void>((resolve) => {
        writeStarted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      const original = shared.set.bind(shared);
      vi.spyOn(shared, "set").mockImplementationOnce(async (key, value, ttl) => {
        writeStarted();
        await gate;
        await original(key, value, ttl);
      });
      const pending = first.createSession("user-1");
      const rejected = expect(pending).rejects.toThrow(BffSessionRevokedError);
      await started;
      await (await second.blockUserSessions("user-1")).commit();
      await second.allowUserSessions("user-1");
      finishWrite();
      await rejected;
      expect(shared.getStats().size).not.toBe(0);
    });

    it("并发撤销中一个失败回滚和恢复操作不能清除另一个进行中的阻断", async () => {
      const shared = sharedStore();
      const first = new SessionStore(shared, 60);
      const second = new SessionStore(shared, 60);
      const old = await first.createSession("user-1");
      const leaseA = await first.blockUserSessions("user-1");
      const leaseB = await second.blockUserSessions("user-1");
      await leaseB.release();
      await second.allowUserSessions("user-1");
      await expect(second.createSession("user-1")).rejects.toThrow(BffSessionRevokedError);
      await leaseA.commit();
      await second.allowUserSessions("user-1");
      expect(await second.getSession(old.id)).toBeNull();
      expect(await second.createSession("user-1")).toBeDefined();
    });

    it("自定义共享存储缺少 CAS 能力时明确拒绝初始化", () => {
      expect(() => new SessionStore({} as any, 60)).toThrow("StateStore.compareAndSet");
    });
  });
}
