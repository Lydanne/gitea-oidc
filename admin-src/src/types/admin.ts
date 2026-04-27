/** 管理台主导航视图。 */
export type AdminView = "users" | "providers" | "tokens";

/** 规范化用户状态。 */
export type UserStatus = "active" | "disabled" | "locked" | "pending";

/** PrimeVue Tag 支持的语义色。 */
export type TagSeverity = "success" | "info" | "warn" | "danger" | "secondary" | "contrast";

/** 后台用户对象，对应 `/admin/api/users` 返回值。 */
export interface AdminUser {
  sub: string;
  username?: string;
  name?: string;
  email?: string;
  authProvider?: string;
  externalId?: string;
  groups?: string[];
  roles?: string[];
  status?: UserStatus;
  picture?: string;
  phone?: string;
  lastLoginAt?: string;
  lastSyncedAt?: string;
}

/** 后台用户创建或更新表单。 */
export interface UserForm {
  username: string;
  name: string;
  email: string;
  authProvider: string;
  externalId: string;
  groups: string;
  roles: string;
  status: UserStatus;
  picture: string;
  phone: string;
}

/** 后台用户创建或更新载荷。 */
export interface AdminUserPayload {
  username: string;
  name: string;
  email: string;
  authProvider: string;
  externalId: string;
  groups: string[];
  roles: string[];
  status: UserStatus;
  picture?: string;
  phone?: string;
}

/** 认证 Provider 健康状态。 */
export interface AuthProviderStatus {
  name: string;
  displayName?: string;
  features?: string[];
  status?: {
    healthy?: boolean;
    message?: string;
  };
}

/** Provider API 注册状态。 */
export interface ApiProviderStatus {
  provider: string;
  baseUrl?: string;
  enabled?: boolean;
}

/** Provider 状态接口返回值。 */
export interface ProviderState {
  authProviders: AuthProviderStatus[];
  apiProviders: ApiProviderStatus[];
}

/** Provider token 管理台列表项。 */
export interface ProviderToken {
  id?: string;
  provider: string;
  ownerType: "user" | "app";
  ownerId: string;
  status: string;
  expiresAt?: string;
  lastError?: string;
}

/** 当前后台会话。 */
export interface AdminSession {
  user?: AdminUser;
}

/** 用户状态下拉选项。 */
export const userStatusOptions: Array<{ label: string; value: UserStatus }> = [
  { label: "Active", value: "active" },
  { label: "Disabled", value: "disabled" },
  { label: "Locked", value: "locked" },
  { label: "Pending", value: "pending" },
];
