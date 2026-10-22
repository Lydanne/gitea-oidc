import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Pool } from "pg";
import type { UserRepositoryConfig } from "../types/config.js";
import { TokenEncryptor } from "../utils/tokenCrypto.js";

export interface PasskeyRecord {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  name: string;
  createdAt: string;
}

/** 凭据与公开用户资料分表，按随机用户记录 ID 绑定，删除重建用户不会继承旧凭据。 */
export interface SecurityRecord {
  ownerId: string;
  username: string;
  revision: string;
  passwordHash?: string;
  mustChangePassword?: boolean;
  bootstrapPassword?: string;
  bootstrapPending?: boolean;
  bootstrapGroup?: string;
  totpSecret?: string;
  totpLastCounter?: number;
  recoveryCodeHashes?: string[];
  passkeys: PasskeyRecord[];
}

export interface SecurityRepository {
  get(key: string): Promise<SecurityRecord | null>;
  compareAndSet(key: string, expected: string | null, record: SecurityRecord): Promise<boolean>;
  close(): Promise<void>;
}

/** Cookie Key 轮换时保留旧 Key，启动时将旧密文迁移到当前 Key。 */
class SecurityPayloadCipher {
  private encryptors: TokenEncryptor[];
  constructor(keys: string | string[]) {
    this.encryptors = (Array.isArray(keys) ? keys : [keys]).map((key) => new TokenEncryptor(key));
    if (this.encryptors.length === 0)
      throw new Error("Account security encryption key is required");
  }
  encrypt(value: string): string {
    return this.encryptors[0].encrypt(value);
  }
  decrypt(value: string): { plaintext: string; rotated?: string } {
    for (const [index, encryptor] of this.encryptors.entries()) {
      try {
        const plaintext = encryptor.decrypt(value);
        return { plaintext, ...(index > 0 ? { rotated: this.encrypt(plaintext) } : {}) };
      } catch {
        /* 仅尝试配置中的 Key，不输出凭据或底层解密异常。 */
      }
    }
    throw new Error(
      "Unable to decrypt account security data; retain the previous oidc.cookieKeys during rotation",
    );
  }
}

export class MemorySecurityRepository implements SecurityRepository {
  private records = new Map<string, SecurityRecord>();
  async get(key: string): Promise<SecurityRecord | null> {
    return structuredClone(this.records.get(key) ?? null);
  }
  async compareAndSet(
    key: string,
    expected: string | null,
    record: SecurityRecord,
  ): Promise<boolean> {
    if ((this.records.get(key)?.revision ?? null) !== expected) return false;
    this.records.set(key, structuredClone(record));
    return true;
  }
  async close(): Promise<void> {
    this.records.clear();
  }
}

export class SqliteSecurityRepository implements SecurityRepository {
  private db: Database.Database;
  private encryptor: SecurityPayloadCipher;
  constructor(path: string, encryptionKey: string | string[]) {
    this.encryptor = new SecurityPayloadCipher(encryptionKey);
    this.db = new Database(path);
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS account_security (id TEXT PRIMARY KEY, revision TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    try {
      for (const row of this.db.prepare("SELECT id, payload FROM account_security").all() as {
        id: string;
        payload: string;
      }[]) {
        const { rotated } = this.encryptor.decrypt(row.payload);
        if (rotated)
          this.db
            .prepare("UPDATE account_security SET payload = ? WHERE id = ? AND payload = ?")
            .run(rotated, row.id, row.payload);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  async get(key: string): Promise<SecurityRecord | null> {
    const row = this.db.prepare("SELECT payload FROM account_security WHERE id = ?").get(key) as
      | { payload: string }
      | undefined;
    return row ? JSON.parse(this.encryptor.decrypt(row.payload).plaintext) : null;
  }
  async compareAndSet(
    key: string,
    expected: string | null,
    record: SecurityRecord,
  ): Promise<boolean> {
    const payload = this.encryptor.encrypt(JSON.stringify(record));
    const result =
      expected === null
        ? this.db
            .prepare(
              "INSERT INTO account_security (id, revision, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
            )
            .run(key, record.revision, payload)
        : this.db
            .prepare(
              "UPDATE account_security SET revision = ?, payload = ? WHERE id = ? AND revision = ?",
            )
            .run(record.revision, payload, key, expected);
    return result.changes === 1;
  }
  async close(): Promise<void> {
    this.db.close();
  }
}

export class PgsqlSecurityRepository implements SecurityRepository {
  private pool: Pool;
  private ready: Promise<unknown>;
  private encryptor: SecurityPayloadCipher;
  constructor(
    config: NonNullable<UserRepositoryConfig["pgsql"]>,
    encryptionKey: string | string[],
  ) {
    this.encryptor = new SecurityPayloadCipher(encryptionKey);
    this.pool = new Pool(
      config.connectionString
        ? { connectionString: config.connectionString }
        : {
            host: config.host,
            port: config.port ?? 5432,
            database: config.database ?? "x_oidc",
            user: config.user ?? "postgres",
            password: config.password,
          },
    );
    this.ready = this.initialize();
  }
  private async initialize(): Promise<void> {
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS account_security (id TEXT PRIMARY KEY, revision TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    const result = await this.pool.query("SELECT id, payload FROM account_security");
    for (const row of result.rows) {
      const { rotated } = this.encryptor.decrypt(row.payload);
      if (rotated)
        await this.pool.query(
          "UPDATE account_security SET payload = $1 WHERE id = $2 AND payload = $3",
          [rotated, row.id, row.payload],
        );
    }
  }
  async get(key: string): Promise<SecurityRecord | null> {
    await this.ready;
    const result = await this.pool.query("SELECT payload FROM account_security WHERE id = $1", [
      key,
    ]);
    return result.rows[0]
      ? JSON.parse(this.encryptor.decrypt(result.rows[0].payload).plaintext)
      : null;
  }
  async compareAndSet(
    key: string,
    expected: string | null,
    record: SecurityRecord,
  ): Promise<boolean> {
    await this.ready;
    const payload = this.encryptor.encrypt(JSON.stringify(record));
    const result =
      expected === null
        ? await this.pool.query(
            "INSERT INTO account_security (id, revision, payload) VALUES ($1, $2, $3) ON CONFLICT(id) DO NOTHING",
            [key, record.revision, payload],
          )
        : await this.pool.query(
            "UPDATE account_security SET revision = $1, payload = $2 WHERE id = $3 AND revision = $4",
            [record.revision, payload, key, expected],
          );
    return result.rowCount === 1;
  }
  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    await this.pool.end();
  }
}

export function createSecurityRepository(
  config: UserRepositoryConfig,
  encryptionKey: string | string[],
): SecurityRepository {
  switch (config.type) {
    case "memory":
      return new MemorySecurityRepository();
    case "sqlite":
      return new SqliteSecurityRepository(config.sqlite?.dbPath ?? "./users.db", encryptionKey);
    case "pgsql": {
      if (!config.pgsql) throw new Error("PostgreSQL configuration is required");
      return new PgsqlSecurityRepository(config.pgsql, encryptionKey);
    }
  }
}

export function newSecurityRecord(ownerId: string, username: string): SecurityRecord {
  return { ownerId, username, revision: randomUUID(), passkeys: [] };
}
