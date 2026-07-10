/**
 * PostgreSQL Provider token 仓储
 */

import { Pool } from "pg";
import type {
  ProviderTokenListOptions,
  ProviderTokenOwnerType,
  ProviderTokenProbeCandidateOptions,
  ProviderTokenRecord,
  ProviderTokenRepository,
  ProviderTokenStatus,
} from "../types/providerApi";
import { sanitizeTokenErrorText, TokenEncryptor } from "../utils/tokenCrypto";
import {
  normalizeProviderTokenListOptions,
  normalizeProviderTokenProbeCandidateOptions,
} from "./providerTokenListOptions";

/**
 * PostgreSQL Provider token 仓储
 */
export class PgsqlProviderTokenRepository implements ProviderTokenRepository {
  private pool: Pool;
  private encryptor: TokenEncryptor;
  private ready: Promise<void>;

  constructor(uri: string, encryptionKey: string) {
    this.pool = new Pool({ connectionString: uri });
    this.encryptor = new TokenEncryptor(encryptionKey);
    this.ready = this.initializeDatabase();
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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

    const client = await this.pool.connect();
    try {
      await client.query(sql, [
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
      ]);
      return saved;
    } finally {
      client.release();
    }
  }

  async find(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
  ): Promise<ProviderTokenRecord | null> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          SELECT * FROM provider_tokens
          WHERE provider = $1 AND "ownerType" = $2 AND "ownerId" = $3
        `,
        [provider, ownerType, ownerId],
      );
      return result.rows[0] ? this.rowToRecord(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async list(options?: ProviderTokenListOptions): Promise<ProviderTokenRecord[]> {
    const listOptions = normalizeProviderTokenListOptions(options);
    await this.ready;
    let sql = "SELECT * FROM provider_tokens";
    const params: any[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (listOptions.provider) {
      conditions.push(`provider = $${paramIndex++}`);
      params.push(listOptions.provider);
    }
    if (listOptions.ownerType) {
      conditions.push(`"ownerType" = $${paramIndex++}`);
      params.push(listOptions.ownerType);
    }
    if (listOptions.ownerId) {
      conditions.push(`"ownerId" = $${paramIndex++}`);
      params.push(listOptions.ownerId);
    }
    if (listOptions.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(listOptions.status);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ' ORDER BY "updatedAt" DESC';

    if (listOptions.limit !== undefined) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(listOptions.limit);
    }
    if (listOptions.offset !== undefined) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(listOptions.offset);
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows.map((row) => this.rowToRecord(row));
    } finally {
      client.release();
    }
  }

  async listProbeCandidates(
    options: ProviderTokenProbeCandidateOptions,
  ): Promise<ProviderTokenRecord[]> {
    const probeOptions = normalizeProviderTokenProbeCandidateOptions(options);
    await this.ready;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          SELECT * FROM provider_tokens
          WHERE status != $1 AND (
            status != $2 OR "lastProbedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" <= $3
          )
          ORDER BY
            CASE
              WHEN status != $2 THEN 0
              WHEN "lastProbedAt" IS NULL THEN 1
              WHEN "expiresAt" IS NULL THEN 2
              ELSE 3
            END ASC,
            "lastProbedAt" ASC NULLS FIRST,
            "expiresAt" ASC NULLS FIRST,
            "updatedAt" ASC
          LIMIT $4
        `,
        ["revoked", "valid", probeOptions.expiresBefore, probeOptions.limit],
      );
      return result.rows.map((row) => this.rowToRecord(row));
    } finally {
      client.release();
    }
  }

  async updateStatus(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
    status: ProviderTokenStatus,
    lastError?: string,
  ): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query(
        `
          UPDATE provider_tokens
          SET status = $1, "lastError" = $2, "lastProbedAt" = $3, "updatedAt" = $4
          WHERE provider = $5 AND "ownerType" = $6 AND "ownerId" = $7
        `,
        [
          status,
          sanitizeTokenErrorText(lastError) ?? null,
          new Date(),
          new Date(),
          provider,
          ownerType,
          ownerId,
        ],
      );
    } finally {
      client.release();
    }
  }

  async delete(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
  ): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query(
        'DELETE FROM provider_tokens WHERE provider = $1 AND "ownerType" = $2 AND "ownerId" = $3',
        [provider, ownerType, ownerId],
      );
    } finally {
      client.release();
    }
  }

  async deleteByOwnerId(ownerId: string): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM provider_tokens WHERE "ownerId" = $1', [ownerId]);
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("DELETE FROM provider_tokens");
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    await this.pool.end();
  }

  private async initializeDatabase(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS provider_tokens (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          "ownerType" TEXT NOT NULL,
          "ownerId" TEXT NOT NULL,
          "accessToken" TEXT NOT NULL,
          "refreshToken" TEXT,
          "tokenType" TEXT,
          scope TEXT,
          "expiresAt" TIMESTAMP WITH TIME ZONE,
          "refreshExpiresAt" TIMESTAMP WITH TIME ZONE,
          status TEXT NOT NULL,
          "lastProbedAt" TIMESTAMP WITH TIME ZONE,
          "lastRefreshAt" TIMESTAMP WITH TIME ZONE,
          "lastError" TEXT,
          metadata JSONB,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          UNIQUE(provider, "ownerType", "ownerId")
        );

        CREATE INDEX IF NOT EXISTS idx_provider_tokens_lookup
        ON provider_tokens(provider, "ownerType", "ownerId");

        CREATE INDEX IF NOT EXISTS idx_provider_tokens_status
        ON provider_tokens(status);
      `);
    } finally {
      client.release();
    }
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
      expiresAt: record.expiresAt ?? null,
      refreshExpiresAt: record.refreshExpiresAt ?? null,
      status: record.status,
      lastProbedAt: record.lastProbedAt ?? null,
      lastRefreshAt: record.lastRefreshAt ?? null,
      lastError: sanitizeTokenErrorText(record.lastError) ?? null,
      metadata: record.metadata ?? null,
      createdAt: record.createdAt ?? new Date(),
      updatedAt: record.updatedAt ?? new Date(),
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
      expiresAt: row.expiresAt || undefined,
      refreshExpiresAt: row.refreshExpiresAt || undefined,
      status: row.status,
      lastProbedAt: row.lastProbedAt || undefined,
      lastRefreshAt: row.lastRefreshAt || undefined,
      lastError: sanitizeTokenErrorText(row.lastError),
      metadata: row.metadata || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
