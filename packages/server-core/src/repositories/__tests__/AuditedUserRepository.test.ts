import { beforeEach, describe, expect, it } from "vitest";
import type { UserInfo } from "../../types/auth.js";
import { AuditedUserRepository } from "../AuditedUserRepository.js";
import { MemoryAuditLogRepository } from "../MemoryAuditLogRepository.js";
import { MemoryUserRepository } from "../MemoryUserRepository.js";

describe("AuditedUserRepository", () => {
  let auditRepository: MemoryAuditLogRepository;
  let repository: AuditedUserRepository;

  const providerUser: Omit<
    UserInfo,
    "id" | "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider"
  > = {
    username: "alice",
    name: "Alice",
    email: "alice@example.com",
    groups: [{ id: "engineering", name: "研发中心" }],
    status: "active",
  };

  beforeEach(() => {
    auditRepository = new MemoryAuditLogRepository();
    repository = new AuditedUserRepository(new MemoryUserRepository(), auditRepository);
  });

  it("记录 Provider 首次同步创建和后续字段更新", async () => {
    const created = await repository.findOrCreate("feishu", "ou_1", providerUser);
    await repository.findOrCreate("feishu", "ou_1", {
      ...providerUser,
      name: "Confidential Updated Name",
      groups: [{ id: "platform", name: "平台组" }],
    });

    const records = await auditRepository.list();
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.eventType === "user.created")).toMatchObject({
      eventType: "user.created",
      source: "provider",
      userId: created.sub,
    });
    const updated = records.find((record) => record.eventType === "user.updated");
    expect(updated).toMatchObject({
      eventType: "user.updated",
      source: "provider",
      changedFields: ["name", "groups"],
    });
    expect(JSON.stringify(updated)).not.toContain("Confidential Updated Name");
    expect(JSON.stringify(updated)).not.toContain("平台组");
  });

  it("并发首次登录只记录一次用户创建", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.findOrCreate("feishu", "ou_concurrent", providerUser),
      ),
    );

    const records = await auditRepository.list();
    expect(records.filter((record) => record.eventType === "user.created")).toHaveLength(1);
  });

  it("只更新时间戳时不产生用户资料更新事件", async () => {
    const user = await repository.findOrCreate("local", "alice", providerUser);
    const before = await auditRepository.count();

    await repository.update(user.sub, { lastLoginAt: new Date("2026-03-01T00:00:00.000Z") });

    expect(await auditRepository.count()).toBe(before);
  });

  it("记录管理员、状态迁移和删除操作", async () => {
    const user = await repository.findOrCreate("local", "alice", providerUser);
    const context = { source: "admin" as const, actorUserId: "admin-1" };
    await repository.update(
      user.sub,
      { status: "disabled", email: "private@example.com" },
      context,
    );
    await repository.delete(user.sub, context);

    const records = await auditRepository.list({ userId: user.sub });
    const updated = records.find((record) => record.eventType === "user.updated");
    const deleted = records.find((record) => record.eventType === "user.deleted");
    expect(updated).toMatchObject({
      source: "admin",
      actorUserId: "admin-1",
      changedFields: ["email", "status"],
      statusFrom: "active",
      statusTo: "disabled",
    });
    expect(JSON.stringify(updated)).not.toContain("private@example.com");
    expect(deleted).toMatchObject({
      source: "admin",
      actorUserId: "admin-1",
      userId: user.sub,
    });
  });

  it("并发状态更新按仓储实际写入顺序记录迁移", async () => {
    const user = await repository.findOrCreate("local", "alice", providerUser);
    await Promise.all([
      repository.update(user.sub, { status: "disabled" }),
      repository.update(user.sub, { status: "locked" }),
    ]);

    const transitions = (await auditRepository.list({ userId: user.sub }))
      .filter((record) => record.eventType === "user.updated")
      .map((record) => [record.statusFrom, record.statusTo]);
    expect(transitions).toHaveLength(2);
    expect(transitions).toEqual(
      expect.arrayContaining([
        ["active", "disabled"],
        ["disabled", "locked"],
      ]),
    );
  });
});
