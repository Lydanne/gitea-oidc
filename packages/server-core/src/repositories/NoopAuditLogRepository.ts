import type {
  AuditLogInput,
  AuditLogListOptions,
  AuditLogRecord,
  AuditLogRepository,
} from "../types/audit.js";
import { normalizeAuditLogInput } from "./auditLogRepositoryUtils.js";

/** 审计关闭时保留稳定契约，但不持久化任何记录。 */
export class NoopAuditLogRepository implements AuditLogRepository {
  async append(input: AuditLogInput): Promise<AuditLogRecord> {
    return normalizeAuditLogInput(input);
  }

  async list(_options?: AuditLogListOptions): Promise<AuditLogRecord[]> {
    return [];
  }

  async count(_options?: Omit<AuditLogListOptions, "offset" | "limit">): Promise<number> {
    return 0;
  }

  async deleteOlderThan(_before: Date): Promise<number> {
    return 0;
  }
}
