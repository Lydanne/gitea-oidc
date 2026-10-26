import { Pool } from "pg";
import type {
  AuditLogInput,
  AuditLogListOptions,
  AuditLogRecord,
  AuditLogRepository,
} from "../types/audit.js";
import { normalizeAuditLogInput, normalizeAuditLogListOptions } from "./auditLogRepositoryUtils.js";

export class PgsqlAuditLogRepository implements AuditLogRepository {
  private pool: Pool;
  private ready: Promise<void>;

  constructor(uri: string) {
    this.pool = new Pool({
      connectionString: uri,
      max: 20,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.ready = this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
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
          "changedFields" JSONB,
          "statusFrom" TEXT,
          "statusTo" TEXT,
          reason TEXT,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
        ON audit_logs("createdAt" DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
        ON audit_logs("userId", "createdAt" DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id
        ON audit_logs("actorUserId", "createdAt" DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type
        ON audit_logs("eventType", "createdAt" DESC);
      `);
    } finally {
      client.release();
    }
  }

  async append(input: AuditLogInput): Promise<AuditLogRecord> {
    await this.ready;
    const record = normalizeAuditLogInput(input);
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO audit_logs (
          id, "eventType", outcome, source, "userId", "actorUserId", username, provider,
          "clientId", "ipAddress", "userAgent", "changedFields", "statusFrom", "statusTo",
          reason, "createdAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )`,
        [
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
          record.changedFields ?? null,
          record.statusFrom ?? null,
          record.statusTo ?? null,
          record.reason ?? null,
          record.createdAt,
        ],
      );
      return record;
    } finally {
      client.release();
    }
  }

  async list(options: AuditLogListOptions = {}): Promise<AuditLogRecord[]> {
    await this.ready;
    const normalized = normalizeAuditLogListOptions(options);
    const { where, params } = buildAuditWhere(normalized);
    const limitParameter = params.length + 1;
    const offsetParameter = params.length + 2;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM audit_logs${where}
         ORDER BY "createdAt" DESC, id DESC
         LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        [...params, normalized.limit, normalized.offset],
      );
      return result.rows.map(auditLogFromPgsqlRow);
    } finally {
      client.release();
    }
  }

  async count(options: Omit<AuditLogListOptions, "offset" | "limit"> = {}): Promise<number> {
    await this.ready;
    const { where, params } = buildAuditWhere(options);
    const client = await this.pool.connect();
    try {
      const result = await client.query(`SELECT COUNT(*) AS count FROM audit_logs${where}`, params);
      return Number.parseInt(result.rows[0].count, 10);
    } finally {
      client.release();
    }
  }

  async deleteOlderThan(before: Date): Promise<number> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      const result = await client.query('DELETE FROM audit_logs WHERE "createdAt" < $1', [before]);
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    await this.pool.end();
  }
}

function buildAuditWhere(options: Omit<AuditLogListOptions, "offset" | "limit">): {
  where: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (condition: (index: number) => string, ...values: unknown[]) => {
    const index = params.length + 1;
    conditions.push(condition(index));
    params.push(...values);
  };

  if (options.userId) {
    add(
      (index) => `("userId" = $${index} OR "actorUserId" = $${index + 1})`,
      options.userId,
      options.userId,
    );
  }
  if (options.eventType) add((index) => `"eventType" = $${index}`, options.eventType);
  if (options.outcome) add((index) => `outcome = $${index}`, options.outcome);
  if (options.from) add((index) => `"createdAt" >= $${index}`, options.from);
  if (options.to) add((index) => `"createdAt" <= $${index}`, options.to);

  return {
    where: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function auditLogFromPgsqlRow(row: Record<string, unknown>): AuditLogRecord {
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
    ...(Array.isArray(row.changedFields) ? { changedFields: row.changedFields as string[] } : {}),
    ...optionalRowString("statusFrom", row.statusFrom),
    ...optionalRowString("statusTo", row.statusTo),
    ...optionalRowString("reason", row.reason),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
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
