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
});
