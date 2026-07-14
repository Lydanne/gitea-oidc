import Database from "better-sqlite3";
import type {
  AuditLogInput,
  AuditLogListOptions,
  AuditLogRecord,
  AuditLogRepository,
} from "../types/audit.js";
import { normalizeAuditLogInput, normalizeAuditLogListOptions } from "./auditLogRepositoryUtils.js";

export class SqliteAuditLogRepository implements AuditLogRepository {
  private db: Database.Database;

  constructor(uri: string = ":memory:") {
    this.db = new Database(uri);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        "eventType" TEXT NOT NULL,
        outcome TEXT NOT NULL,
        source TEXT NOT NULL,
        "userId" TEXT,
        "actorUserId" TEXT,
        username TEXT,
        provider TEXT,
        "clientId" TEXT,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "changedFields" TEXT,
        "statusFrom" TEXT,
        "statusTo" TEXT,
        reason TEXT,
        "createdAt" INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs("createdAt" DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs("userId", "createdAt" DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id
      ON audit_logs("actorUserId", "createdAt" DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type
      ON audit_logs("eventType", "createdAt" DESC);
    `);
  }

  async append(input: AuditLogInput): Promise<AuditLogRecord> {
    const record = normalizeAuditLogInput(input);
    this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, "eventType", outcome, source, "userId", "actorUserId", username, provider,
          "clientId", "ipAddress", "userAgent", "changedFields", "statusFrom", "statusTo",
          reason, "createdAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.eventType,
        record.outcome,
        record.source,
        record.userId ?? null,
        record.actorUserId ?? null,
        record.username ?? null,
        record.provider ?? null,
        record.clientId ?? null,
        record.ipAddress ?? null,
        record.userAgent ?? null,
        record.changedFields ? JSON.stringify(record.changedFields) : null,
        record.statusFrom ?? null,
        record.statusTo ?? null,
        record.reason ?? null,
        record.createdAt.getTime(),
      );
    return record;
  }

  async list(options: AuditLogListOptions = {}): Promise<AuditLogRecord[]> {
    const normalized = normalizeAuditLogListOptions(options);
    const { where, params } = buildAuditWhere(normalized);
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_logs${where}
         ORDER BY "createdAt" DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, normalized.limit, normalized.offset) as Array<Record<string, unknown>>;
    return rows.map(auditLogFromSqliteRow);
  }

  async count(options: Omit<AuditLogListOptions, "offset" | "limit"> = {}): Promise<number> {
    const { where, params } = buildAuditWhere(options);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM audit_logs${where}`)
      .get(...params) as {
      count: number;
    };
    return row.count;
  }

  async deleteOlderThan(before: Date): Promise<number> {
    return this.db.prepare('DELETE FROM audit_logs WHERE "createdAt" < ?').run(before.getTime())
      .changes;
  }

  close(): void {
    this.db.close();
  }
}

function buildAuditWhere(options: Omit<AuditLogListOptions, "offset" | "limit">): {
  where: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.userId) {
    conditions.push('("userId" = ? OR "actorUserId" = ?)');
    params.push(options.userId, options.userId);
  }
  if (options.eventType) {
    conditions.push('"eventType" = ?');
    params.push(options.eventType);
  }
  if (options.outcome) {
    conditions.push("outcome = ?");
    params.push(options.outcome);
  }
  if (options.from) {
    conditions.push('"createdAt" >= ?');
    params.push(options.from.getTime());
  }
  if (options.to) {
    conditions.push('"createdAt" <= ?');
    params.push(options.to.getTime());
  }
  return {
    where: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function auditLogFromSqliteRow(row: Record<string, unknown>): AuditLogRecord {
  return {
    id: String(row.id),
    eventType: row.eventType as AuditLogRecord["eventType"],
    outcome: row.outcome as AuditLogRecord["outcome"],
    source: row.source as AuditLogRecord["source"],
    ...optionalRowString("userId", row.userId),
    ...optionalRowString("actorUserId", row.actorUserId),
    ...optionalRowString("username", row.username),
    ...optionalRowString("provider", row.provider),
    ...optionalRowString("clientId", row.clientId),
    ...optionalRowString("ipAddress", row.ipAddress),
    ...optionalRowString("userAgent", row.userAgent),
    ...(typeof row.changedFields === "string"
      ? { changedFields: JSON.parse(row.changedFields) as string[] }
      : {}),
    ...optionalRowString("statusFrom", row.statusFrom),
    ...optionalRowString("statusTo", row.statusTo),
    ...optionalRowString("reason", row.reason),
    createdAt: new Date(Number(row.createdAt)),
  } as AuditLogRecord;
}

function optionalRowString<K extends keyof AuditLogRecord>(
  key: K,
  value: unknown,
): Partial<Pick<AuditLogRecord, K>> {
  return typeof value === "string" && value
    ? ({ [key]: value } as Partial<Pick<AuditLogRecord, K>>)
    : {};
}
