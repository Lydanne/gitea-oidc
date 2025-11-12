import Database from 'better-sqlite3';
import { Adapter } from 'oidc-provider';

export class SqliteOidcAdapter implements Adapter {
  private db: Database.Database;
  private name: string;

  constructor(name: string) {
    this.name = name;

    // 创建或打开数据库
    this.db = new Database('./oidc.db');

    // 创建表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oidc_store (
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        expires_at INTEGER,
        consumed_at INTEGER,
        PRIMARY KEY (name, key)
      );
      CREATE INDEX IF NOT EXISTS idx_oidc_expires ON oidc_store (expires_at);
      CREATE INDEX IF NOT EXISTS idx_oidc_consumed ON oidc_store (consumed_at);
    `);

    // 清理过期数据的定时任务
    setInterval(() => {
      this.cleanup();
    }, 60000); // 每分钟清理一次
  }

  private cleanup() {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare('DELETE FROM oidc_store WHERE expires_at < ?').run(now);
  }

  async upsert(key: string, payload: any, expiresIn?: number) {
    const expires_at = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null;
    const value = JSON.stringify(payload);

    this.db.prepare(`
      INSERT OR REPLACE INTO oidc_store (name, key, value, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(this.name, key, value, expires_at);
  }

  async find(key: string): Promise<any> {
    const row = this.db.prepare(`
      SELECT value FROM oidc_store
      WHERE name = ? AND key = ? AND (expires_at IS NULL OR expires_at > ?)
    `).get(this.name, key, Math.floor(Date.now() / 1000)) as { value: string } | undefined;

    if (row) {
      return JSON.parse(row.value);
    }
    return undefined;
  }

  async findByUserCode(userCode: string): Promise<any> {
    const row = this.db.prepare(`
      SELECT value FROM oidc_store
      WHERE name = ? AND json_extract(value, '$.userCode') = ? AND (expires_at IS NULL OR expires_at > ?)
    `).get(this.name, userCode, Math.floor(Date.now() / 1000)) as { value: string } | undefined;

    if (row) {
      return JSON.parse(row.value);
    }
    return undefined;
  }

  async findByUid(uid: string): Promise<any> {
    const row = this.db.prepare(`
      SELECT value FROM oidc_store
      WHERE name = ? AND json_extract(value, '$.uid') = ? AND (expires_at IS NULL OR expires_at > ?)
    `).get(this.name, uid, Math.floor(Date.now() / 1000)) as { value: string } | undefined;

    if (row) {
      return JSON.parse(row.value);
    }
    return undefined;
  }

  async consume(key: string): Promise<any> {
    const now = Math.floor(Date.now() / 1000);
    const row = this.db.prepare(`
      SELECT value FROM oidc_store
      WHERE name = ? AND key = ? AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    `).get(this.name, key, now) as { value: string } | undefined;

    if (row) {
      this.db.prepare(`
        UPDATE oidc_store SET consumed_at = ? WHERE name = ? AND key = ?
      `).run(now, this.name, key);
      return JSON.parse(row.value);
    }
    return undefined;
  }

  async destroy(key: string) {
    this.db.prepare('DELETE FROM oidc_store WHERE name = ? AND key = ?').run(this.name, key);
  }

  async revokeByGrantId(grantId: string) {
    this.db.prepare('DELETE FROM oidc_store WHERE name = ? AND json_extract(value, "$.grantId") = ?').run(this.name, grantId);
  }
}
