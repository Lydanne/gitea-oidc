/**
 * 用户仓储工厂
 * 根据配置创建合适的用户仓储实例
 */

import type { UserRepository } from "../types/auth";
import type { UserRepositoryConfig } from "../types/config";
import { MemoryUserRepository } from "./MemoryUserRepository";
import { PgsqlUserRepository } from "./PgsqlUserRepository";
import { SqliteUserRepository } from "./SqliteUserRepository";

export class UserRepositoryFactory {
  /**
   * 创建用户仓储实例
   * @param config 用户仓储配置
   * @returns 用户仓储实例
   */
  static create(config: UserRepositoryConfig): UserRepository {
    switch (config.type) {
      case "memory":
        return new MemoryUserRepository();

      case "sqlite": {
        // SQLite 数据库配置
        const dbPath = config.sqlite?.dbPath || "./users.db";
        return new SqliteUserRepository(dbPath);
      }

      case "pgsql": {
        // PostgreSQL 数据库配置
        if (!config.pgsql) {
          throw new Error("PostgreSQL configuration is required");
        }

        // 优先使用 connectionString
        let uri: string;
        if (config.pgsql.connectionString) {
          uri = config.pgsql.connectionString;
        } else if (config.pgsql.host) {
          // 构建连接字符串
          const host = config.pgsql.host;
          const port = config.pgsql.port || 5432;
          const database = config.pgsql.database || "gitea_oidc";
          const user = config.pgsql.user || "postgres";
          const password = config.pgsql.password ? `:${config.pgsql.password}` : "";
          uri = `postgresql://${user}${password}@${host}:${port}/${database}`;
        } else {
          throw new Error("PostgreSQL configuration must provide connectionString or host");
        }

        return new PgsqlUserRepository(uri);
      }

      default:
        throw new Error(`Unknown user repository type: ${config.type}`);
    }
  }

  /**
   * 获取支持的仓储类型列表
   */
  static getSupportedTypes(): string[] {
    return ["memory", "sqlite", "pgsql"];
  }

  /**
   * 验证配置
   * @param config 配置对象
   * @returns 是否有效
   */
  static validateConfig(config: UserRepositoryConfig): boolean {
    if (!config.type) {
      return false;
    }

    return UserRepositoryFactory.getSupportedTypes().includes(config.type);
  }
}
