import type {
  ApplicationConnectionV1,
  ApplicationDetailsV1,
  ApplicationSecretSummaryV1,
  ApplicationStatusV1,
  ApplicationTemplatePreviewV1,
  ApplicationTemplateSummaryV1,
  ApplicationV1,
  CreateCustomApplicationOutcomeResponseV1,
  CreateCustomApplicationRequestV1,
  CreateTemplateApplicationOutcomeResponseV1,
  CreateTemplateApplicationRequestV1,
  IntegrationGuideV1,
  OidcClientV1,
  PreviewApplicationTemplateRequestV1,
  RotateApplicationCredentialRequestV1,
  RotateApplicationCredentialResponseV1,
} from "@gitea-oidc/contracts";

/** 管理台主导航视图。 */
export type AdminView = "users" | "applications" | "providers" | "tokens" | "audit-logs";

export type AuditEventType =
  | "user.login"
  | "user.logout"
  | "admin.login"
  | "admin.logout"
  | "user.created"
  | "user.updated"
  | "user.deleted";

export type AuditOutcome = "success" | "failure";

export interface AuditLogRecord {
  id: string;
  eventType: AuditEventType;
  outcome: AuditOutcome;
  source: "admin" | "provider" | "oidc" | "system";
  userId?: string;
  actorUserId?: string;
  username?: string;
  provider?: string;
  clientId?: string;
  ipAddress?: string;
  userAgent?: string;
  changedFields?: string[];
  statusFrom?: UserStatus;
  statusTo?: UserStatus;
  reason?: string;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogRecord[];
  total: number;
}

export interface AuditLogFilters {
  userId?: string;
  eventType?: AuditEventType;
  outcome?: AuditOutcome;
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
}

/** 规范化用户状态。 */
export type UserStatus = "active" | "disabled" | "locked" | "pending";

/** 用户分组树节点。 */
export interface UserGroup {
  id: string;
  name: string;
  children?: UserGroup[];
}

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
  groups?: UserGroup[];
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
  authProvider?: string;
  externalId?: string;
  groups: UserGroup[];
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
  admin: boolean;
  basePath: string;
  capabilities: {
    applications: boolean;
  };
}

/** 应用管理接口返回的严格共享 contract。 */
export type ApplicationDetails = ApplicationDetailsV1;
export type ApplicationSecretSummary = ApplicationSecretSummaryV1;

/** 自定义应用创建表单，仅包含当前管理台开放的配置。 */
export interface ApplicationForm {
  name: string;
  slug: string;
  environment: "development" | "staging" | "production";
  clientType: "confidential" | "public";
  redirectUris: string;
  postLogoutRedirectUris: string;
  scopes: string;
  refreshToken: boolean;
}

/** 由模板 form descriptor 驱动的通用创建表单。 */
export interface TemplateApplicationForm {
  name: string;
  slug: string;
  templateKey: string;
  templateInput: Record<string, string | boolean>;
}

export type CreateApplicationOutcomeResponse =
  | CreateCustomApplicationOutcomeResponseV1
  | CreateTemplateApplicationOutcomeResponseV1
  | RotateApplicationCredentialResponseV1;

export type {
  ApplicationConnectionV1,
  ApplicationDetailsV1,
  ApplicationSecretSummaryV1,
  ApplicationTemplatePreviewV1,
  ApplicationTemplateSummaryV1,
  ApplicationV1,
  ApplicationStatusV1,
  CreateCustomApplicationOutcomeResponseV1,
  CreateCustomApplicationRequestV1,
  CreateTemplateApplicationOutcomeResponseV1,
  CreateTemplateApplicationRequestV1,
  IntegrationGuideV1,
  OidcClientV1,
  PreviewApplicationTemplateRequestV1,
  RotateApplicationCredentialRequestV1,
  RotateApplicationCredentialResponseV1,
};

/** 用户状态下拉选项。 */
export const userStatusOptions: Array<{ label: string; value: UserStatus }> = [
  { label: "Active", value: "active" },
  { label: "Disabled", value: "disabled" },
  { label: "Locked", value: "locked" },
  { label: "Pending", value: "pending" },
];
