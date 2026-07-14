import {
  ApplicationTemplatePreviewV1Schema,
  ApplicationTemplateSummaryV1Schema,
  parseApplicationConnectionV1,
  parseApplicationDetailsListV1,
  parseApplicationDetailsV1,
  parseCreateCustomApplicationOutcomeResponseV1,
  parseCreateTemplateApplicationOutcomeResponseV1,
  parseIntegrationGuideV1,
  parseRotateApplicationCredentialResponseV1,
} from "@gitea-oidc/contracts";
import { adminRuntimeConfig, toAdminPath } from "../runtimeConfig";
import type {
  AdminSession,
  AdminUser,
  AdminUserPayload,
  AuditLogFilters,
  AuditLogPage,
  CreateCustomApplicationRequestV1,
  CreateTemplateApplicationRequestV1,
  PreviewApplicationTemplateRequestV1,
  ProviderState,
  ProviderToken,
  RotateApplicationCredentialRequestV1,
  UserStatus,
} from "../types/admin";

/** 管理台 API 基础路径。 */
const adminApiBase = `${adminRuntimeConfig.basePath}/api`;
const adminActionHeader = "X-Gitea-OIDC-Admin-Action";

/** 统一处理后台 API 请求、登录跳转和错误文本。 */
export const adminApiRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T | null> => {
  const method = (options.method ?? "GET").toUpperCase();
  const response = await fetch(`${adminApiBase}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(method === "GET" ? {} : { [adminActionHeader]: "1" }),
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401) {
    const returnTo = `${location.pathname}${location.search}`;
    location.href = `${toAdminPath("/login")}?returnTo=${encodeURIComponent(returnTo)}`;
    return null;
  }

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as T;
};

/** 获取当前后台会话用户。 */
export const fetchAdminSession = () => adminApiRequest<AdminSession>("/me");

/** 获取后台用户列表。 */
export const fetchAdminUsers = () => adminApiRequest<AdminUser[]>("/users");

/** 按用户、事件、结果和时间范围查询审计日志。 */
export const fetchAuditLogs = (filters: AuditLogFilters = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return adminApiRequest<AuditLogPage>(`/audit-logs${suffix}`);
};

/** 获取 Provider 与 Provider API 状态。 */
export const fetchProviderState = () => adminApiRequest<ProviderState>("/providers");

/** 获取 Provider token 状态列表。 */
export const fetchProviderTokens = () => adminApiRequest<ProviderToken[]>("/tokens");

/** 获取应用与 OIDC Client 列表。 */
export const fetchAdminApplications = async () => {
  const response = await adminApiRequest<unknown>("/applications");
  return response === null ? null : parseApplicationDetailsListV1(response);
};

/** 获取服务端已注册的精确版本应用模板。 */
export const fetchAdminApplicationTemplates = async () => {
  const response = await adminApiRequest<unknown>("/application-templates");
  return response === null ? null : ApplicationTemplateSummaryV1Schema.array().parse(response);
};

/** 无副作用预览模板派生的回调、Scope、PKCE 和接入说明。 */
export const previewAdminApplicationTemplate = async (
  payload: PreviewApplicationTemplateRequestV1,
) => {
  const response = await adminApiRequest<unknown>("/application-templates/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response === null ? null : ApplicationTemplatePreviewV1Schema.parse(response);
};

/** 获取可重复下载且不含 Secret 的公开连接配置。 */
export const fetchAdminApplicationConnection = async (applicationId: string) => {
  const response = await adminApiRequest<unknown>(
    `/applications/${encodeURIComponent(applicationId)}/connection`,
  );
  return response === null ? null : parseApplicationConnectionV1(response);
};

/** 获取可重复读取且不含 Secret 的结构化接入说明。 */
export const fetchAdminApplicationIntegrationGuide = async (applicationId: string) => {
  const response = await adminApiRequest<unknown>(
    `/applications/${encodeURIComponent(applicationId)}/integration-guide`,
  );
  return response === null ? null : parseIntegrationGuideV1(response);
};

/** 创建自定义应用；调用方负责为同一次逻辑提交复用幂等键。 */
export const createAdminApplication = async (
  payload: CreateCustomApplicationRequestV1,
  idempotencyKey: string,
) => {
  const response = await adminApiRequest<unknown>("/applications", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  return response === null ? null : parseCreateCustomApplicationOutcomeResponseV1(response);
};

/** 从精确模板版本创建应用；调用方负责复用同一次逻辑提交的幂等键。 */
export const createAdminTemplateApplication = async (
  payload: CreateTemplateApplicationRequestV1,
  idempotencyKey: string,
) => {
  const response = await adminApiRequest<unknown>("/applications/from-template", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  return response === null ? null : parseCreateTemplateApplicationOutcomeResponseV1(response);
};

/** 启用应用。 */
export const enableAdminApplication = async (applicationId: string, expectedVersion: number) => {
  const response = await adminApiRequest<unknown>(
    `/applications/${encodeURIComponent(applicationId)}/enable`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    },
  );
  return response === null ? null : parseApplicationDetailsV1(response);
};

/** 禁用应用。 */
export const disableAdminApplication = async (applicationId: string, expectedVersion: number) => {
  const response = await adminApiRequest<unknown>(
    `/applications/${encodeURIComponent(applicationId)}/disable`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    },
  );
  return response === null ? null : parseApplicationDetailsV1(response);
};

/** 原子替换 confidential Client Secret；新凭据只在本次响应中返回。 */
export const rotateAdminApplicationSecret = async (
  applicationId: string,
  payload: RotateApplicationCredentialRequestV1,
) => {
  const response = await adminApiRequest<unknown>(
    `/applications/${encodeURIComponent(applicationId)}/rotate-secret`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return response === null ? null : parseRotateApplicationCredentialResponseV1(response);
};

/** 创建后台用户。 */
export const createAdminUser = (payload: AdminUserPayload) =>
  adminApiRequest<AdminUser>("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });

/** 更新后台用户。 */
export const updateAdminUser = (sub: string, payload: Partial<AdminUserPayload>) =>
  adminApiRequest<AdminUser>(`/users/${encodeURIComponent(sub)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

/** 更新后台用户状态。 */
export const updateAdminUserStatus = (sub: string, status: UserStatus) =>
  adminApiRequest<AdminUser>(`/users/${encodeURIComponent(sub)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

/** 删除后台用户。 */
export const removeAdminUser = (sub: string) =>
  adminApiRequest<null>(`/users/${encodeURIComponent(sub)}`, { method: "DELETE" });

/** 手动探活指定 Provider token。 */
export const probeProviderToken = (token: ProviderToken) =>
  adminApiRequest("/tokens/probe", {
    method: "POST",
    body: JSON.stringify({
      provider: token.provider,
      ownerType: token.ownerType,
      ownerId: token.ownerId,
    }),
  });
