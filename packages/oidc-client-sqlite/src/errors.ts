export type SqliteOidcStoreErrorCode =
  | "CLOSED"
  | "CORRUPTED_DATA"
  | "INVALID_CONFIGURATION"
  | "LOCK_LOST"
  | "STORAGE_FAILED";

const MESSAGES: Record<SqliteOidcStoreErrorCode, string> = {
  CLOSED: "SQLite OIDC stores 已关闭",
  CORRUPTED_DATA: "SQLite OIDC stores 检测到损坏或无法解密的数据",
  INVALID_CONFIGURATION: "SQLite OIDC stores 配置无效",
  LOCK_LOST: "SQLite refresh lock 租约已丢失",
  STORAGE_FAILED: "SQLite OIDC stores 操作失败",
};

/** 固定错误不会携带数据库路径、SQL、Token、Verifier 或底层异常。 */
export class SqliteOidcStoreError extends Error {
  readonly code: SqliteOidcStoreErrorCode;

  constructor(code: SqliteOidcStoreErrorCode) {
    super(MESSAGES[code]);
    this.name = "SqliteOidcStoreError";
    this.code = code;
  }
}

export const sqliteStoreError = (code: SqliteOidcStoreErrorCode): SqliteOidcStoreError =>
  new SqliteOidcStoreError(code);
