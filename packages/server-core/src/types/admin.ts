/**
 * 内置后台管理类型
 */

import type { ProviderTokenOwnerType, ProviderTokenStatus } from "./providerApi.js";
import type { UserGroup, UserStatus } from "./user.js";

/**
 * 后台管理配置
 */
export interface AdminConfig {
  /** 是否启用内置后台 */
  enabled: boolean;

  /** 后台挂载路径 */
  basePath: string;

  /** 允许访问后台的用户组 */
  allowedGroups: string[];

  /** BFF 会话有效期（秒） */
  sessionTtlSeconds: number;
}

/**
 * 后台会话记录
 */
export interface AdminSession {
  /** 会话 ID */
  id: string;

  /** 用户 ID */
  userId: string;

  /** 过期时间 */
  expiresAt: number;
}

/**
 * 后台当前用户响应
 */
export interface AdminMeResponse {
  /** 当前用户 */
  user: AdminUser;

  /** 是否为管理员 */
  admin: boolean;

  /** 当前管理台规范化后的部署路径。 */
  basePath: string;

  /** 当前部署实际启用的管理能力。 */
  capabilities: {
    applications: boolean;
  };
}

/**
 * 后台用户摘要。
 *
 * 不包含 `metadata`、`providerProfile.raw` 等 Provider 原始档案。
 */
export interface AdminUser {
  /** OIDC subject */
  sub: string;

  /** 用户名 */
  username?: string;

  /** 显示名 */
  name?: string;

  /** 邮箱 */
  email?: string;

  /** 邮箱是否已验证 */
  emailVerified?: boolean;

  /** 认证 Provider */
  authProvider?: string;

  /** Provider 外部用户 ID */
  externalId?: string;

  /** 用户组 */
  groups?: UserGroup[];

  /** 用户角色 */
  roles?: string[];

  /** 账号状态 */
  status?: UserStatus;

  /** 头像 URL */
  picture?: string;

  /** 手机号 */
  phone?: string;

  /** 手机号是否已验证 */
  phoneVerified?: boolean;

  /** 最近登录时间 */
  lastLoginAt?: Date;

  /** 最近同步时间 */
  lastSyncedAt?: Date;

  /** 创建时间 */
  createdAt?: Date;

  /** 更新时间 */
  updatedAt?: Date;
}

/**
 * 后台 token 状态摘要
 */
export interface AdminTokenSummary {
  /** 记录唯一 ID */
  id?: string;

  /** Provider 名称 */
  provider: string;

  /** token 所属主体类型 */
  ownerType: ProviderTokenOwnerType;

  /** token 所属主体 ID */
  ownerId: string;

  /** token 类型，例如 Bearer */
  tokenType?: string;

  /** 授权范围 */
  scope?: string;

  /** access token 过期时间 */
  expiresAt?: Date;

  /** refresh token 过期时间 */
  refreshExpiresAt?: Date;

  /** 当前健康状态 */
  status: ProviderTokenStatus;

  /** 上次探活时间 */
  lastProbedAt?: Date;

  /** 上次刷新时间 */
  lastRefreshAt?: Date;

  /** 最近一次错误摘要 */
  lastError?: string;

  /** 创建时间 */
  createdAt?: Date;

  /** 更新时间 */
  updatedAt?: Date;
}
