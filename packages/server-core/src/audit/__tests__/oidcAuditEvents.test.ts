import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { MemoryAuditLogRepository } from "../../repositories/MemoryAuditLogRepository.js";
import { registerOidcAuditEvents } from "../oidcAuditEvents.js";

describe("registerOidcAuditEvents", () => {
  it("仅在 OIDC 授权最终成功后记录登录并更新最近登录时间", async () => {
    const provider = new EventEmitter();
    const repository = new MemoryAuditLogRepository();
    const userRepository = {
      findById: vi.fn().mockResolvedValue({
        sub: "user-1",
        username: "alice",
        authProvider: "feishu",
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    registerOidcAuditEvents(provider as never, repository, userRepository as never);

    provider.emit("authorization.success", {
      ip: "203.0.113.10",
      headers: { "user-agent": "Audit Test" },
      oidc: {
        session: { accountId: "user-1" },
        client: { clientId: "gitea" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(userRepository.update).toHaveBeenCalledWith("user-1", {
      lastLoginAt: expect.any(Date),
    });
    expect(await repository.list()).toEqual([
      expect.objectContaining({
        eventType: "user.login",
        outcome: "success",
        source: "oidc",
        userId: "user-1",
        username: "alice",
        provider: "feishu",
        clientId: "gitea",
      }),
    ]);
  });

  it("缺少账户或客户端标识时不写入登录记录", async () => {
    const provider = new EventEmitter();
    const repository = new MemoryAuditLogRepository();
    registerOidcAuditEvents(provider as never, repository);

    provider.emit("authorization.success", { oidc: { session: { accountId: "user-1" } } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(await repository.count()).toBe(0);
  });

  it("在 OIDC 会话成功结束后记录退出事件", async () => {
    const provider = new EventEmitter();
    const repository = new MemoryAuditLogRepository();
    registerOidcAuditEvents(provider as never, repository);

    provider.emit("end_session.success", {
      ip: "203.0.113.10",
      headers: { "user-agent": "Audit Test" },
      oidc: {
        session: { accountId: "user-1", state: { clientId: "fallback-client" } },
        client: { clientId: "gitea" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(await repository.list()).toEqual([
      expect.objectContaining({
        eventType: "user.logout",
        outcome: "success",
        source: "oidc",
        userId: "user-1",
        clientId: "gitea",
        ipAddress: "203.0.113.10",
        userAgent: "Audit Test",
      }),
    ]);
  });

  it("缺少账户标识时不写入退出记录", async () => {
    const provider = new EventEmitter();
    const repository = new MemoryAuditLogRepository();
    registerOidcAuditEvents(provider as never, repository);

    provider.emit("end_session.success", { oidc: { session: {} } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(await repository.count()).toBe(0);
  });
});
