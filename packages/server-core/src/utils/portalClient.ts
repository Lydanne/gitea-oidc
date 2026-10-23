import type { ResolvedXOidcConfig } from "../config.js";

/** 规范化门户部署路径。 */
export function normalizePortalBasePath(basePath: string): string {
  return basePath.replace(/\/+$/, "") || "/portal";
}

/** 计算门户内部 OIDC Client 的精确回调地址。 */
export function getPortalRedirectUri(
  config: ResolvedXOidcConfig,
  basePath: string = config.portal.basePath,
): string {
  return `${config.server.url.replace(/\/+$/, "")}${normalizePortalBasePath(basePath)}/callback`;
}

/** 计算门户退出完成后的固定回跳地址。 */
export function getPortalPostLogoutRedirectUri(
  config: ResolvedXOidcConfig,
  basePath: string = config.portal.basePath,
): string {
  return `${config.server.url.replace(/\/+$/, "")}${normalizePortalBasePath(basePath)}/signed-out`;
}

/** 查找同时匹配 Client ID、回调和授权方式的门户 Client。 */
export function findPortalClient(
  config: ResolvedXOidcConfig,
): ResolvedXOidcConfig["clients"][number] | undefined {
  if (!config.portal.clientId) return undefined;
  const redirectUri = getPortalRedirectUri(config);
  const postLogoutRedirectUri = getPortalPostLogoutRedirectUri(config);
  return config.clients.find(
    (candidate) =>
      candidate.client_id === config.portal.clientId &&
      candidate.redirect_uris.includes(redirectUri) &&
      candidate.post_logout_redirect_uris?.includes(postLogoutRedirectUri) &&
      candidate.response_types.includes("code") &&
      candidate.grant_types.includes("authorization_code") &&
      candidate.token_endpoint_auth_method === "client_secret_basic",
  );
}

/** 返回门户 Client；配置不完整时在启动阶段显式失败。 */
export function resolvePortalClient(
  config: ResolvedXOidcConfig,
): ResolvedXOidcConfig["clients"][number] {
  const client = findPortalClient(config);
  if (!client) {
    throw new Error(formatPortalClientRequirement(config, getPortalRedirectUri(config)));
  }
  return client;
}

/** 生成人类可读的门户 Client 配置要求。 */
export function formatPortalClientRequirement(
  config: ResolvedXOidcConfig,
  redirectUri: string,
): string {
  const postLogoutRedirectUri = getPortalPostLogoutRedirectUri(config);
  return `portal.clientId 必须指向 clients[] 中的 confidential Client "${config.portal.clientId}"，其 redirect_uris 必须包含 ${redirectUri}、post_logout_redirect_uris 必须包含 ${postLogoutRedirectUri}，并支持 response_types=code、grant_types=authorization_code`;
}
