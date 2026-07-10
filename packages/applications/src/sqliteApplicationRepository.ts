import { chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { issuerUrlSchema } from "@gitea-oidc/contracts";
import Database from "better-sqlite3";
import {
  ApplicationConflictError,
  ApplicationRepositoryClosedError,
  ApplicationStorageCorruptionError,
  ApplicationValidationError,
  ApplicationVersionConflictError,
  IdempotencyConflictError,
} from "./errors.js";
import {
  ApplicationAuditEventSchema,
  ApplicationIdempotencyRecordSchema,
  migrateStoredApplicationAggregate,
  parseApplicationAuditEvent,
  parseApplicationIdempotencyRecord,
  parseStoredApplicationAggregate,
  StoredApplicationAggregateSchema,
} from "./persistenceSchemas.js";
import type {
  ApplicationRepository,
  ApplicationRepositoryReader,
  ApplicationRepositoryTransaction,
} from "./repository.js";
import { createApplicationRepositoryReader } from "./repository.js";
import type {
  ApplicationAuditEvent,
  ApplicationIdempotencyRecord,
  StoredApplicationAggregate,
} from "./types.js";

interface AggregateRow {
  id: string;
  slug: string;
  version: number;
  data: string;
}

interface IdempotencyRow {
  key_hash: string;
  request_hash: string;
  application_id: string;
  created_at: string;
}

interface AuditRow {
  data: string;
}

interface ClientIndexRow {
  application_id: string;
}

export interface SqliteApplicationRepositoryOptions {
  dbPath: string;
  /** 用于把未版本化旧数据库中的 aggregate 迁移为带 issuer 的当前格式。 */
  connectionIssuer: string;
  busyTimeoutMs?: number;
}

const APPLICATION_STORAGE_VERSION = 1;

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}

function validateAggregateForWrite(
  aggregate: StoredApplicationAggregate,
): StoredApplicationAggregate {
  const result = StoredApplicationAggregateSchema.safeParse(aggregate);
  if (!result.success) {
    throw new ApplicationValidationError("Application aggregate 不符合持久化 schema", {
      cause: result.error,
    });
  }
  return result.data;
}

class SqliteApplicationTransaction implements ApplicationRepositoryTransaction {
  private active = true;

  public constructor(private readonly db: Database.Database) {}

  public invalidate(): void {
    this.active = false;
  }

  public async findById(id: string): Promise<StoredApplicationAggregate | undefined> {
    this.assertActive();
    const row = this.db
      .prepare("SELECT id, slug, version, data FROM application_aggregates WHERE id = ?")
      .get(id) as AggregateRow | undefined;
    return row === undefined ? undefined : this.parseAggregateRow(row);
  }

  public async findBySlug(slug: string): Promise<StoredApplicationAggregate | undefined> {
    this.assertActive();
    const row = this.db
      .prepare("SELECT id, slug, version, data FROM application_aggregates WHERE slug = ?")
      .get(slug) as AggregateRow | undefined;
    return row === undefined ? undefined : this.parseAggregateRow(row);
  }

  public async findByClientId(clientId: string): Promise<StoredApplicationAggregate | undefined> {
    this.assertActive();
    const index = this.db
      .prepare("SELECT application_id FROM application_client_index WHERE client_id = ?")
      .get(clientId) as ClientIndexRow | undefined;
    if (index === undefined) {
      return undefined;
    }
    const aggregate = await this.findById(index.application_id);
    if (
      aggregate === undefined ||
      !aggregate.clients.some((client) => client.clientId === clientId)
    ) {
      throw new ApplicationStorageCorruptionError("client index");
    }
    return aggregate;
  }

  public async list(): Promise<StoredApplicationAggregate[]> {
    this.assertActive();
    const rows = this.db
      .prepare(
        `SELECT id, slug, version, data
         FROM application_aggregates
         ORDER BY json_extract(data, '$.application.createdAt') DESC, id ASC`,
      )
      .all() as AggregateRow[];
    return rows.map((row) => this.parseAggregateRow(row));
  }

  public async insert(aggregate: StoredApplicationAggregate): Promise<void> {
    this.assertActive();
    const validated = validateAggregateForWrite(aggregate);
    try {
      this.db
        .prepare(
          `INSERT INTO application_aggregates (id, slug, version, data)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          validated.application.id,
          validated.application.slug,
          validated.application.version,
          JSON.stringify(validated),
        );
      this.insertClientIndex(validated);
    } catch (error) {
      if (isConstraintError(error)) {
        throw new ApplicationConflictError("应用 ID、slug 或 OIDC client_id 已存在");
      }
      throw error;
    }
  }

  public async update(
    aggregate: StoredApplicationAggregate,
    expectedVersion: number,
  ): Promise<void> {
    this.assertActive();
    const current = await this.findById(aggregate.application.id);
    if (current === undefined) {
      throw new ApplicationConflictError(`无法更新不存在的应用: ${aggregate.application.id}`);
    }
    if (current.application.version !== expectedVersion) {
      throw new ApplicationVersionConflictError(
        aggregate.application.id,
        expectedVersion,
        current.application.version,
      );
    }

    const validated = validateAggregateForWrite(aggregate);
    try {
      const result = this.db
        .prepare(
          `UPDATE application_aggregates
           SET slug = ?, version = ?, data = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          validated.application.slug,
          validated.application.version,
          JSON.stringify(validated),
          validated.application.id,
          expectedVersion,
        );
      if (result.changes !== 1) {
        const actual = this.db
          .prepare("SELECT version FROM application_aggregates WHERE id = ?")
          .pluck()
          .get(validated.application.id) as number | undefined;
        throw new ApplicationVersionConflictError(
          validated.application.id,
          expectedVersion,
          actual ?? 0,
        );
      }
      this.db
        .prepare("DELETE FROM application_client_index WHERE application_id = ?")
        .run(validated.application.id);
      this.insertClientIndex(validated);
    } catch (error) {
      if (isConstraintError(error)) {
        throw new ApplicationConflictError("应用 slug 或 OIDC client_id 已存在");
      }
      throw error;
    }
  }

  public async findIdempotencyRecord(
    keyHash: string,
  ): Promise<ApplicationIdempotencyRecord | undefined> {
    this.assertActive();
    const row = this.db
      .prepare(
        `SELECT key_hash, request_hash, application_id, created_at
         FROM application_idempotency WHERE key_hash = ?`,
      )
      .get(keyHash) as IdempotencyRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return parseApplicationIdempotencyRecord({
      keyHash: row.key_hash,
      requestHash: row.request_hash,
      applicationId: row.application_id,
      createdAt: row.created_at,
    });
  }

  public async insertIdempotencyRecord(record: ApplicationIdempotencyRecord): Promise<void> {
    this.assertActive();
    const parsed = ApplicationIdempotencyRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new ApplicationValidationError("Idempotency record 不符合持久化 schema", {
        cause: parsed.error,
      });
    }
    try {
      this.db
        .prepare(
          `INSERT INTO application_idempotency
           (key_hash, request_hash, application_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(record.keyHash, record.requestHash, record.applicationId, record.createdAt);
    } catch (error) {
      if (isConstraintError(error)) {
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }

  public async appendAuditEvent(event: ApplicationAuditEvent): Promise<void> {
    this.assertActive();
    const parsed = ApplicationAuditEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new ApplicationValidationError("Audit event 不符合持久化 schema", {
        cause: parsed.error,
      });
    }
    try {
      this.db
        .prepare(
          `INSERT INTO application_audit (id, application_id, occurred_at, data)
           VALUES (?, ?, ?, ?)`,
        )
        .run(event.id, event.applicationId, event.occurredAt, JSON.stringify(parsed.data));
    } catch (error) {
      if (isConstraintError(error)) {
        throw new ApplicationConflictError("审计事件 ID 已存在或应用不存在");
      }
      throw error;
    }
  }

  public async listAuditEvents(applicationId: string): Promise<ApplicationAuditEvent[]> {
    this.assertActive();
    const rows = this.db
      .prepare(
        `SELECT data FROM application_audit
         WHERE application_id = ? ORDER BY rowid ASC`,
      )
      .all(applicationId) as AuditRow[];
    return rows.map((row) => parseApplicationAuditEvent(row.data));
  }

  private insertClientIndex(aggregate: StoredApplicationAggregate): void {
    const insert = this.db.prepare(
      `INSERT INTO application_client_index (client_id, application_id)
       VALUES (?, ?)`,
    );
    for (const client of aggregate.clients) {
      insert.run(client.clientId, aggregate.application.id);
    }
  }

  private parseAggregateRow(row: AggregateRow): StoredApplicationAggregate {
    const aggregate = parseStoredApplicationAggregate(row.data);
    if (
      aggregate.application.id !== row.id ||
      aggregate.application.slug !== row.slug ||
      aggregate.application.version !== row.version
    ) {
      throw new ApplicationStorageCorruptionError("Application aggregate index");
    }
    return aggregate;
  }

  private assertActive(): void {
    if (!this.active) {
      throw new ApplicationRepositoryClosedError();
    }
  }
}

export class SqliteApplicationRepository implements ApplicationRepository {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  private operationTail: Promise<void> = Promise.resolve();
  private closing = false;
  private closed = false;
  private closePromise?: Promise<void>;

  public constructor(options: SqliteApplicationRepositoryOptions) {
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    const connectionIssuer = issuerUrlSchema.safeParse(options.connectionIssuer);
    if (options.dbPath.trim() === "") {
      throw new ApplicationValidationError("SQLite dbPath 不能为空");
    }
    if (!connectionIssuer.success) {
      throw new ApplicationValidationError("SQLite connectionIssuer 必须是有效的 OIDC issuer", {
        cause: connectionIssuer.error,
      });
    }
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60_000) {
      throw new ApplicationValidationError("SQLite busyTimeoutMs 必须是 0 到 60000 的整数");
    }
    this.dbPath = options.dbPath === ":memory:" ? ":memory:" : resolve(options.dbPath);
    this.db = new Database(this.dbPath);
    try {
      this.db.pragma("foreign_keys = ON");
      this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = FULL");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS application_aggregates (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          version INTEGER NOT NULL,
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS application_client_index (
          client_id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL REFERENCES application_aggregates(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_application_client_application
          ON application_client_index(application_id);
        CREATE TABLE IF NOT EXISTS application_idempotency (
          key_hash TEXT PRIMARY KEY,
          request_hash TEXT NOT NULL,
          application_id TEXT NOT NULL REFERENCES application_aggregates(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS application_audit (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL REFERENCES application_aggregates(id) ON DELETE RESTRICT,
          occurred_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_application_audit_application
          ON application_audit(application_id, occurred_at);
        CREATE TABLE IF NOT EXISTS application_repository_metadata (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          schema_version INTEGER NOT NULL
        );
      `);
      this.initializeStorage(connectionIssuer.data);
      this.restrictDatabasePermissions();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  public read<T>(operation: (reader: ApplicationRepositoryReader) => Promise<T>): Promise<T> {
    if (this.closing || this.closed) {
      return Promise.reject(new ApplicationRepositoryClosedError());
    }

    const run = this.operationTail.then(async () => {
      if (this.closed) {
        throw new ApplicationRepositoryClosedError();
      }
      const transaction = new SqliteApplicationTransaction(this.db);
      try {
        return await operation(createApplicationRepositoryReader(transaction));
      } finally {
        transaction.invalidate();
      }
    });
    this.operationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public transaction<T>(
    operation: (transaction: ApplicationRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.closing || this.closed) {
      return Promise.reject(new ApplicationRepositoryClosedError());
    }

    const run = this.operationTail.then(async () => {
      if (this.closed) {
        throw new ApplicationRepositoryClosedError();
      }
      this.db.exec("BEGIN IMMEDIATE");
      const transaction = new SqliteApplicationTransaction(this.db);
      try {
        const result = await operation(transaction);
        this.restrictDatabasePermissions();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        if (this.db.inTransaction) {
          this.db.exec("ROLLBACK");
        }
        throw error;
      } finally {
        transaction.invalidate();
      }
    });
    this.operationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    if (this.closed) {
      return Promise.resolve();
    }

    this.closing = true;
    this.closePromise = this.operationTail.then(() => {
      let permissionError: unknown;
      try {
        this.restrictDatabasePermissions();
      } catch (error) {
        permissionError = error;
      }
      this.db.close();
      this.closed = true;
      if (permissionError !== undefined) {
        throw permissionError;
      }
    });
    this.operationTail = this.closePromise.then(
      () => undefined,
      () => undefined,
    );
    return this.closePromise;
  }

  private initializeStorage(connectionIssuer: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const schemaVersion = this.db
        .prepare(
          `SELECT schema_version
           FROM application_repository_metadata
           WHERE singleton = 1`,
        )
        .pluck()
        .get() as number | undefined;
      if (schemaVersion !== undefined && schemaVersion !== APPLICATION_STORAGE_VERSION) {
        throw new ApplicationStorageCorruptionError("Application repository metadata");
      }
      if (schemaVersion === undefined) {
        const rows = this.db
          .prepare("SELECT id, slug, version, data FROM application_aggregates ORDER BY id ASC")
          .all() as AggregateRow[];
        const update = this.db.prepare("UPDATE application_aggregates SET data = ? WHERE id = ?");
        for (const row of rows) {
          const migration = migrateStoredApplicationAggregate(row.data, connectionIssuer);
          if (
            migration.aggregate.application.id !== row.id ||
            migration.aggregate.application.slug !== row.slug ||
            migration.aggregate.application.version !== row.version
          ) {
            throw new ApplicationStorageCorruptionError("Application aggregate index");
          }
          if (migration.migrated) {
            update.run(JSON.stringify(migration.aggregate), row.id);
          }
        }
        this.db
          .prepare(
            `INSERT INTO application_repository_metadata (singleton, schema_version)
             VALUES (1, ?)`,
          )
          .run(APPLICATION_STORAGE_VERSION);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      if (this.db.inTransaction) {
        this.db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  private restrictDatabasePermissions(): void {
    if (process.platform === "win32" || this.dbPath === ":memory:") {
      return;
    }
    for (const filePath of [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]) {
      if (existsSync(filePath)) {
        chmodSync(filePath, 0o600);
      }
    }
  }
}
