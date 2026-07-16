/**
 * 内置用户门户配置与公开响应类型。
 */

import type { UserGroup, UserStatus } from "./user.js";

/** 内置用户门户配置。 */
export interface PortalConfig {
  /** 是否启用内置用户门户。 */
  enabled: boolean;

  /** 门户挂载路径。 */
  basePath: string;

  /** 门户自身用于 OIDC 登录的 confidential Client ID。 */
  clientId: string;

  /** 门户 BFF 会话有效期（秒）。 */
  sessionTtlSeconds: number;
}

/** 静态 Client 对应的门户展示配置。 */
export interface PortalClientConfig {
  /** 是否在门户展示；省略时默认为 true。 */
  enabled?: boolean;

  /** 覆盖 system Application 的展示名称。 */
  name?: string;

  /** 覆盖 system Application 的说明。 */
  description?: string;

  /** 用户点击卡片后进入的应用地址。 */
  launch_url: string;

  /** 可选应用图标地址。 */
  icon_url?: string;

  /** 排序值，越小越靠前。 */
  order?: number;
}

/** 门户会话记录。 */
export interface PortalSession {
  id: string;
  userId: string;
  expiresAt: number;
}

/** 门户公开用户摘要。 */
export interface PortalUserSummary {
  sub: string;
  username?: string;
  name?: string;
  email?: string;
  picture?: string;
  groups?: UserGroup[];
  roles?: string[];
  status?: UserStatus;
}

/** 门户当前用户响应。 */
export interface PortalMeResponse {
  user: PortalUserSummary;
  admin: boolean;
  basePath: string;
  adminBasePath: string;
}
