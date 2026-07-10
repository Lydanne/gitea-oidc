import type { SensitiveAuthSessionRecord } from "../domain/types.js";

export interface AuthSessionStore {
  /** 按记录中的 owner namespace 原子地创建会话；同一 owner 下 sessionId 重复时返回 false。 */
  create(session: SensitiveAuthSessionRecord): Promise<boolean>;
  get(ownerNamespace: string, sessionId: string): Promise<SensitiveAuthSessionRecord | null>;
  /**
   * 仅当会话仍存在且 refreshVersion 等于 expectedRefreshVersion 时原子替换，
   * 防止锁租约过期或退出竞态导致旧 Token 覆盖新 Token、已退出会话复活。
   */
  compareAndSwap(
    ownerNamespace: string,
    sessionId: string,
    expectedRefreshVersion: number,
    next: SensitiveAuthSessionRecord,
  ): Promise<boolean>;
  /** 仅在 refreshVersion 仍匹配时删除，供 invalid_grant 与 logout 竞态安全收敛。 */
  deleteIfVersion(
    ownerNamespace: string,
    sessionId: string,
    expectedRefreshVersion: number,
  ): Promise<boolean>;
  delete(ownerNamespace: string, sessionId: string): Promise<void>;
  close?(): Promise<void> | void;
}
