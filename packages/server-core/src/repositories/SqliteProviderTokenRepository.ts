/**
 * SQLite Provider token 仓储
 */

import Database from "better-sqlite3";
import type {
  ProviderTokenListOptions,
  ProviderTokenOwnerType,
  ProviderTokenProbeCandidateOptions,
  ProviderTokenRecord,
  ProviderTokenRepository,
  ProviderTokenStatus,
} from "../types/providerApi.js";
import { sanitizeTokenErrorText, TokenEncryptor } from "../utils/tokenCrypto.js";
import {
  normalizeProviderTokenListOptions,
  normalizeProviderTokenProbeCandidateOptions,
} from "./providerTokenListOptions.js";

/**
 * SQLite Provider token 仓储
 */
export class SqliteProviderTokenRepository implements ProviderTokenRepository {
  private db: Database.Database;
  private encryptor: TokenEncryptor;

  constructor(dbPath: string = ":memory:", encryptionKey: string) {
    this.db = new Database(dbPath);
    this.encryptor = new TokenEncryptor(encryptionKey);
    this.initializeDatabase();
  }

  async upsert(record: ProviderTokenRecord): Promise<ProviderTokenRecord> {
    const now = new Date();
    const id = this.createId(record.provider, record.ownerType, record.ownerId);
    const existing = await this.find(record.provider, record.ownerType, record.ownerId);
    const saved: ProviderTokenRecord = {
      ...existing,
      ...record,
      id,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
    };
    const row = this.recordToRow(saved);

    const sql = `
      INSERT INTO provider_tokens (
        id, provider, "ownerType", "ownerId", "accessToken", "refreshToken", "tokenType",
        scope, "expiresAt", "refreshExpiresAt", status, "lastProbedAt", "lastRefreshAt",
        "lastError", metadata, "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, "ownerType", "ownerId") DO UPDATE SET
        "accessToken" = excluded."accessToken",
        "refreshToken" = excluded."refreshToken",
        "tokenType" = excluded."tokenType",
        scope = excluded.scope,
        "expiresAt" = excluded."expiresAt",
        "refreshExpiresAt" = excluded."refreshExpiresAt",
        status = excluded.status,
        "lastProbedAt" = excluded."lastProbedAt",
        "lastRefreshAt" = excluded."lastRefreshAt",
        "lastError" = excluded."lastError",
        metadata = excluded.metadata,
        "updatedAt" = excluded."updatedAt"
    `;

    this.db
      .prepare(sql)
      .run(
        row.id,
        row.provider,
        row.ownerType,
        row.ownerId,
        row.accessToken,
        row.refreshToken,
        row.tokenType,
        row.scope,
        row.expiresAt,
        row.refreshExpiresAt,
        row.status,
        row.lastProbedAt,
        row.lastRefreshAt,
        row.lastError,
        row.metadata,
        row.createdAt,
        row.updatedAt,
      );

    return saved;
  }

  async find(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
  ): Promise<ProviderTokenRecord | null> {
    const row = this.db
      .prepare(
        `
          SELECT * FROM provider_tokens
          WHERE provider = ? AND "ownerType" = ? AND "ownerId" = ?
        `,
      )
      .get(provider, ownerType, ownerId) as any;

    return row ? this.rowToRecord(row) : null;
  }

  async list(options?: ProviderTokenListOptions): Promise<ProviderTokenRecord[]> {
    const listOptions = normalizeProviderTokenListOptions(options);
    let sql = "SELECT * FROM provider_tokens";
    const params: any[] = [];
    const conditions: string[] = [];

    if (listOptions.provider) {
      conditions.push("provider = ?");
      params.push(listOptions.provider);
    }
    if (listOptions.ownerType) {
      conditions.push('"ownerType" = ?');
      params.push(listOptions.ownerType);
    }
    if (listOptions.ownerId) {
      conditions.push('"ownerId" = ?');
      params.push(listOptions.ownerId);
    }
    if (listOptions.status) {
      conditions.push("status = ?");
      params.push(listOptions.status);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ' ORDER BY "updatedAt" DESC';

    if (listOptions.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(listOptions.limit);
    }
    if (listOptions.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(listOptions.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToRecord(row));
  }

  async listProbeCandidates(
    options: ProviderTokenProbeCandidateOptions,
  ): Promise<ProviderTokenRecord[]> {
    const probeOptions = normalizeProviderTokenProbeCandidateOptions(options);
    const rows = this.db
      .prepare(
        `
          SELECT * FROM provider_tokens
          WHERE status != ? AND (
            status != ? OR "lastProbedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" <= ?
          )
          ORDER BY
            CASE
              WHEN status != ? THEN 0
              WHEN "lastProbedAt" IS NULL THEN 1
              WHEN "expiresAt" IS NULL THEN 2
              ELSE 3
            END ASC,
            COALESCE("lastProbedAt", 0) ASC,
            COALESCE("expiresAt", 0) ASC,
            "updatedAt" ASC
          LIMIT ?
        `,
      )
      .all(
        "revoked",
        "valid",
        probeOptions.expiresBefore.getTime(),
        "valid",
        probeOptions.limit,
      ) as any[];

    return rows.map((row) => this.rowToRecord(row));
  }

  async updateStatus(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
    status: ProviderTokenStatus,
    lastError?: string,
  ): Promise<void> {
    this.db
      .prepare(
        `
          UPDATE provider_tokens
          SET status = ?, "lastError" = ?, "lastProbedAt" = ?, "updatedAt" = ?
          WHERE provider = ? AND "ownerType" = ? AND "ownerId" = ?
        `,
      )
      .run(
        status,
        sanitizeTokenErrorText(lastError) ?? null,
        Date.now(),
        Date.now(),
        provider,
        ownerType,
        ownerId,
      );
  }

  async delete(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
  ): Promise<void> {
    this.db
      .prepare(
        'DELETE FROM provider_tokens WHERE provider = ? AND "ownerType" = ? AND "ownerId" = ?',
      )
      .run(provider, ownerType, ownerId);
  }

  async deleteByOwnerId(ownerId: string): Promise<void> {
    this.db.prepare('DELETE FROM provider_tokens WHERE "ownerId" = ?').run(ownerId);
  }

  async clear(): Promise<void> {
    this.db.prepare("DELETE FROM provider_tokens").run();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_tokens (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        "ownerType" TEXT NOT NULL,
        "ownerId" TEXT NOT NULL,
        "accessToken" TEXT NOT NULL,
        "refreshToken" TEXT,
        "tokenType" TEXT,
        scope TEXT,
        "expiresAt" INTEGER,
        "refreshExpiresAt" INTEGER,
        status TEXT NOT NULL,
        "lastProbedAt" INTEGER,
        "lastRefreshAt" INTEGER,
        "lastError" TEXT,
        metadata TEXT,
        "createdAt" INTEGER NOT NULL,
        "updatedAt" INTEGER NOT NULL,
        UNIQUE(provider, "ownerType", "ownerId")
      );

      CREATE INDEX IF NOT EXISTS idx_provider_tokens_lookup
      ON provider_tokens(provider, "ownerType", "ownerId");

      CREATE INDEX IF NOT EXISTS idx_provider_tokens_status
      ON provider_tokens(status);
    `);
  }

  private createId(provider: string, ownerType: ProviderTokenOwnerType, ownerId: string): string {
    return `${provider}:${ownerType}:${ownerId}`;
  }

  private recordToRow(record: ProviderTokenRecord): any {
    return {
      id: record.id ?? this.createId(record.provider, record.ownerType, record.ownerId),
      provider: record.provider,
      ownerType: record.ownerType,
      ownerId: record.ownerId,
      accessToken: this.encryptor.encrypt(record.accessToken),
      refreshToken: record.refreshToken ? this.encryptor.encrypt(record.refreshToken) : null,
      tokenType: record.tokenType ?? null,
      scope: record.scope ?? null,
      expiresAt: record.expiresAt?.getTime() ?? null,
      refreshExpiresAt: record.refreshExpiresAt?.getTime() ?? null,
      status: record.status,
      lastProbedAt: record.lastProbedAt?.getTime() ?? null,
      lastRefreshAt: record.lastRefreshAt?.getTime() ?? null,
      lastError: sanitizeTokenErrorText(record.lastError) ?? null,
      metadata: record.metadata ? JSON.stringify(record.metadata) : null,
      createdAt: record.createdAt?.getTime() ?? Date.now(),
      updatedAt: record.updatedAt?.getTime() ?? Date.now(),
    };
  }

  private rowToRecord(row: any): ProviderTokenRecord {
    return {
      id: row.id,
      provider: row.provider,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      accessToken: this.encryptor.decrypt(row.accessToken),
      refreshToken: row.refreshToken ? this.encryptor.decrypt(row.refreshToken) : undefined,
      tokenType: row.tokenType || undefined,
      scope: row.scope || undefined,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
      refreshExpiresAt: row.refreshExpiresAt ? new Date(row.refreshExpiresAt) : undefined,
      status: row.status,
      lastProbedAt: row.lastProbedAt ? new Date(row.lastProbedAt) : undefined,
      lastRefreshAt: row.lastRefreshAt ? new Date(row.lastRefreshAt) : undefined,
      lastError: sanitizeTokenErrorText(row.lastError),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
}
