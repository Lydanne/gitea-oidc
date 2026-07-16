/**
 * Provider token 仓储工厂
 */

import type { UserRepositoryConfig } from "../types/config.js";
import type { ProviderTokenRepository } from "../types/providerApi.js";
import { MemoryProviderTokenRepository } from "./MemoryProviderTokenRepository.js";
import { PgsqlProviderTokenRepository } from "./PgsqlProviderTokenRepository.js";
import { SqliteProviderTokenRepository } from "./SqliteProviderTokenRepository.js";

/**
 * Provider token 仓储工厂
 */
export class ProviderTokenRepositoryFactory {
  /**
   * 创建 Provider token 仓储
   * @param config 用户仓储配置，用于复用同一种持久化后端
   * @param encryptionKey token 加密密钥
   * @returns Provider token 仓储
   */
  static create(config: UserRepositoryConfig, encryptionKey: string): ProviderTokenRepository {
    switch (config.type) {
      case "memory":
        return new MemoryProviderTokenRepository();

      case "sqlite":
        return new SqliteProviderTokenRepository(
          config.sqlite?.dbPath || "./users.db",
          encryptionKey,
        );

      case "pgsql": {
        if (!config.pgsql) {
          throw new Error("PostgreSQL configuration is required");
        }

        if (config.pgsql.connectionString) {
          return new PgsqlProviderTokenRepository(config.pgsql.connectionString, encryptionKey);
        }

        if (!config.pgsql.host) {
          throw new Error("PostgreSQL configuration must provide connectionString or host");
        }

        const host = config.pgsql.host;
        const port = config.pgsql.port || 5432;
        const database = config.pgsql.database || "x_oidc";
        const user = config.pgsql.user || "postgres";
        const password = config.pgsql.password ? `:${config.pgsql.password}` : "";
        return new PgsqlProviderTokenRepository(
          `postgresql://${user}${password}@${host}:${port}/${database}`,
          encryptionKey,
        );
      }

      default:
        throw new Error(`Unknown user repository type: ${config.type}`);
    }
  }
}
