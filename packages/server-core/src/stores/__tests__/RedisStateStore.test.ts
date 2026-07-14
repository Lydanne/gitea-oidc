import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedisStateStore } from "../RedisStateStore.js";

const redisMocks = vi.hoisted(() => ({
  client: {
    connect: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    isOpen: true,
    quit: vi.fn().mockResolvedValue(undefined),
    setEx: vi.fn().mockResolvedValue("OK"),
  },
}));

vi.mock("redis", () => ({
  createClient: vi.fn(() => redisMocks.client),
}));

describe("RedisStateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.client.eval.mockResolvedValue(1);
  });

  it("使用单个 Redis 脚本原子递增并刷新 TTL", async () => {
    const store = new RedisStateStore({ url: "redis://localhost:6379" }, "gitea-oidc:test-state:");
    redisMocks.client.eval.mockResolvedValue(3);

    await expect(store.increment("login-failure", 60)).resolves.toBe(3);
    expect(redisMocks.client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      {
        keys: ["gitea-oidc:test-state:login-failure"],
        arguments: ["60"],
      },
    );
  });

  it("原子清理并在有容量时写入 state", async () => {
    const store = new RedisStateStore({ url: "redis://localhost:6379" }, "gitea-oidc:test-state:");

    await expect(
      store.setBounded(
        "admin:login-state:state-1",
        { returnTo: "/admin/users" },
        600,
        "admin:login-states",
        1000,
      ),
    ).resolves.toBe(true);

    expect(redisMocks.client.eval).toHaveBeenCalledWith(
      expect.stringMatching(/ZRANGEBYSCORE[\s\S]*ZCARD[\s\S]*return 0[\s\S]*ZADD/),
      {
        keys: [
          "gitea-oidc:test-state:admin:login-state:state-1",
          "gitea-oidc:test-state:admin:login-states",
        ],
        arguments: [
          expect.any(String),
          expect.any(String),
          "600",
          "1000",
          JSON.stringify({ returnTo: "/admin/users" }),
        ],
      },
    );
  });

  it("集合已满时拒绝新 state 且不删除已有事务", async () => {
    const store = new RedisStateStore({ url: "redis://localhost:6379" }, "gitea-oidc:test-state:");
    redisMocks.client.eval.mockResolvedValue(0);

    await expect(
      store.setBounded(
        "admin:login-state:state-2",
        { returnTo: "/admin/users" },
        600,
        "admin:login-states",
        1000,
      ),
    ).resolves.toBe(false);
    expect(redisMocks.client.eval.mock.calls[0][0]).not.toContain("ZRANGE', KEYS[2], 0");
  });

  it("消费有界 state 时原子移除容量索引成员", async () => {
    const store = new RedisStateStore({ url: "redis://localhost:6379" }, "gitea-oidc:test-state:");
    redisMocks.client.eval.mockResolvedValue(JSON.stringify({ returnTo: "/admin/users" }));

    await expect(store.take("admin:login-state:state-1", "admin:login-states")).resolves.toEqual({
      returnTo: "/admin/users",
    });
    expect(redisMocks.client.eval).toHaveBeenCalledWith(expect.stringContaining("ZREM"), {
      keys: [
        "gitea-oidc:test-state:admin:login-state:state-1",
        "gitea-oidc:test-state:admin:login-states",
      ],
      arguments: [],
    });
  });
});
