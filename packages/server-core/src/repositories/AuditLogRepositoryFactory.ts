import type { AuditConfig, AuditLogRepository } from "../types/audit.js";
import type { UserRepositoryConfig } from "../types/config.js";
import { MemoryAuditLogRepository } from "./MemoryAuditLogRepository.js";
import { NoopAuditLogRepository } from "./NoopAuditLogRepository.js";
import { PgsqlAuditLogRepository } from "./PgsqlAuditLogRepository.js";
import { RetainedAuditLogRepository } from "./RetainedAuditLogRepository.js";
import { SqliteAuditLogRepository } from "./SqliteAuditLogRepository.js";

/** 审计日志复用用户仓储后端，避免额外的数据库配置。 */
export class AuditLogRepositoryFactory {
  static create(config: UserRepositoryConfig, audit: AuditConfig): AuditLogRepository {
    if (!audit.enabled) {
      return new NoopAuditLogRepository();
    }

    let repository: AuditLogRepository;
    switch (config.type) {
      case "memory":
        repository = new MemoryAuditLogRepository();
        break;
      case "sqlite":
        repository = new SqliteAuditLogRepository(config.sqlite?.dbPath || "./users.db");
        break;
      case "pgsql":
        repository = new PgsqlAuditLogRepository(resolvePgsqlUri(config));
        break;
      default:
        throw new Error(`Unknown user repository type: ${config.type}`);
    }

    return new RetainedAuditLogRepository(repository, audit.retentionDays);
  }
}

function resolvePgsqlUri(config: UserRepositoryConfig): string {
  if (!config.pgsql) {
    throw new Error("PostgreSQL configuration is required");
  }
  if (config.pgsql.connectionString) {
    return config.pgsql.connectionString;
  }
  if (!config.pgsql.host) {
    throw new Error("PostgreSQL configuration must provide connectionString or host");
  }
  const port = config.pgsql.port || 5432;
  const database = config.pgsql.database || "x_oidc";
  const user = config.pgsql.user || "postgres";
  const password = config.pgsql.password ? `:${config.pgsql.password}` : "";
  return `postgresql://${user}${password}@${config.pgsql.host}:${port}/${database}`;
}
