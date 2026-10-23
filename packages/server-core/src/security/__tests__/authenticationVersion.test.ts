import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemorySecurityRepository,
  newSecurityRecord,
  SqliteSecurityRepository,
} from "../SecurityRepository.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

for (const backend of ["memory", "sqlite"] as const) {
  describe(`${backend} 认证策略顺序时钟`, () => {
    it("策略与时钟原子提交，CAS 冲突不推进时钟，正常消费不撤销登录", async () => {
      const dir = await mkdtemp(join(tmpdir(), "x-oidc-policy-"));
      const repo =
        backend === "memory"
          ? new MemorySecurityRepository()
          : new SqliteSecurityRepository(join(dir, "security.db"), "K".repeat(32));
      cleanup.push(async () => {
        await repo.close();
        await rm(dir, { recursive: true, force: true });
      });
      const first = newSecurityRecord("alice-id", "alice");
      expect(await repo.captureAuthenticationVersion()).toBe(0);
      expect(await repo.compareAndSet("alice", null, first, true)).toBe(true);
      expect((await repo.get("alice"))?.authenticationVersion).toBe(1);
      expect(await repo.captureAuthenticationVersion()).toBe(1);
      expect(
        await repo.compareAndSet("alice", "stale", { ...first, revision: "stale-write" }, true),
      ).toBe(false);
      expect(await repo.captureAuthenticationVersion()).toBe(1);
      expect((await repo.get("alice"))?.revision).toBe(first.revision);
      const consumed = { ...first, revision: "counter-update", totpLastCounter: 123 };
      expect(await repo.compareAndSet("alice", first.revision, consumed)).toBe(true);
      expect(await repo.captureAuthenticationVersion()).toBe(1);
      expect((await repo.get("alice"))?.authenticationVersion).toBe(1);
      const bob = newSecurityRecord("bob-id", "bob");
      expect(await repo.compareAndSet("bob", null, bob, true)).toBe(true);
      expect(await repo.captureAuthenticationVersion()).toBe(2);
      expect((await repo.get("alice"))?.authenticationVersion).toBe(1);
    });
  });
}

it("SQLite 重启与多连接共享策略版本，旧连接不能读到回退的时钟", async () => {
  const dir = await mkdtemp(join(tmpdir(), "x-oidc-policy-restart-"));
  const path = join(dir, "security.db");
  const first = new SqliteSecurityRepository(path, "K".repeat(32));
  const second = new SqliteSecurityRepository(path, "K".repeat(32));
  cleanup.push(async () => {
    await first.close();
    await second.close();
    await rm(dir, { recursive: true, force: true });
  });
  await first.compareAndSet("alice", null, newSecurityRecord("alice", "alice"), true);
  expect(await second.captureAuthenticationVersion()).toBe(1);
  expect((await second.get("alice"))?.authenticationVersion).toBe(1);
  await second.compareAndSet("bob", null, newSecurityRecord("bob", "bob"), true);
  expect(await first.captureAuthenticationVersion()).toBe(2);
});
