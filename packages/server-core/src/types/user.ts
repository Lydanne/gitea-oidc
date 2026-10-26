/**
 * 规范化用户字段类型
 */

/**
 * 用户账号状态
 */
export type UserStatus = "active" | "disabled" | "locked" | "pending";

/**
 * 用户所属分组。
 *
 * `id` 用于稳定匹配权限，`name` 用于展示；`children` 表达部门或分组层级。
 */
export interface UserGroup {
  /** 分组稳定标识 */
  id: string;

  /** 分组显示名称 */
  name: string;

  /** 子分组 */
  children?: UserGroup[];
}

/**
 * 由内部用户模型投影出的 OIDC Claims。
 *
 * `groups` 使用名称路径和 ID 路径字符串兼容 Gitea，`groups_tree` 提供完整树形分组。
 */
export interface UserClaims extends Record<string, unknown> {
  sub: string;
  preferred_username: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture?: string;
  phone?: string;
  phone_verified: boolean;
  groups: string[];
  groups_tree: UserGroup[];
  roles: string[];
  status: UserStatus;
  updated_at?: number;
}

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
