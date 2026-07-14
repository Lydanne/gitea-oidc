import Database from "better-sqlite3";
import { chmodSync, existsSync } from "fs";
import type { Adapter } from "oidc-provider";
import { resolve } from "path";
import { assertOidcWriteAllowed } from "./oidcClientRevocationBarrier.js";

interface SharedSqliteConnection {
  db: Database.Database;
  cleanupTimer: NodeJS.Timeout;
  dbPath: string;
}

/**
 * SQLite OIDC 适配器。
 *
 * 同一个数据库路径只保留一个连接和一个清理定时器；oidc-provider 会为每个模型创建
 * 一个 adapter，若每个模型各自打开连接会导致 SQLite 锁竞争和无法释放的定时器。
 */
export class SqliteOidcAdapter implements Adapter {
  private static connections = new Map<string, SharedSqliteConnection>();

  private readonly name: string;
  private readonly connection: SharedSqliteConnection;

  constructor(name: string, dbPath = "./oidc.db") {
    this.name = name;
    this.connection = SqliteOidcAdapter.getConnection(dbPath);
  }

  private static getConnection(dbPath: string): SharedSqliteConnection {
    const normalizedPath = dbPath === ":memory:" ? dbPath : resolve(dbPath);
    const existing = SqliteOidcAdapter.connections.get(normalizedPath);
    if (existing) {
      return existing;
    }

    const db = new Database(normalizedPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS oidc_store (
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        consumed_at INTEGER,
        PRIMARY KEY (name, key)
      );
      CREATE INDEX IF NOT EXISTS idx_oidc_expires ON oidc_store (expires_at);
      CREATE INDEX IF NOT EXISTS idx_oidc_consumed ON oidc_store (consumed_at);
      CREATE INDEX IF NOT EXISTS idx_oidc_grant ON oidc_store (name, json_extract(value, '$.grantId'));
      CREATE INDEX IF NOT EXISTS idx_oidc_account ON oidc_store (json_extract(value, '$.accountId'));
      CREATE INDEX IF NOT EXISTS idx_oidc_client ON oidc_store (json_extract(value, '$.clientId'));
      CREATE INDEX IF NOT EXISTS idx_oidc_interaction_client
        ON oidc_store (json_extract(value, '$.params.client_id'));
    `);

    const connection: SharedSqliteConnection = {
      db,
      dbPath: normalizedPath,
      cleanupTimer: setInterval(() => {
        db.prepare("DELETE FROM oidc_store WHERE expires_at IS NOT NULL AND expires_at <= ?").run(
          nowInSeconds(),
        );
      }, 60_000),
    };
    connection.cleanupTimer.unref?.();
    SqliteOidcAdapter.connections.set(normalizedPath, connection);
    restrictDatabasePermissions(normalizedPath);
    return connection;
  }

  private get db(): Database.Database {
    return this.connection.db;
  }

  async upsert(key: string, payload: any, expiresIn?: number): Promise<void> {
    assertOidcWriteAllowed(payload);
    const expiresAt = expiresIn === undefined ? null : nowInSeconds() + expiresIn;
    this.db
      .prepare(
        `INSERT INTO oidc_store (name, key, value, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(name, key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at,
           consumed_at = NULL`,
      )
      .run(this.name, key, JSON.stringify(payload), expiresAt);
    restrictDatabasePermissions(this.connection.dbPath);
  }

  async find(key: string): Promise<any> {
    return this.findOne("name = ? AND key = ? AND (expires_at IS NULL OR expires_at > ?)", [
      this.name,
      key,
      nowInSeconds(),
    ]);
  }

  async findByUserCode(userCode: string): Promise<any> {
    return this.findOne(
      "name = ? AND json_extract(value, '$.userCode') = ? AND (expires_at IS NULL OR expires_at > ?)",
      [this.name, userCode, nowInSeconds()],
    );
  }

  async findByUid(uid: string): Promise<any> {
    return this.findOne(
      "name = ? AND json_extract(value, '$.uid') = ? AND (expires_at IS NULL OR expires_at > ?)",
      [this.name, uid, nowInSeconds()],
    );
  }

  /**
   * 将 payload.consumed 与 consumed_at 在同一条件更新中写入。
   * oidc-provider 随后的 find() 会看到 payload.consumed，从而拒绝顺序重放；
   * 并发的第二个 consume 则因条件更新失败而中止本次令牌交换。
   */
  async consume(key: string): Promise<void> {
    const now = nowInSeconds();
    const consume = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT value FROM oidc_store
           WHERE name = ? AND key = ? AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .get(this.name, key, now) as { value: string } | undefined;

      if (!row) {
        return "missing";
      }

      const payload = JSON.parse(row.value);
      payload.consumed = now;
      const result = this.db
        .prepare(
          `UPDATE oidc_store SET value = ?, consumed_at = ?
           WHERE name = ? AND key = ? AND consumed_at IS NULL
             AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .run(JSON.stringify(payload), now, this.name, key, now);
      return result.changes === 1 ? "consumed" : "already-consumed";
    });

    const result = consume();
    if (result === "missing") {
      return;
    }
    if (result !== "consumed") {
      throw new Error(`OIDC ${this.name} record has already been consumed`);
    }
    restrictDatabasePermissions(this.connection.dbPath);
  }

  async destroy(key: string): Promise<void> {
    this.db.prepare("DELETE FROM oidc_store WHERE name = ? AND key = ?").run(this.name, key);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    this.db
      .prepare("DELETE FROM oidc_store WHERE name = ? AND json_extract(value, '$.grantId') = ?")
      .run(this.name, grantId);
  }

  /** 删除指定账户全部 OIDC 模型记录，供用户删除和身份重绑调用。 */
  static async revokeByAccountId(dbPath: string, accountId: string): Promise<void> {
    const connection = SqliteOidcAdapter.getConnection(dbPath);
    connection.db
      .prepare("DELETE FROM oidc_store WHERE json_extract(value, '$.accountId') = ?")
      .run(accountId);
  }

  /** 删除指定 Client 的全部 Grant、Code 和 Token 等 OIDC 记录。 */
  static async revokeByClientId(dbPath: string, clientId: string): Promise<void> {
    const connection = SqliteOidcAdapter.getConnection(dbPath);
    connection.db
      .prepare(
        `DELETE FROM oidc_store
         WHERE json_extract(value, '$.clientId') = ?
            OR json_extract(value, '$.client_id') = ?
            OR json_extract(value, '$.params.client_id') = ?`,
      )
      .run(clientId, clientId, clientId);
  }

  static async closeAll(): Promise<void> {
    for (const connection of SqliteOidcAdapter.connections.values()) {
      clearInterval(connection.cleanupTimer);
      connection.db.close();
    }
    SqliteOidcAdapter.connections.clear();
  }

  private findOne(where: string, params: unknown[]): any {
    const row = this.db
      .prepare(`SELECT value FROM oidc_store WHERE ${where} LIMIT 1`)
      .get(...params) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function restrictDatabasePermissions(dbPath: string): void {
  if (process.platform === "win32" || dbPath === ":memory:") {
    return;
  }

  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) {
      chmodSync(path, 0o600);
    }
  }
}
