import type {
  AuditLogInput,
  AuditLogListOptions,
  AuditLogRecord,
  AuditLogRepository,
} from "../types/audit.js";
import {
  matchesAuditLog,
  normalizeAuditLogInput,
  normalizeAuditLogListOptions,
} from "./auditLogRepositoryUtils.js";

export class MemoryAuditLogRepository implements AuditLogRepository {
  private records: AuditLogRecord[] = [];

  async append(input: AuditLogInput): Promise<AuditLogRecord> {
    const record = normalizeAuditLogInput(input);
    this.records.push(record);
    return record;
  }

  async list(options: AuditLogListOptions = {}): Promise<AuditLogRecord[]> {
    const normalized = normalizeAuditLogListOptions(options);
    return this.records
      .filter((record) => matchesAuditLog(record, normalized))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(normalized.offset, normalized.offset + normalized.limit);
  }

  async count(options: Omit<AuditLogListOptions, "offset" | "limit"> = {}): Promise<number> {
    return this.records.filter((record) => matchesAuditLog(record, options)).length;
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const originalSize = this.records.length;
    this.records = this.records.filter((record) => record.createdAt >= before);
    return originalSize - this.records.length;
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}
