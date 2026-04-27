/**
 * 内置后台管理类型
 */

import type { UserInfo } from "./auth";
import type { ProviderTokenRecord } from "./providerApi";

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
  user: UserInfo;

  /** 是否为管理员 */
  admin: boolean;
}

/**
 * 后台 token 状态摘要
 */
export interface AdminTokenSummary {
  /** token 记录 */
  token: ProviderTokenRecord;

  /** 是否即将过期 */
  expiringSoon: boolean;
}
