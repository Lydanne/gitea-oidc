import { afterEach, describe, expect, it } from "vitest";
import type { AuditLogRepository } from "../../types/audit.js";
import { MemoryAuditLogRepository } from "../MemoryAuditLogRepository.js";
import { RetainedAuditLogRepository } from "../RetainedAuditLogRepository.js";
import { SqliteAuditLogRepository } from "../SqliteAuditLogRepository.js";

describe.each([
  ["memory", () => new MemoryAuditLogRepository()],
  ["sqlite", () => new SqliteAuditLogRepository(":memory:")],
] as const)("%s audit log repository", (_name, createRepository) => {
  let repository: AuditLogRepository | undefined;

  afterEach(async () => {
    await repository?.close?.();
    repository = undefined;
  });

  it("按目标用户或操作用户筛选并返回分页总数", async () => {
    repository = createRepository();
    await repository.append({
      eventType: "user.updated",
      outcome: "success",
      source: "admin",
      userId: "user-1",
      actorUserId: "admin-1",
      changedFields: ["email", "groups", "email"],
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    await repository.append({
      eventType: "admin.logout",
      outcome: "success",
      source: "admin",
      userId: "admin-1",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await repository.append({
      eventType: "user.login",
      outcome: "failure",
      source: "provider",
      username: "unknown",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const byTarget = await repository.list({ userId: "user-1" });
    const byActor = await repository.list({ userId: "admin-1", limit: 1 });

    expect(byTarget).toHaveLength(1);
    expect(byTarget[0]).toMatchObject({
      eventType: "user.updated",
      changedFields: ["email", "groups"],
    });
    expect(byActor).toHaveLength(1);
    expect(byActor[0].eventType).toBe("admin.logout");
    expect(await repository.count({ userId: "admin-1" })).toBe(2);
  });

  it("组合事件、结果和时间范围筛选", async () => {
    repository = createRepository();
    await repository.append({
      eventType: "user.login",
      outcome: "failure",
      source: "provider",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await repository.append({
      eventType: "user.login",
      outcome: "success",
      source: "provider",
      createdAt: new Date("2026-02-02T00:00:00.000Z"),
    });

    const records = await repository.list({
      eventType: "user.login",
      outcome: "success",
      from: new Date("2026-02-01T12:00:00.000Z"),
      to: new Date("2026-02-02T12:00:00.000Z"),
    });

    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe("success");
  });

  it("删除保留期之前的记录", async () => {
    repository = createRepository();
    await repository.append({
      eventType: "user.login",
      outcome: "success",
      source: "provider",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await repository.append({
      eventType: "user.logout",
      outcome: "success",
      source: "oidc",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(await repository.deleteOlderThan(new Date("2025-06-01T00:00:00.000Z"))).toBe(1);
    expect(await repository.count()).toBe(1);
  });
});

describe("RetainedAuditLogRepository", () => {
  it("首次写入后按配置保留期清理旧记录", async () => {
    const delegate = new MemoryAuditLogRepository();
    await delegate.append({
      eventType: "user.login",
      outcome: "success",
      source: "provider",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await delegate.append({
      eventType: "user.updated",
      outcome: "success",
      source: "admin",
      createdAt: new Date("2026-01-30T00:00:00.000Z"),
    });
    const repository = new RetainedAuditLogRepository(delegate, 30);

    await repository.append({
      eventType: "user.logout",
      outcome: "success",
      source: "oidc",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(await repository.count()).toBe(2);
    expect((await repository.list()).map((record) => record.eventType)).toEqual([
      "user.logout",
      "user.updated",
    ]);
  });
});
