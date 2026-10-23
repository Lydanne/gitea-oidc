import type { AdminUser, AuthProviderStatus, ProviderToken, TagSeverity } from "../types/admin";

/** 格式化后端 ISO 日期。 */
export const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : "-");

/** 获取用户展示名。 */
export const getUserDisplayName = (user?: AdminUser) => user?.name || user?.username || "-";

/** 根据用户状态选择 Tag 语义色。 */
export const getUserStatusSeverity = (status?: string): TagSeverity => {
  switch (status ?? "active") {
    case "active":
      return "success";
    case "pending":
      return "info";
    case "locked":
      return "warn";
    case "disabled":
      return "secondary";
    default:
      return "secondary";
  }
};

/** 根据 Provider 健康状态选择 Tag 语义色。 */
export const getProviderSeverity = (provider: AuthProviderStatus): TagSeverity =>
  provider.status?.healthy === false ? "danger" : "success";

/** 根据 token 状态选择 Tag 语义色。 */
export const getTokenSeverity = (token: ProviderToken): TagSeverity => {
  switch (token.status) {
    case "active":
    case "healthy":
      return "success";
    case "expired":
    case "refresh_failed":
    case "probe_failed":
      return "danger";
    case "refreshing":
      return "info";
    default:
      return "secondary";
  }
};
