import type {
  AdminSession,
  AdminUser,
  AdminUserPayload,
  ProviderState,
  ProviderToken,
  UserStatus,
} from "../types/admin";

/** 管理台 API 基础路径。 */
const adminApiBase = "/admin/api";
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
    location.href = `/admin/login?returnTo=${encodeURIComponent(returnTo)}`;
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

/** 获取 Provider 与 Provider API 状态。 */
export const fetchProviderState = () => adminApiRequest<ProviderState>("/providers");

/** 获取 Provider token 状态列表。 */
export const fetchProviderTokens = () => adminApiRequest<ProviderToken[]>("/tokens");

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
