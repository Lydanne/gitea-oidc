import { AsyncLocalStorage } from "node:async_hooks";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AuthSessionStore,
  LoginTransaction,
  LoginTransactionStore,
  RefreshLock,
  SensitiveAuthSessionRecord,
} from "@x-oidc/node";
import Database from "better-sqlite3";
import { SqliteOidcStoreError, sqliteStoreError } from "./errors.js";
import { parseAuthSession, parseLoginTransaction } from "./schemas.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_LEASE_MS = 60_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 100;
const MAXIMUM_BUSY_TIMEOUT_MS = 60_000;
const MAXIMUM_LOCK_LEASE_MS = 5 * 60_000;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const OWNER_NAMESPACE_PATTERN = /^owner-v1:[A-Za-z0-9_-]{43}$/u;
const STORAGE_FORMAT_VERSION = 1;

type EncryptedTable = "session" | "transaction";
type LookupDomain = EncryptedTable | "refresh-lock";

interface EncryptedRow {
  owner_namespace: string;
  opaque_id: string;
  record_version: number;
  expires_at: number;
  key_id: string;
  iv: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
}

export interface SqliteOidcStoresOptions {
  /** 建议使用独立数据库文件，不要与服务端 ApplicationRepository 共用。 */
  readonly dbPath: string;
  /** 恰好 32 字节；调用方应从 Secret Manager 解码后传入。 */
  readonly encryptionKey: Uint8Array;
  readonly keyId?: string;
  readonly busyTimeoutMs?: number;
  readonly lockLeaseMs?: number;
  readonly lockPollIntervalMs?: number;
}

export interface SqliteOidcStores {
  readonly transactionStore: LoginTransactionStore;
  readonly sessionStore: AuthSessionStore;
  readonly refreshLock: RefreshLock;
  /** 先关闭 Node client，再关闭 stores。该方法幂等并等待在途 refresh operation。 */
  close(): Promise<void>;
}

interface ValidatedOptions {
  dbPath: string;
  encryptionKey: Buffer;
  keyId: string;
  busyTimeoutMs: number;
  lockLeaseMs: number;
  lockPollIntervalMs: number;
}

const validateInteger = (value: number, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw sqliteStoreError("INVALID_CONFIGURATION");
  }
  return value;
};

const validateOptions = (options: SqliteOidcStoresOptions): ValidatedOptions => {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.dbPath !== "string" ||
    options.dbPath.length === 0 ||
    options.dbPath.trim() !== options.dbPath ||
    !(options.encryptionKey instanceof Uint8Array) ||
    options.encryptionKey.byteLength !== 32
  ) {
    throw sqliteStoreError("INVALID_CONFIGURATION");
  }
  const keyId = options.keyId ?? "node-sessions-v1";
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw sqliteStoreError("INVALID_CONFIGURATION");
  }
  const lockLeaseMs = validateInteger(
    options.lockLeaseMs ?? DEFAULT_LOCK_LEASE_MS,
    1_000,
    MAXIMUM_LOCK_LEASE_MS,
  );
  const lockPollIntervalMs = validateInteger(
    options.lockPollIntervalMs ?? DEFAULT_LOCK_POLL_INTERVAL_MS,
    10,
    Math.max(10, Math.floor(lockLeaseMs / 3)),
  );
  return {
    dbPath: options.dbPath === ":memory:" ? options.dbPath : resolve(options.dbPath),
    encryptionKey: Buffer.from(options.encryptionKey),
    keyId,
    busyTimeoutMs: validateInteger(
      options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
      1,
      MAXIMUM_BUSY_TIMEOUT_MS,
    ),
    lockLeaseMs,
    lockPollIntervalMs,
  };
};

const validateLookupKey = (ownerNamespace: string, opaqueId: string): void => {
  if (!OWNER_NAMESPACE_PATTERN.test(ownerNamespace) || !OPAQUE_ID_PATTERN.test(opaqueId)) {
    throw sqliteStoreError("STORAGE_FAILED");
  }
};

const wrapStorageError = (error: unknown): never => {
  if (error instanceof SqliteOidcStoreError) throw error;
  throw sqliteStoreError("STORAGE_FAILED");
};

class EncryptedRecordCodec {
  readonly #keyId: string;
  readonly #key: Buffer;
  #closed = false;

  constructor(keyId: string, key: Buffer) {
    this.#keyId = keyId;
    this.#key = key;
  }

  encrypt(
    table: EncryptedTable,
    ownerNamespace: string,
    lookupKey: string,
    recordVersion: number,
    value: unknown,
  ): Pick<EncryptedRow, "key_id" | "iv" | "ciphertext" | "auth_tag"> {
    this.#assertOpen();
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
      cipher.setAAD(this.#aad(table, ownerNamespace, lookupKey, recordVersion));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return {
        key_id: this.#keyId,
        iv,
        ciphertext,
        auth_tag: cipher.getAuthTag(),
      };
    } catch {
      throw sqliteStoreError("STORAGE_FAILED");
    }
  }

  decrypt(table: EncryptedTable, row: EncryptedRow): unknown {
    this.#assertOpen();
    if (
      row.key_id !== this.#keyId ||
      !(row.iv instanceof Uint8Array) ||
      row.iv.byteLength !== 12 ||
      !(row.auth_tag instanceof Uint8Array) ||
      row.auth_tag.byteLength !== 16 ||
      !(row.ciphertext instanceof Uint8Array) ||
      row.ciphertext.byteLength === 0
    ) {
      throw sqliteStoreError("CORRUPTED_DATA");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(row.iv));
      decipher.setAAD(this.#aad(table, row.owner_namespace, row.opaque_id, row.record_version));
      decipher.setAuthTag(Buffer.from(row.auth_tag));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext)),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8"));
    } catch {
      throw sqliteStoreError("CORRUPTED_DATA");
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#key.fill(0);
  }

  #aad(
    table: EncryptedTable,
    ownerNamespace: string,
    lookupKey: string,
    recordVersion: number,
  ): Buffer {
    return Buffer.from(
      JSON.stringify(["x-oidc-node-sqlite-v1", table, ownerNamespace, lookupKey, recordVersion]),
      "utf8",
    );
  }

  #assertOpen(): void {
    if (this.#closed) throw sqliteStoreError("CLOSED");
  }
}

class LookupKeyCodec {
  readonly #keys: Record<LookupDomain, Buffer>;
  #closed = false;

  constructor(encryptionKey: Buffer) {
    const derivedKeys: Buffer[] = [];
    try {
      const derive = (domain: LookupDomain): Buffer => {
        const key = createHmac("sha256", encryptionKey)
          .update(JSON.stringify(["x-oidc-node-sqlite-lookup-key-v1", domain]), "utf8")
          .digest();
        derivedKeys.push(key);
        return key;
      };
      this.#keys = {
        transaction: derive("transaction"),
        session: derive("session"),
        "refresh-lock": derive("refresh-lock"),
      };
    } catch {
      for (const key of derivedKeys) key.fill(0);
      throw sqliteStoreError("STORAGE_FAILED");
    }
  }

  create(domain: LookupDomain, ownerNamespace: string, opaqueId: string): string {
    this.#assertOpen();
    try {
      return createHmac("sha256", this.#keys[domain])
        .update(JSON.stringify(["x-oidc-node-sqlite-lookup-v1", ownerNamespace, opaqueId]), "utf8")
        .digest("base64url");
    } catch {
      throw sqliteStoreError("STORAGE_FAILED");
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const key of Object.values(this.#keys)) key.fill(0);
  }

  #assertOpen(): void {
    if (this.#closed) throw sqliteStoreError("CLOSED");
  }
}

const createDatabaseKeyVerifier = (encryptionKey: Buffer): Buffer =>
  createHmac("sha256", encryptionKey)
    .update("x-oidc-node-sqlite-database-key-verifier-v1", "utf8")
    .digest();

class SharedState {
  readonly db: Database.Database;
  readonly codec: EncryptedRecordCodec;
  readonly lookupKeys: LookupKeyCodec;
  readonly lockLeaseMs: number;
  readonly lockPollIntervalMs: number;
  readonly inFlightLocks = new Set<Promise<unknown>>();
  readonly #lockContext = new AsyncLocalStorage<symbol>();
  readonly #activeLockExecutions = new Set<symbol>();
  #closing = false;
  closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(options: ValidatedOptions) {
    let database: Database.Database | undefined;
    let codec: EncryptedRecordCodec | undefined;
    let lookupKeys: LookupKeyCodec | undefined;
    try {
      codec = new EncryptedRecordCodec(options.keyId, options.encryptionKey);
      lookupKeys = new LookupKeyCodec(options.encryptionKey);
      if (options.dbPath !== ":memory:" && existsSync(options.dbPath)) {
        const metadata = lstatSync(options.dbPath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw sqliteStoreError("INVALID_CONFIGURATION");
        }
      }
      database = new Database(options.dbPath);
      database.pragma(`busy_timeout = ${options.busyTimeoutMs}`);
      database.pragma("foreign_keys = ON");
      if (options.dbPath !== ":memory:") {
        chmodSync(options.dbPath, 0o600);
        database.pragma("journal_mode = WAL");
        database.pragma("synchronous = FULL");
      }
      database.exec(`
        CREATE TABLE IF NOT EXISTS node_oidc_metadata (
          singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
          format_version INTEGER NOT NULL,
          key_id TEXT NOT NULL,
          key_verifier BLOB NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS node_oidc_transactions (
          owner_namespace TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          key_id TEXT NOT NULL,
          iv BLOB NOT NULL,
          ciphertext BLOB NOT NULL,
          auth_tag BLOB NOT NULL,
          PRIMARY KEY (owner_namespace, transaction_id)
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS node_oidc_transactions_expires
          ON node_oidc_transactions (expires_at);

        CREATE TABLE IF NOT EXISTS node_oidc_sessions (
          owner_namespace TEXT NOT NULL,
          session_id TEXT NOT NULL,
          refresh_version INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          key_id TEXT NOT NULL,
          iv BLOB NOT NULL,
          ciphertext BLOB NOT NULL,
          auth_tag BLOB NOT NULL,
          PRIMARY KEY (owner_namespace, session_id)
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS node_oidc_sessions_expires
          ON node_oidc_sessions (expires_at);

        CREATE TABLE IF NOT EXISTS node_oidc_refresh_locks (
          owner_namespace TEXT NOT NULL,
          session_id TEXT NOT NULL,
          lease_token TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (owner_namespace, session_id)
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS node_oidc_refresh_locks_expires
          ON node_oidc_refresh_locks (expires_at);
      `);
      const keyVerifier = createDatabaseKeyVerifier(options.encryptionKey);
      try {
        let existingMetadata = database
          .prepare(
            `SELECT format_version, key_id, key_verifier
             FROM node_oidc_metadata
             WHERE singleton = 1`,
          )
          .get() as { format_version: number; key_id: string; key_verifier: Buffer } | undefined;
        if (!existingMetadata) {
          const legacyData = database
            .prepare(
              `SELECT
                 EXISTS(SELECT 1 FROM node_oidc_transactions LIMIT 1) OR
                 EXISTS(SELECT 1 FROM node_oidc_sessions LIMIT 1) OR
                 EXISTS(SELECT 1 FROM node_oidc_refresh_locks LIMIT 1) AS present`,
            )
            .get() as { present: number };
          if (legacyData.present === 1) throw sqliteStoreError("CORRUPTED_DATA");
          database
            .prepare(
              `INSERT OR IGNORE INTO node_oidc_metadata
               (singleton, format_version, key_id, key_verifier)
               VALUES (1, ?, ?, ?)`,
            )
            .run(STORAGE_FORMAT_VERSION, options.keyId, keyVerifier);
          existingMetadata = database
            .prepare(
              `SELECT format_version, key_id, key_verifier
               FROM node_oidc_metadata
               WHERE singleton = 1`,
            )
            .get() as { format_version: number; key_id: string; key_verifier: Buffer } | undefined;
        }
        if (
          !existingMetadata ||
          existingMetadata.format_version !== STORAGE_FORMAT_VERSION ||
          existingMetadata.key_id !== options.keyId ||
          !(existingMetadata.key_verifier instanceof Uint8Array) ||
          existingMetadata.key_verifier.byteLength !== keyVerifier.byteLength ||
          !timingSafeEqual(Buffer.from(existingMetadata.key_verifier), keyVerifier)
        ) {
          throw sqliteStoreError("CORRUPTED_DATA");
        }
      } finally {
        keyVerifier.fill(0);
      }
      this.db = database;
      this.codec = codec;
      this.lookupKeys = lookupKeys;
    } catch (error) {
      try {
        database?.close();
      } catch {
        // 初始化失败时只做 best-effort 清理，公开错误保持固定且不带路径。
      }
      lookupKeys?.close();
      if (codec) codec.close();
      else options.encryptionKey.fill(0);
      if (error instanceof SqliteOidcStoreError) throw error;
      throw sqliteStoreError("STORAGE_FAILED");
    }
    this.lockLeaseMs = options.lockLeaseMs;
    this.lockPollIntervalMs = options.lockPollIntervalMs;
  }

  assertOpen(): void {
    if (this.closed || (this.#closing && !this.#isActiveLockContext())) {
      throw sqliteStoreError("CLOSED");
    }
  }

  beginLockExecution(): symbol {
    if (this.#closing || this.closed) throw sqliteStoreError("CLOSED");
    const token = Symbol("sqlite-refresh-lock-execution");
    this.#activeLockExecutions.add(token);
    return token;
  }

  assertLockExecution(token: symbol): void {
    if (this.closed || !this.#activeLockExecutions.has(token)) {
      throw sqliteStoreError("CLOSED");
    }
  }

  runInLockContext<T>(token: symbol, operation: () => Promise<T>): Promise<T> {
    this.assertLockExecution(token);
    return this.#lockContext.run(token, operation);
  }

  finishLockExecution(token: symbol, running: Promise<unknown>): void {
    this.#activeLockExecutions.delete(token);
    this.inFlightLocks.delete(running);
  }

  close(): Promise<void> {
    if (this.#isActiveLockContext()) {
      return Promise.reject(sqliteStoreError("STORAGE_FAILED"));
    }
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    this.#closing = true;
    await Promise.allSettled([...this.inFlightLocks]);
    this.closed = true;
    try {
      this.db.close();
    } catch {
      this.#closeKeyMaterial();
      throw sqliteStoreError("STORAGE_FAILED");
    }
    this.#closeKeyMaterial();
  }

  #closeKeyMaterial(): void {
    this.lookupKeys.close();
    this.codec.close();
  }

  #isActiveLockContext(): boolean {
    const token = this.#lockContext.getStore();
    return token !== undefined && this.#activeLockExecutions.has(token);
  }
}

class SqliteLoginTransactionStore implements LoginTransactionStore {
  readonly #state: SharedState;

  constructor(state: SharedState) {
    this.#state = state;
  }

  async create(input: LoginTransaction): Promise<boolean> {
    this.#state.assertOpen();
    try {
      const transaction = parseLoginTransaction(input);
      if (transaction.expiresAt <= Date.now()) return false;
      const lookupKey = this.#state.lookupKeys.create(
        "transaction",
        transaction.ownerNamespace,
        transaction.transactionId,
      );
      const encrypted = this.#state.codec.encrypt(
        "transaction",
        transaction.ownerNamespace,
        lookupKey,
        0,
        transaction,
      );
      const run = this.#state.db.transaction(() => {
        this.#state.db
          .prepare("DELETE FROM node_oidc_transactions WHERE expires_at <= ?")
          .run(Date.now());
        return this.#state.db
          .prepare(
            `INSERT OR IGNORE INTO node_oidc_transactions
             (owner_namespace, transaction_id, expires_at, key_id, iv, ciphertext, auth_tag)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            transaction.ownerNamespace,
            lookupKey,
            transaction.expiresAt,
            encrypted.key_id,
            encrypted.iv,
            encrypted.ciphertext,
            encrypted.auth_tag,
          ).changes;
      });
      return run() === 1;
    } catch (error) {
      return wrapStorageError(error);
    }
  }

  async consume(ownerNamespace: string, transactionId: string): Promise<LoginTransaction | null> {
    this.#state.assertOpen();
    validateLookupKey(ownerNamespace, transactionId);
    try {
      const lookupKey = this.#state.lookupKeys.create("transaction", ownerNamespace, transactionId);
      const row = this.#state.db
        .prepare(
          `DELETE FROM node_oidc_transactions
           WHERE owner_namespace = ? AND transaction_id = ?
           RETURNING owner_namespace, transaction_id AS opaque_id,
                     0 AS record_version, expires_at, key_id, iv, ciphertext, auth_tag`,
        )
        .get(ownerNamespace, lookupKey) as EncryptedRow | undefined;
      if (!row || row.expires_at <= Date.now()) return null;
      const transaction = parseLoginTransaction(this.#state.codec.decrypt("transaction", row));
      if (
        transaction.ownerNamespace !== ownerNamespace ||
        transaction.transactionId !== transactionId ||
        transaction.expiresAt !== row.expires_at
      ) {
        throw sqliteStoreError("CORRUPTED_DATA");
      }
      return transaction;
    } catch (error) {
      return wrapStorageError(error);
    }
  }
}

class SqliteAuthSessionStore implements AuthSessionStore {
  readonly #state: SharedState;

  constructor(state: SharedState) {
    this.#state = state;
  }

  async create(input: SensitiveAuthSessionRecord): Promise<boolean> {
    this.#state.assertOpen();
    try {
      const session = parseAuthSession(input);
      if (session.expiresAt <= Date.now()) return false;
      const lookupKey = this.#lookupKey(session.ownerNamespace, session.sessionId);
      const encrypted = this.#encrypt(session, lookupKey);
      const run = this.#state.db.transaction(() => {
        this.#state.db
          .prepare("DELETE FROM node_oidc_sessions WHERE expires_at <= ?")
          .run(Date.now());
        return this.#state.db
          .prepare(
            `INSERT OR IGNORE INTO node_oidc_sessions
             (owner_namespace, session_id, refresh_version, expires_at,
              key_id, iv, ciphertext, auth_tag)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            session.ownerNamespace,
            lookupKey,
            session.refreshVersion,
            session.expiresAt,
            encrypted.key_id,
            encrypted.iv,
            encrypted.ciphertext,
            encrypted.auth_tag,
          ).changes;
      });
      return run() === 1;
    } catch (error) {
      return wrapStorageError(error);
    }
  }

  async get(ownerNamespace: string, sessionId: string): Promise<SensitiveAuthSessionRecord | null> {
    this.#state.assertOpen();
    validateLookupKey(ownerNamespace, sessionId);
    try {
      const lookupKey = this.#lookupKey(ownerNamespace, sessionId);
      const row = this.#state.db
        .prepare(
          `SELECT owner_namespace, session_id AS opaque_id,
                  refresh_version AS record_version, expires_at,
                  key_id, iv, ciphertext, auth_tag
           FROM node_oidc_sessions
           WHERE owner_namespace = ? AND session_id = ?`,
        )
        .get(ownerNamespace, lookupKey) as EncryptedRow | undefined;
      if (!row) return null;
      if (row.expires_at <= Date.now()) {
        this.#state.db
          .prepare(
            `DELETE FROM node_oidc_sessions
             WHERE owner_namespace = ? AND session_id = ? AND expires_at <= ?`,
          )
          .run(ownerNamespace, lookupKey, Date.now());
        return null;
      }
      return this.#parseRow(row, ownerNamespace, sessionId);
    } catch (error) {
      return wrapStorageError(error);
    }
  }

  async compareAndSwap(
    ownerNamespace: string,
    sessionId: string,
    expectedRefreshVersion: number,
    input: SensitiveAuthSessionRecord,
  ): Promise<boolean> {
    this.#state.assertOpen();
    validateLookupKey(ownerNamespace, sessionId);
    try {
      const session = parseAuthSession(input);
      if (
        !Number.isSafeInteger(expectedRefreshVersion) ||
        expectedRefreshVersion < 0 ||
        session.ownerNamespace !== ownerNamespace ||
        session.sessionId !== sessionId ||
        session.refreshVersion !== expectedRefreshVersion + 1 ||
        session.expiresAt <= Date.now()
      ) {
        throw sqliteStoreError("STORAGE_FAILED");
      }
      const lookupKey = this.#lookupKey(ownerNamespace, sessionId);
      const encrypted = this.#encrypt(session, lookupKey);
      return (
        this.#state.db
          .prepare(
            `UPDATE node_oidc_sessions
             SET refresh_version = ?, expires_at = ?, key_id = ?,
                 iv = ?, ciphertext = ?, auth_tag = ?
             WHERE owner_namespace = ? AND session_id = ?
               AND refresh_version = ? AND expires_at > ?`,
          )
          .run(
            session.refreshVersion,
            session.expiresAt,
            encrypted.key_id,
            encrypted.iv,
            encrypted.ciphertext,
            encrypted.auth_tag,
            ownerNamespace,
            lookupKey,
            expectedRefreshVersion,
            Date.now(),
          ).changes === 1
      );
    } catch (error) {
      return wrapStorageError(error);
    }
  }

  async deleteIfVersion(
    ownerNamespace: string,
    sessionId: string,
    expectedRefreshVersion: number,
  ): Promise<boolean> {
    this.#state.assertOpen();
    validateLookupKey(ownerNamespace, sessionId);
    if (!Number.isSafeInteger(expectedRefreshVersion) || expectedRefreshVersion < 0) {
      throw sqliteStoreError("STORAGE_FAILED");
    }
    try {
      const lookupKey = this.#lookupKey(ownerNamespace, sessionId);
      return (
        this.#state.db
          .prepare(
            `DELETE FROM node_oidc_sessions
             WHERE owner_namespace = ? AND session_id = ? AND refresh_version = ?`,
          )
          .run(ownerNamespace, lookupKey, expectedRefreshVersion).changes === 1
      );
    } catch (error) {
      return wrapStorageError(error);
    }
  }

  async delete(ownerNamespace: string, sessionId: string): Promise<void> {
    this.#state.assertOpen();
    validateLookupKey(ownerNamespace, sessionId);
    try {
      const lookupKey = this.#lookupKey(ownerNamespace, sessionId);
      this.#state.db
        .prepare("DELETE FROM node_oidc_sessions WHERE owner_namespace = ? AND session_id = ?")
        .run(ownerNamespace, lookupKey);
    } catch (error) {
      return wrapStorageError(error);
    }
  }

  #lookupKey(ownerNamespace: string, sessionId: string): string {
    return this.#state.lookupKeys.create("session", ownerNamespace, sessionId);
  }

  #encrypt(session: SensitiveAuthSessionRecord, lookupKey: string) {
    return this.#state.codec.encrypt(
      "session",
      session.ownerNamespace,
      lookupKey,
      session.refreshVersion,
      session,
    );
  }

  #parseRow(
    row: EncryptedRow,
    ownerNamespace: string,
    sessionId: string,
  ): SensitiveAuthSessionRecord {
    const session = parseAuthSession(this.#state.codec.decrypt("session", row));
    if (
      session.ownerNamespace !== ownerNamespace ||
      session.sessionId !== sessionId ||
      session.refreshVersion !== row.record_version ||
      session.expiresAt !== row.expires_at
    ) {
      throw sqliteStoreError("CORRUPTED_DATA");
    }
    return session;
  }
}

class SqliteRefreshLock implements RefreshLock {
  readonly #state: SharedState;

  constructor(state: SharedState) {
    this.#state = state;
  }

  runExclusive<T>(
    ownerNamespace: string,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.#state.assertOpen();
    validateLookupKey(ownerNamespace, sessionId);
    if (typeof operation !== "function") throw sqliteStoreError("STORAGE_FAILED");
    const lookupKey = this.#state.lookupKeys.create("refresh-lock", ownerNamespace, sessionId);
    const executionToken = this.#state.beginLockExecution();
    const running = this.#run(ownerNamespace, lookupKey, executionToken, operation);
    this.#state.inFlightLocks.add(running);
    void running
      .finally(() => this.#state.finishLockExecution(executionToken, running))
      .catch(() => {});
    return running;
  }

  async #run<T>(
    ownerNamespace: string,
    lookupKey: string,
    executionToken: symbol,
    operation: () => Promise<T>,
  ): Promise<T> {
    const leaseToken = randomBytes(32).toString("base64url");
    await this.#acquire(ownerNamespace, lookupKey, leaseToken, executionToken);
    let lockLost = false;
    const heartbeat = setInterval(
      () => {
        try {
          const result = this.#state.db
            .prepare(
              `UPDATE node_oidc_refresh_locks
             SET expires_at = ?
             WHERE owner_namespace = ? AND session_id = ? AND lease_token = ?`,
            )
            .run(Date.now() + this.#state.lockLeaseMs, ownerNamespace, lookupKey, leaseToken);
          if (result.changes !== 1) lockLost = true;
        } catch {
          lockLost = true;
        }
      },
      Math.max(10, Math.floor(this.#state.lockLeaseMs / 3)),
    );
    heartbeat.unref();

    let value: T | undefined;
    let operationError: unknown;
    try {
      value = await this.#state.runInLockContext(executionToken, operation);
    } catch (error) {
      operationError = error;
    } finally {
      clearInterval(heartbeat);
    }

    let releaseFailed = false;
    try {
      const released = this.#state.db
        .prepare(
          `DELETE FROM node_oidc_refresh_locks
           WHERE owner_namespace = ? AND session_id = ? AND lease_token = ?`,
        )
        .run(ownerNamespace, lookupKey, leaseToken);
      if (released.changes !== 1) lockLost = true;
    } catch {
      releaseFailed = true;
    }
    if (operationError !== undefined) throw operationError;
    if (lockLost) throw sqliteStoreError("LOCK_LOST");
    if (releaseFailed) throw sqliteStoreError("STORAGE_FAILED");
    return value as T;
  }

  async #acquire(
    ownerNamespace: string,
    lookupKey: string,
    leaseToken: string,
    executionToken: symbol,
  ): Promise<void> {
    while (true) {
      this.#state.assertLockExecution(executionToken);
      try {
        const now = Date.now();
        const result = this.#state.db
          .prepare(
            `INSERT INTO node_oidc_refresh_locks
             (owner_namespace, session_id, lease_token, expires_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (owner_namespace, session_id) DO UPDATE SET
               lease_token = excluded.lease_token,
               expires_at = excluded.expires_at
             WHERE node_oidc_refresh_locks.expires_at <= ?`,
          )
          .run(ownerNamespace, lookupKey, leaseToken, now + this.#state.lockLeaseMs, now);
        if (result.changes === 1) return;
      } catch (error) {
        return wrapStorageError(error);
      }
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, this.#state.lockPollIntervalMs);
      });
    }
  }
}

export const createSqliteOidcStores = (input: SqliteOidcStoresOptions): SqliteOidcStores => {
  const state = new SharedState(validateOptions(input));
  return Object.freeze({
    transactionStore: new SqliteLoginTransactionStore(state),
    sessionStore: new SqliteAuthSessionStore(state),
    refreshLock: new SqliteRefreshLock(state),
    close: () => state.close(),
  });
};
