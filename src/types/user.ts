/**
 * 规范化用户字段类型
 */

/**
 * 用户账号状态
 */
export type UserStatus = "active" | "disabled" | "locked" | "pending";

/**
 * Provider 原始用户档案快照
 */
export interface ProviderProfile {
  /** Provider 名称 */
  provider: string;

  /** Provider 外部用户 ID */
  externalId: string;

  /** Provider 返回的原始用户数据 */
  raw?: Record<string, any>;

  /** 同步时间 */
  syncedAt?: Date;
}
