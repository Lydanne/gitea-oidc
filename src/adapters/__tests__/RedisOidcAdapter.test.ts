/**
 * RedisOidcAdapter 单元测试
 *
 * 测试 Redis OIDC 适配器的所有功能
 * 使用 mock 避免依赖真实的 Redis 服务器
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisOidcAdapter, type RedisOidcAdapterOptions } from "../RedisOidcAdapter";

// Mock redis 模块
vi.mock("redis", () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
    setEx: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    expire: vi.fn().mockResolvedValue(1),
    sAdd: vi.fn().mockResolvedValue(1),
    sRem: vi.fn().mockResolvedValue(1),
    sMembers: vi.fn().mockResolvedValue([]),
    multi: vi.fn().mockReturnValue({
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
  };

  return {
    createClient: vi.fn(() => mockClient),
  };
});

describe("RedisOidcAdapter", () => {
  let adapter: RedisOidcAdapter;
  let mockClient: any;

  beforeEach(async () => {
    // 重置所有 mock
    vi.clearAllMocks();

    // 获取 mock 的 Redis 客户端
    const { createClient } = await import("redis");
    mockClient = (createClient as any)();

    // 创建适配器实例
    const options: RedisOidcAdapterOptions = {
      url: "redis://localhost:6379",
      keyPrefix: "test:",
    };

    adapter = new RedisOidcAdapter("Session", options);

    // 等待客户端初始化
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  afterEach(async () => {
    await RedisOidcAdapter.disconnect();
  });

  describe("constructor", () => {
    it("应该创建适配器实例", () => {
      expect(adapter).toBeDefined();
    });

    it("应该使用默认配置", () => {
      const defaultAdapter = new RedisOidcAdapter("Session");
      expect(defaultAdapter).toBeDefined();
    });

    it("应该使用自定义配置", () => {
      const options: RedisOidcAdapterOptions = {
        host: "custom-host",
        port: 6380,
        password: "password",
        database: 1,
        keyPrefix: "custom:",
      };

      const customAdapter = new RedisOidcAdapter("Session", options);
      expect(customAdapter).toBeDefined();
    });
  });

  describe("upsert", () => {
    it("应该插入新记录", async () => {
      const id = "test-id-1";
      const payload = { userId: "user123", data: "test data" };

      await adapter.upsert(id, payload);

      expect(mockClient.set).toHaveBeenCalledWith(
        "test:Session:test-id-1",
        JSON.stringify(payload),
      );
    });

    it("应该插入带过期时间的记录", async () => {
      const id = "test-id-2";
      const payload = { userId: "user123" };
      const expiresIn = 3600;

      await adapter.upsert(id, payload, expiresIn);

      expect(mockClient.setEx).toHaveBeenCalledWith(
        "test:Session:test-id-2",
        expiresIn,
        JSON.stringify(payload),
      );
    });

    it("应该创建 userCode 索引", async () => {
      const id = "test-id-3";
      const payload = { userCode: "USER-CODE-123", userId: "user123" };

      await adapter.upsert(id, payload);

      expect(mockClient.set).toHaveBeenCalledWith("test:userCode:USER-CODE-123", id);
    });

    it("应该创建 uid 索引", async () => {
      const id = "test-id-4";
      const payload = { uid: "UID-123", userId: "user123" };

      await adapter.upsert(id, payload);

      expect(mockClient.set).toHaveBeenCalledWith("test:uid:UID-123", id);
    });

    it("应该创建 grantId 索引", async () => {
      const id = "test-id-5";
      const payload = { grantId: "grant-123", userId: "user123" };

      await adapter.upsert(id, payload);

      expect(mockClient.sAdd).toHaveBeenCalledWith("test:grantId:grant-123", id);
    });

    it("应该为索引设置过期时间", async () => {
      const id = "test-id-6";
      const payload = {
        userCode: "USER-CODE-456",
        uid: "UID-456",
        grantId: "grant-456",
      };
      const expiresIn = 600;

      await adapter.upsert(id, payload, expiresIn);

      expect(mockClient.setEx).toHaveBeenCalledWith("test:userCode:USER-CODE-456", expiresIn, id);
      expect(mockClient.setEx).toHaveBeenCalledWith("test:uid:UID-456", expiresIn, id);
      expect(mockClient.expire).toHaveBeenCalledWith("test:grantId:grant-456", expiresIn);
    });
  });

  describe("find", () => {
    it("应该找到已存储的记录", async () => {
      const id = "test-id-7";
      const payload = { userId: "user123" };

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));

      const result = await adapter.find(id);

      expect(mockClient.get).toHaveBeenCalledWith("test:Session:test-id-7");
      expect(result).toEqual(payload);
    });

    it("应该返回 undefined 当记录不存在时", async () => {
      mockClient.get.mockResolvedValueOnce(null);

      const result = await adapter.find("non-existent-id");

      expect(result).toBeUndefined();
    });

    it("应该处理 JSON 解析错误", async () => {
      mockClient.get.mockResolvedValueOnce("invalid json");

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await adapter.find("test-id-8");

      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("findByUserCode", () => {
    it("应该通过 userCode 找到记录", async () => {
      const userCode = "USER-CODE-789";
      const id = "test-id-9";
      const payload = { userCode, userId: "user123" };

      mockClient.get.mockResolvedValueOnce(id).mockResolvedValueOnce(JSON.stringify(payload));

      const result = await adapter.findByUserCode(userCode);

      expect(mockClient.get).toHaveBeenCalledWith("test:userCode:USER-CODE-789");
      expect(result).toEqual(payload);
    });

    it("应该返回 undefined 当 userCode 不存在时", async () => {
      mockClient.get.mockResolvedValueOnce(null);

      const result = await adapter.findByUserCode("NON-EXISTENT-CODE");

      expect(result).toBeUndefined();
    });
  });

  describe("findByUid", () => {
    it("应该通过 uid 找到记录", async () => {
      const uid = "UID-789";
      const id = "test-id-10";
      const payload = { uid, userId: "user123" };

      mockClient.get.mockResolvedValueOnce(id).mockResolvedValueOnce(JSON.stringify(payload));

      const result = await adapter.findByUid(uid);

      expect(mockClient.get).toHaveBeenCalledWith("test:uid:UID-789");
      expect(result).toEqual(payload);
    });

    it("应该返回 undefined 当 uid 不存在时", async () => {
      mockClient.get.mockResolvedValueOnce(null);

      const result = await adapter.findByUid("NON-EXISTENT-UID");

      expect(result).toBeUndefined();
    });
  });

  describe("consume", () => {
    it("应该消费记录并标记为已消费", async () => {
      const id = "test-id-11";
      const payload = { userId: "user123" };
      const ttl = 300;

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));
      mockClient.ttl.mockResolvedValueOnce(ttl);

      const result = await adapter.consume(id);

      expect(result).toHaveProperty("consumed");
      expect(result.userId).toBe("user123");
      expect(mockClient.setEx).toHaveBeenCalled();
    });

    it("应该返回 undefined 当记录不存在时", async () => {
      mockClient.get.mockResolvedValueOnce(null);

      const result = await adapter.consume("non-existent-id");

      expect(result).toBeUndefined();
    });

    it("应该返回 undefined 当记录已被消费时", async () => {
      const id = "test-id-12";
      const payload = { userId: "user123", consumed: 1234567890 };

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));

      const result = await adapter.consume(id);

      expect(result).toBeUndefined();
    });

    it("应该处理没有 TTL 的记录", async () => {
      const id = "test-id-13";
      const payload = { userId: "user123" };

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));
      mockClient.ttl.mockResolvedValueOnce(-1);

      const result = await adapter.consume(id);

      expect(result).toHaveProperty("consumed");
      expect(mockClient.set).toHaveBeenCalled();
    });

    it("应该处理 JSON 解析错误", async () => {
      mockClient.get.mockResolvedValueOnce("invalid json");

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await adapter.consume("test-id-14");

      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("destroy", () => {
    it("应该删除记录", async () => {
      const id = "test-id-15";
      const payload = { userId: "user123" };

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));

      await adapter.destroy(id);

      expect(mockClient.del).toHaveBeenCalledWith("test:Session:test-id-15");
    });

    it("应该清理 userCode 索引", async () => {
      const id = "test-id-16";
      const payload = { userCode: "USER-CODE-999", userId: "user123" };

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));

      await adapter.destroy(id);

      expect(mockClient.del).toHaveBeenCalledWith("test:userCode:USER-CODE-999");
    });

    it("应该清理 uid 索引", async () => {
      const id = "test-id-17";
      const payload = { uid: "UID-999", userId: "user123" };

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));

      await adapter.destroy(id);

      expect(mockClient.del).toHaveBeenCalledWith("test:uid:UID-999");
    });

    it("应该清理 grantId 索引", async () => {
      const id = "test-id-18";
      const payload = { grantId: "grant-999", userId: "user123" };

      mockClient.get.mockResolvedValueOnce(JSON.stringify(payload));

      await adapter.destroy(id);

      expect(mockClient.sRem).toHaveBeenCalledWith("test:grantId:grant-999", id);
    });

    it("应该处理记录不存在的情况", async () => {
      mockClient.get.mockResolvedValueOnce(null);

      await expect(adapter.destroy("non-existent-id")).resolves.not.toThrow();
    });
  });

  describe("revokeByGrantId", () => {
    it("应该删除指定 grantId 的所有记录", async () => {
      const grantId = "grant-123";
      const ids = ["id-1", "id-2", "id-3"];

      mockClient.sMembers.mockResolvedValueOnce(ids);

      await adapter.revokeByGrantId(grantId);

      expect(mockClient.sMembers).toHaveBeenCalledWith("test:grantId:grant-123");

      const multi = mockClient.multi();
      expect(multi.del).toHaveBeenCalledTimes(4); // 3 个 ID + 1 个 grantId 键
      expect(multi.exec).toHaveBeenCalled();
    });

    it("应该处理空的 grantId", async () => {
      mockClient.sMembers.mockResolvedValueOnce([]);

      await expect(adapter.revokeByGrantId("empty-grant")).resolves.not.toThrow();
    });
  });

  describe("disconnect", () => {
    it("应该断开 Redis 连接", async () => {
      await RedisOidcAdapter.disconnect();

      expect(mockClient.quit).toHaveBeenCalled();
    });

    it("应该处理多次断开调用", async () => {
      await RedisOidcAdapter.disconnect();
      await RedisOidcAdapter.disconnect();

      // 第二次调用不应该报错
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
    });
  });

  describe("键生成", () => {
    it("应该生成正确的主键", async () => {
      const adapter = new RedisOidcAdapter("AccessToken", { keyPrefix: "app:" });
      // 等待客户端初始化
      await new Promise((resolve) => setTimeout(resolve, 10));

      // 通过 upsert 测试键生成
      await adapter.upsert("token-123", { data: "test" });

      expect(mockClient.set).toHaveBeenCalledWith("app:AccessToken:token-123", expect.any(String));
    });

    it("应该生成正确的 userCode 键", async () => {
      const adapter = new RedisOidcAdapter("DeviceCode", { keyPrefix: "dev:" });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await adapter.upsert("device-123", { userCode: "USER-CODE" });

      expect(mockClient.set).toHaveBeenCalledWith("dev:userCode:USER-CODE", "device-123");
    });

    it("应该生成正确的 uid 键", async () => {
      const adapter = new RedisOidcAdapter("Interaction", { keyPrefix: "int:" });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await adapter.upsert("interaction-123", { uid: "UID-123" });

      expect(mockClient.set).toHaveBeenCalledWith("int:uid:UID-123", "interaction-123");
    });

    it("应该生成正确的 grantId 键", async () => {
      const adapter = new RedisOidcAdapter("Grant", { keyPrefix: "grant:" });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await adapter.upsert("grant-123", { grantId: "GRANT-ID" });

      expect(mockClient.sAdd).toHaveBeenCalledWith("grant:grantId:GRANT-ID", "grant-123");
    });
  });

  describe("边界情况", () => {
    it("应该处理空字符串 id", async () => {
      const payload = { userId: "user123" };

      await expect(adapter.upsert("", payload)).resolves.not.toThrow();
    });

    it("应该处理非常长的 id", async () => {
      const longId = "a".repeat(1000);
      const payload = { userId: "user123" };

      await expect(adapter.upsert(longId, payload)).resolves.not.toThrow();
    });

    it("应该处理空对象 payload", async () => {
      const payload = {};

      await expect(adapter.upsert("test-id", payload)).resolves.not.toThrow();
    });

    it("应该处理包含特殊字符的 payload", async () => {
      const payload = {
        text: "Hello \"World\" with 'quotes' and \n newlines",
        json: '{"nested": "json"}',
      };

      await expect(adapter.upsert("test-id", payload)).resolves.not.toThrow();
    });

    it("应该处理 null 值", async () => {
      const payload = {
        nullValue: null,
        userId: "user123",
      };

      await expect(adapter.upsert("test-id", payload)).resolves.not.toThrow();
    });

    it("应该处理复杂的嵌套对象", async () => {
      const payload = {
        nested: {
          deep: {
            value: "test",
            array: [1, 2, 3],
          },
        },
        timestamp: Date.now(),
      };

      await expect(adapter.upsert("test-id", payload)).resolves.not.toThrow();
    });
  });

  describe("并发操作", () => {
    it("应该正确处理并发的 upsert 操作", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(adapter.upsert(`key-${i}`, { index: i }));
      }

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it("应该正确处理并发的 find 操作", async () => {
      mockClient.get.mockResolvedValue(JSON.stringify({ userId: "user123" }));

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(adapter.find(`key-${i}`));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).toEqual({ userId: "user123" });
      });
    });
  });

  describe("错误处理", () => {
    it("应该处理 Redis 连接错误", async () => {
      mockClient.set.mockRejectedValueOnce(new Error("Connection error"));

      await expect(adapter.upsert("test-id", { data: "test" })).rejects.toThrow("Connection error");
    });

    it("应该处理 Redis 读取错误", async () => {
      mockClient.get.mockRejectedValueOnce(new Error("Read error"));

      await expect(adapter.find("test-id")).rejects.toThrow("Read error");
    });

    it("应该处理 Redis 删除错误", async () => {
      mockClient.get.mockResolvedValueOnce(JSON.stringify({ userId: "user123" }));
      mockClient.del.mockRejectedValueOnce(new Error("Delete error"));

      await expect(adapter.destroy("test-id")).rejects.toThrow("Delete error");
    });
  });
});
