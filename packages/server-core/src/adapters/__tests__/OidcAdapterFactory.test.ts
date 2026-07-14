/**
 * OidcAdapterFactory 单元测试
 *
 * 测试适配器工厂的所有功能
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type OidcAdapterConfig, OidcAdapterFactory } from "../OidcAdapterFactory.js";
import { RedisOidcAdapter } from "../RedisOidcAdapter.js";
import { SqliteOidcAdapter } from "../SqliteOidcAdapter.js";

describe("OidcAdapterFactory", () => {
  afterEach(async () => {
    // 清理资源
    await OidcAdapterFactory.cleanup();
  });

  describe("configure", () => {
    it("应该配置 SQLite 适配器", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
        sqlite: {
          dbPath: "./test-oidc.db",
        },
      };

      OidcAdapterFactory.configure(config);
      const retrievedConfig = OidcAdapterFactory.getConfig();

      expect(retrievedConfig).toEqual(config);
    });

    it("应该配置 Redis 适配器", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        redis: {
          url: "redis://localhost:6379",
          keyPrefix: "test:",
        },
      };

      OidcAdapterFactory.configure(config);
      const retrievedConfig = OidcAdapterFactory.getConfig();

      expect(retrievedConfig).toEqual(config);
    });

    it("应该配置 Memory 适配器", () => {
      const config: OidcAdapterConfig = {
        type: "memory",
      };

      OidcAdapterFactory.configure(config);
      const retrievedConfig = OidcAdapterFactory.getConfig();

      expect(retrievedConfig).toEqual(config);
    });
  });

  describe("create", () => {
    it("应该创建 SQLite 适配器实例", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
      };

      OidcAdapterFactory.configure(config);
      const adapter = OidcAdapterFactory.create("Session");

      expect(adapter).toBeInstanceOf(SqliteOidcAdapter);
    });

    it("应该为不同的 name 创建独立的适配器实例", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
      };

      OidcAdapterFactory.configure(config);
      const adapter1 = OidcAdapterFactory.create("Session");
      const adapter2 = OidcAdapterFactory.create("AccessToken");

      expect(adapter1).toBeInstanceOf(SqliteOidcAdapter);
      expect(adapter2).toBeInstanceOf(SqliteOidcAdapter);
      expect(adapter1).not.toBe(adapter2);
    });

    it("应该创建 Redis 适配器实例", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        redis: {
          url: "redis://localhost:6379",
        },
      };

      OidcAdapterFactory.configure(config);
      const adapter = OidcAdapterFactory.create("Session");

      expect(adapter).toBeInstanceOf(RedisOidcAdapter);
    });

    it("应该为 Memory 类型返回 undefined", () => {
      const config: OidcAdapterConfig = {
        type: "memory",
      };

      OidcAdapterFactory.configure(config);
      const adapter = OidcAdapterFactory.create("Session");

      expect(adapter).toBeUndefined();
    });

    it("memory 类型不会向 oidc-provider 暴露返回 undefined 的 adapter 工厂", () => {
      OidcAdapterFactory.configure({ type: "memory" });

      expect(OidcAdapterFactory.getAdapterFactory()).toBeUndefined();
    });

    it("只为指定模型使用 override，其他模型仍使用通用持久化适配器", () => {
      const clientAdapter = { find: vi.fn() } as any;
      OidcAdapterFactory.configure(
        { type: "sqlite", sqlite: { dbPath: ":memory:" } },
        { Client: () => clientAdapter },
      );

      expect(OidcAdapterFactory.create("Client")).toBe(clientAdapter);
      expect(OidcAdapterFactory.create("Session")).toBeInstanceOf(SqliteOidcAdapter);
    });

    it("拒绝把模型 override 与 oidc-provider 内建 memory adapter 混用", () => {
      OidcAdapterFactory.configure(
        { type: "memory" },
        { Client: () => ({ find: vi.fn() }) as any },
      );

      expect(() => OidcAdapterFactory.getAdapterFactory()).toThrow(/Memory OIDC adapter/);
    });

    it("应该在未配置时抛出错误", () => {
      // 清除配置
      const factory = OidcAdapterFactory as any;
      factory.config = undefined;

      expect(() => {
        OidcAdapterFactory.create("Session");
      }).toThrow("OidcAdapterFactory not configured");
    });

    it("应该在 Redis 配置缺失时抛出错误", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        // 缺少 redis 配置
      };

      OidcAdapterFactory.configure(config);

      expect(() => {
        OidcAdapterFactory.create("Session");
      }).toThrow("Redis configuration is required");
    });

    it("应该在未知类型时抛出错误", () => {
      const config = {
        type: "unknown",
      } as any;

      OidcAdapterFactory.configure(config);

      expect(() => {
        OidcAdapterFactory.create("Session");
      }).toThrow("Unknown adapter type");
    });
  });

  describe("getAdapterFactory", () => {
    it("应该返回适配器工厂函数", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
      };

      OidcAdapterFactory.configure(config);
      const factory = OidcAdapterFactory.getAdapterFactory();

      expect(typeof factory).toBe("function");
    });

    it("工厂函数应该创建适配器实例", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
      };

      OidcAdapterFactory.configure(config);
      const factory = OidcAdapterFactory.getAdapterFactory();
      const adapter = factory("Session");

      expect(adapter).toBeInstanceOf(SqliteOidcAdapter);
    });

    it("工厂函数应该为不同的 name 创建不同的实例", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
      };

      OidcAdapterFactory.configure(config);
      const factory = OidcAdapterFactory.getAdapterFactory();

      const adapter1 = factory("Session");
      const adapter2 = factory("AccessToken");
      const adapter3 = factory("RefreshToken");

      expect(adapter1).toBeInstanceOf(SqliteOidcAdapter);
      expect(adapter2).toBeInstanceOf(SqliteOidcAdapter);
      expect(adapter3).toBeInstanceOf(SqliteOidcAdapter);
    });
  });

  describe("validateConfig", () => {
    it("应该验证有效的 SQLite 配置", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
        sqlite: {
          dbPath: "./oidc.db",
        },
      };

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("应该验证有效的 Redis 配置", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        redis: {
          url: "redis://localhost:6379",
        },
      };

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("应该验证 Redis 配置带 host", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        redis: {
          host: "localhost",
          port: 6379,
        },
      };

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("应该对 Memory 类型返回警告", () => {
      const config: OidcAdapterConfig = {
        type: "memory",
      };

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("⚠️");
      expect(result.errors[0]).toContain("memory");
    });

    it("应该检测缺失的 type", () => {
      const config = {} as any;

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("适配器类型 (type) 是必需的");
    });

    it("应该检测无效的 type", () => {
      const config = {
        type: "invalid",
      } as any;

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("无效的适配器类型"))).toBe(true);
    });

    it("应该检测 Redis 配置缺失", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        // 缺少 redis 配置
      };

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Redis 配置 (redis) 是必需的");
    });

    it("应该检测 Redis URL 或 host 缺失", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        redis: {
          // 缺少 url 和 host
          port: 6379,
        },
      };

      const result = OidcAdapterFactory.validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Redis URL 或 host 是必需的");
    });
  });

  describe("cleanup", () => {
    it("应该清理 SQLite 适配器资源", async () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
      };

      OidcAdapterFactory.configure(config);
      await expect(OidcAdapterFactory.cleanup()).resolves.not.toThrow();
    });

    it("应该清理 Redis 适配器资源", async () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        redis: {
          url: "redis://localhost:6379",
        },
      };

      OidcAdapterFactory.configure(config);

      // Mock RedisOidcAdapter.disconnect
      const disconnectSpy = vi.spyOn(RedisOidcAdapter, "disconnect").mockResolvedValue();

      await OidcAdapterFactory.cleanup();

      expect(disconnectSpy).toHaveBeenCalled();
      disconnectSpy.mockRestore();
    });

    it("应该清理 Memory 适配器资源", async () => {
      const config: OidcAdapterConfig = {
        type: "memory",
      };

      OidcAdapterFactory.configure(config);
      await expect(OidcAdapterFactory.cleanup()).resolves.not.toThrow();
    });

    it("应该在未配置时不报错", async () => {
      const factory = OidcAdapterFactory as any;
      factory.config = undefined;

      await expect(OidcAdapterFactory.cleanup()).resolves.not.toThrow();
    });
  });

  describe("getConfig", () => {
    it("应该返回当前配置", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
        sqlite: {
          dbPath: "./test.db",
        },
      };

      OidcAdapterFactory.configure(config);
      const retrievedConfig = OidcAdapterFactory.getConfig();

      expect(retrievedConfig).toEqual(config);
    });

    it("应该在未配置时返回 undefined", () => {
      const factory = OidcAdapterFactory as any;
      factory.config = undefined;

      const config = OidcAdapterFactory.getConfig();

      expect(config).toBeUndefined();
    });
  });

  describe("Client 撤销发行栅栏", () => {
    it("撤销后拒绝并发写入，重新启用后恢复写入", async () => {
      OidcAdapterFactory.configure({ type: "sqlite", sqlite: { dbPath: ":memory:" } });
      const adapter = OidcAdapterFactory.create("AuthorizationCode") as SqliteOidcAdapter;
      await adapter.upsert("before-disable", { clientId: "client-1" });

      await OidcAdapterFactory.revokeByClientId("client-1");

      await expect(adapter.find("before-disable")).resolves.toBeUndefined();
      await expect(adapter.upsert("racing-code", { clientId: "client-1" })).rejects.toMatchObject({
        code: "OIDC_CLIENT_REVOKED",
      });
      await expect(adapter.upsert("racing-grant", { client_id: "client-1" })).rejects.toMatchObject(
        {
          code: "OIDC_CLIENT_REVOKED",
        },
      );
      await expect(
        adapter.upsert("racing-interaction", { params: { client_id: "client-1" } }),
      ).rejects.toMatchObject({ code: "OIDC_CLIENT_REVOKED" });
      await expect(
        adapter.upsert("other-client", { clientId: "client-2" }),
      ).resolves.toBeUndefined();

      OidcAdapterFactory.allowClientId("client-1");
      await expect(
        adapter.upsert("after-enable", { clientId: "client-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("账户撤销发行栅栏", () => {
    it("撤销期间和用户停用后都拒绝凭证写回，重新启用后恢复", async () => {
      OidcAdapterFactory.configure({ type: "sqlite", sqlite: { dbPath: ":memory:" } });
      const adapter = OidcAdapterFactory.create("RefreshToken") as SqliteOidcAdapter;
      await adapter.upsert("before-disable", { accountId: "user-1", clientId: "client-1" });

      const lease = await OidcAdapterFactory.acquireAccountIdBlock("user-1");
      await OidcAdapterFactory.revokeByAccountId("user-1");

      await expect(adapter.find("before-disable")).resolves.toBeUndefined();
      await expect(
        adapter.upsert("racing-refresh", { accountId: "user-1", clientId: "client-1" }),
      ).rejects.toMatchObject({ code: "OIDC_ACCOUNT_REVOKED" });

      await lease.commit();
      await expect(
        adapter.upsert("after-disable", { accountId: "user-1", clientId: "client-1" }),
      ).rejects.toMatchObject({ code: "OIDC_ACCOUNT_REVOKED" });

      await OidcAdapterFactory.allowAccountId("user-1");
      await expect(
        adapter.upsert("after-enable", { accountId: "user-1", clientId: "client-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("集成测试", () => {
    it("应该支持完整的配置-创建-清理流程", async () => {
      const tempDirectory = await mkdtemp(join(tmpdir(), "gitea-oidc-adapter-"));

      // 配置
      const config: OidcAdapterConfig = {
        type: "sqlite",
        sqlite: {
          dbPath: join(tempDirectory, "integration-test.db"),
        },
      };

      try {
        OidcAdapterFactory.configure(config);

        // 创建适配器
        const factory = OidcAdapterFactory.getAdapterFactory();
        const sessionAdapter = factory("Session");
        const tokenAdapter = factory("AccessToken");

        expect(sessionAdapter).toBeInstanceOf(SqliteOidcAdapter);
        expect(tokenAdapter).toBeInstanceOf(SqliteOidcAdapter);

        // 清理
        await expect(OidcAdapterFactory.cleanup()).resolves.not.toThrow();
      } finally {
        await OidcAdapterFactory.cleanup();
        await rm(tempDirectory, { force: true, recursive: true });
      }
    });

    it("应该支持配置切换", () => {
      // 配置 SQLite
      const sqliteConfig: OidcAdapterConfig = {
        type: "sqlite",
      };

      OidcAdapterFactory.configure(sqliteConfig);
      let adapter = OidcAdapterFactory.create("Session");
      expect(adapter).toBeInstanceOf(SqliteOidcAdapter);

      // 切换到 Memory
      const memoryConfig: OidcAdapterConfig = {
        type: "memory",
      };

      OidcAdapterFactory.configure(memoryConfig);
      adapter = OidcAdapterFactory.create("Session");
      expect(adapter).toBeUndefined();
    });
  });

  describe("边界情况", () => {
    it("应该处理空的 SQLite 配置", () => {
      const config: OidcAdapterConfig = {
        type: "sqlite",
        sqlite: {},
      };

      OidcAdapterFactory.configure(config);
      const adapter = OidcAdapterFactory.create("Session");

      expect(adapter).toBeInstanceOf(SqliteOidcAdapter);
    });

    it("应该处理完整的 Redis 配置", () => {
      const config: OidcAdapterConfig = {
        type: "redis",
        redis: {
          url: "redis://localhost:6379",
          host: "localhost",
          port: 6379,
          password: "password",
          database: 1,
          keyPrefix: "test:",
        },
      };

      OidcAdapterFactory.configure(config);
      const adapter = OidcAdapterFactory.create("Session");

      expect(adapter).toBeInstanceOf(RedisOidcAdapter);
    });

    it("应该处理多次配置调用", () => {
      const config1: OidcAdapterConfig = {
        type: "sqlite",
      };

      const config2: OidcAdapterConfig = {
        type: "memory",
      };

      OidcAdapterFactory.configure(config1);
      expect(OidcAdapterFactory.getConfig()).toEqual(config1);

      OidcAdapterFactory.configure(config2);
      expect(OidcAdapterFactory.getConfig()).toEqual(config2);
    });
  });
});
