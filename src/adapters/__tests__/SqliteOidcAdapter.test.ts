/**
 * SqliteOidcAdapter 单元测试
 *
 * 测试 SQLite OIDC 适配器的所有功能
 */

import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteOidcAdapter } from "../SqliteOidcAdapter";

describe("SqliteOidcAdapter", () => {
  let adapter: SqliteOidcAdapter;
  const testDbPath = join(process.cwd(), "test-oidc.db");

  beforeEach(() => {
    // 清理测试数据库
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // 创建适配器实例
    adapter = new SqliteOidcAdapter("Session");
  });

  afterEach(() => {
    // 清理测试数据库
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch (error) {
        // 忽略清理错误
      }
    }
  });

  describe("constructor", () => {
    it("应该创建数据库和表结构", () => {
      expect(adapter).toBeDefined();
      expect(existsSync("./oidc.db")).toBe(true);
    });

    it("应该为不同的 name 创建独立的适配器", () => {
      const adapter1 = new SqliteOidcAdapter("Session");
      const adapter2 = new SqliteOidcAdapter("AccessToken");

      expect(adapter1).toBeDefined();
      expect(adapter2).toBeDefined();
    });
  });

  describe("upsert", () => {
    it("应该插入新记录", async () => {
      const key = "test-key-1";
      const payload = { userId: "user123", data: "test data" };

      await adapter.upsert(key, payload);

      const result = await adapter.find(key);
      expect(result).toEqual(payload);
    });

    it("应该更新已存在的记录", async () => {
      const key = "test-key-2";
      const payload1 = { userId: "user123", version: 1 };
      const payload2 = { userId: "user123", version: 2 };

      await adapter.upsert(key, payload1);
      await adapter.upsert(key, payload2);

      const result = await adapter.find(key);
      expect(result).toEqual(payload2);
    });

    it("应该设置过期时间", async () => {
      const key = "test-key-3";
      const payload = { userId: "user123" };
      const expiresIn = 3600; // 1 小时

      await adapter.upsert(key, payload, expiresIn);

      const result = await adapter.find(key);
      expect(result).toEqual(payload);
    });

    it("应该处理复杂的 payload 对象", async () => {
      const key = "test-key-4";
      const payload = {
        userId: "user123",
        nested: {
          data: "nested value",
          array: [1, 2, 3],
        },
        timestamp: Date.now(),
      };

      await adapter.upsert(key, payload);

      const result = await adapter.find(key);
      expect(result).toEqual(payload);
    });
  });

  describe("find", () => {
    it("应该找到已存储的记录", async () => {
      const key = "test-key-5";
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);
      const result = await adapter.find(key);

      expect(result).toEqual(payload);
    });

    it("应该返回 undefined 当记录不存在时", async () => {
      const result = await adapter.find("non-existent-key");
      expect(result).toBeUndefined();
    });

    it("应该忽略已过期的记录", async () => {
      const key = "test-key-6";
      const payload = { userId: "user123" };
      const expiresIn = -1; // 已过期

      await adapter.upsert(key, payload, expiresIn);
      const result = await adapter.find(key);

      expect(result).toBeUndefined();
    });

    it("应该返回未过期的记录", async () => {
      const key = "test-key-7";
      const payload = { userId: "user123" };
      const expiresIn = 3600; // 1 小时后过期

      await adapter.upsert(key, payload, expiresIn);
      const result = await adapter.find(key);

      expect(result).toEqual(payload);
    });
  });

  describe("findByUserCode", () => {
    it("应该通过 userCode 找到记录", async () => {
      const key = "test-key-8";
      const userCode = "USER-CODE-123";
      const payload = { userCode, userId: "user123" };

      await adapter.upsert(key, payload);
      const result = await adapter.findByUserCode(userCode);

      expect(result).toEqual(payload);
    });

    it("应该返回 undefined 当 userCode 不存在时", async () => {
      const result = await adapter.findByUserCode("NON-EXISTENT-CODE");
      expect(result).toBeUndefined();
    });

    it("应该忽略已过期的记录", async () => {
      const key = "test-key-9";
      const userCode = "USER-CODE-456";
      const payload = { userCode, userId: "user123" };
      const expiresIn = -1; // 已过期

      await adapter.upsert(key, payload, expiresIn);
      const result = await adapter.findByUserCode(userCode);

      expect(result).toBeUndefined();
    });
  });

  describe("findByUid", () => {
    it("应该通过 uid 找到记录", async () => {
      const key = "test-key-10";
      const uid = "UID-123";
      const payload = { uid, userId: "user123" };

      await adapter.upsert(key, payload);
      const result = await adapter.findByUid(uid);

      expect(result).toEqual(payload);
    });

    it("应该返回 undefined 当 uid 不存在时", async () => {
      const result = await adapter.findByUid("NON-EXISTENT-UID");
      expect(result).toBeUndefined();
    });

    it("应该忽略已过期的记录", async () => {
      const key = "test-key-11";
      const uid = "UID-456";
      const payload = { uid, userId: "user123" };
      const expiresIn = -1; // 已过期

      await adapter.upsert(key, payload, expiresIn);
      const result = await adapter.findByUid(uid);

      expect(result).toBeUndefined();
    });
  });

  describe("consume", () => {
    it("应该消费记录并标记为已消费", async () => {
      const key = "test-key-12";
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);
      const result = await adapter.consume(key);

      expect(result).toEqual(payload);

      // 再次消费应该返回 undefined
      const result2 = await adapter.consume(key);
      expect(result2).toBeUndefined();
    });

    it("应该返回 undefined 当记录不存在时", async () => {
      const result = await adapter.consume("non-existent-key");
      expect(result).toBeUndefined();
    });

    it("应该返回 undefined 当记录已被消费时", async () => {
      const key = "test-key-13";
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);
      await adapter.consume(key);

      const result = await adapter.consume(key);
      expect(result).toBeUndefined();
    });

    it("应该忽略已过期的记录", async () => {
      const key = "test-key-14";
      const payload = { userId: "user123" };
      const expiresIn = -1; // 已过期

      await adapter.upsert(key, payload, expiresIn);
      const result = await adapter.consume(key);

      expect(result).toBeUndefined();
    });

    it("消费后记录仍然可以通过 find 找到", async () => {
      const key = "test-key-15";
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);
      await adapter.consume(key);

      // consume 后记录被标记但不删除
      const result = await adapter.find(key);
      expect(result).toEqual(payload);
    });
  });

  describe("destroy", () => {
    it("应该删除记录", async () => {
      const key = "test-key-16";
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);
      await adapter.destroy(key);

      const result = await adapter.find(key);
      expect(result).toBeUndefined();
    });

    it("应该不报错当删除不存在的记录时", async () => {
      await expect(adapter.destroy("non-existent-key")).resolves.not.toThrow();
    });

    it("应该只删除指定的记录", async () => {
      const key1 = "test-key-17";
      const key2 = "test-key-18";
      const payload1 = { userId: "user123" };
      const payload2 = { userId: "user456" };

      await adapter.upsert(key1, payload1);
      await adapter.upsert(key2, payload2);
      await adapter.destroy(key1);

      const result1 = await adapter.find(key1);
      const result2 = await adapter.find(key2);

      expect(result1).toBeUndefined();
      expect(result2).toEqual(payload2);
    });
  });

  describe("revokeByGrantId", () => {
    it("应该删除指定 grantId 的所有记录", async () => {
      const grantId = "grant-123";
      const key1 = "test-key-19";
      const key2 = "test-key-20";
      const key3 = "test-key-21";

      await adapter.upsert(key1, { grantId, userId: "user123" });
      await adapter.upsert(key2, { grantId, userId: "user456" });
      await adapter.upsert(key3, { grantId: "other-grant", userId: "user789" });

      await adapter.revokeByGrantId(grantId);

      const result1 = await adapter.find(key1);
      const result2 = await adapter.find(key2);
      const result3 = await adapter.find(key3);

      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      expect(result3).toBeDefined();
    });

    it("应该不报错当 grantId 不存在时", async () => {
      await expect(adapter.revokeByGrantId("non-existent-grant")).resolves.not.toThrow();
    });

    it("应该处理嵌套的 grantId", async () => {
      const grantId = "grant-456";
      const key = "test-key-22";
      const payload = {
        nested: {
          grantId,
        },
        userId: "user123",
      };

      await adapter.upsert(key, payload);

      // 注意: revokeByGrantId 只查找顶层的 grantId
      await adapter.revokeByGrantId(grantId);

      const result = await adapter.find(key);
      expect(result).toBeDefined(); // 嵌套的不会被删除
    });
  });

  describe("cleanup", () => {
    it("应该清理过期的记录", async () => {
      const key1 = "test-key-23";
      const key2 = "test-key-24";
      const payload1 = { userId: "user123" };
      const payload2 = { userId: "user456" };

      // 插入已过期的记录
      await adapter.upsert(key1, payload1, -1);
      // 插入未过期的记录
      await adapter.upsert(key2, payload2, 3600);

      // 手动触发清理
      // @ts-expect-error - 访问私有方法用于测试
      adapter.cleanup();

      const result1 = await adapter.find(key1);
      const result2 = await adapter.find(key2);

      expect(result1).toBeUndefined();
      expect(result2).toEqual(payload2);
    });
  });

  describe("多适配器隔离", () => {
    it("不同 name 的适配器应该数据隔离", async () => {
      const adapter1 = new SqliteOidcAdapter("Session");
      const adapter2 = new SqliteOidcAdapter("AccessToken");

      const key = "same-key";
      const payload1 = { type: "session" };
      const payload2 = { type: "token" };

      await adapter1.upsert(key, payload1);
      await adapter2.upsert(key, payload2);

      const result1 = await adapter1.find(key);
      const result2 = await adapter2.find(key);

      expect(result1).toEqual(payload1);
      expect(result2).toEqual(payload2);
    });
  });

  describe("并发操作", () => {
    it("应该正确处理并发的 upsert 操作", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(adapter.upsert(`key-${i}`, { index: i }));
      }

      await Promise.all(promises);

      // 验证所有记录都已保存
      for (let i = 0; i < 10; i++) {
        const result = await adapter.find(`key-${i}`);
        expect(result).toEqual({ index: i });
      }
    });

    it("应该正确处理并发的 find 操作", async () => {
      const key = "concurrent-key";
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(adapter.find(key));
      }

      const results = await Promise.all(promises);

      results.forEach((result) => {
        expect(result).toEqual(payload);
      });
    });
  });

  describe("边界情况", () => {
    it("应该处理空字符串 key", async () => {
      const key = "";
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);
      const result = await adapter.find(key);

      expect(result).toEqual(payload);
    });

    it("应该处理非常长的 key", async () => {
      const key = "a".repeat(1000);
      const payload = { userId: "user123" };

      await adapter.upsert(key, payload);
      const result = await adapter.find(key);

      expect(result).toEqual(payload);
    });

    it("应该处理空对象 payload", async () => {
      const key = "test-key-empty";
      const payload = {};

      await adapter.upsert(key, payload);
      const result = await adapter.find(key);

      expect(result).toEqual(payload);
    });

    it("应该处理包含特殊字符的 payload", async () => {
      const key = "test-key-special";
      const payload = {
        text: "Hello \"World\" with 'quotes' and \n newlines",
        json: '{"nested": "json"}',
      };

      await adapter.upsert(key, payload);
      const result = await adapter.find(key);

      expect(result).toEqual(payload);
    });

    it("应该处理 null 值", async () => {
      const key = "test-key-null";
      const payload = {
        nullValue: null,
        userId: "user123",
      };

      await adapter.upsert(key, payload);
      const result = await adapter.find(key);

      expect(result).toEqual(payload);
    });
  });
});
