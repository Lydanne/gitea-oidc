import type {
  AuditLogInput,
  AuditLogListOptions,
  AuditLogRecord,
  AuditLogRepository,
} from "../types/audit.js";
import { Logger } from "../utils/Logger.js";
import { sanitizeForLog } from "../utils/logSanitizer.js";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** 为审计仓储增加按时间保留的清理策略。 */
export class RetainedAuditLogRepository implements AuditLogRepository {
  private lastPrunedAt = 0;

  constructor(
    private readonly delegate: AuditLogRepository,
    private readonly retentionDays: number,
  ) {}

  async append(input: AuditLogInput): Promise<AuditLogRecord> {
    const record = await this.delegate.append(input);
    await this.pruneIfDue(record.createdAt);
    return record;
  }

  list(options?: AuditLogListOptions): Promise<AuditLogRecord[]> {
    return this.delegate.list(options);
  }

  count(options?: Omit<AuditLogListOptions, "offset" | "limit">): Promise<number> {
    return this.delegate.count(options);
  }

  deleteOlderThan(before: Date): Promise<number> {
    return this.delegate.deleteOlderThan(before);
  }

  close(): Promise<void> | void {
    return this.delegate.close?.();
  }

  private async pruneIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.lastPrunedAt < PRUNE_INTERVAL_MS) return;
    this.lastPrunedAt = now.getTime();
    const before = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000);
    try {
      await this.delegate.deleteOlderThan(before);
    } catch (error) {
      Logger.error("[审计日志] 清理过期记录失败:", sanitizeForLog(error));
    }
  }
}
