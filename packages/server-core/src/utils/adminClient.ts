import type { GiteaOidcConfig } from "../config.js";

export function normalizeAdminBasePath(basePath: string): string {
  return basePath.replace(/\/+$/, "") || "/admin";
}

export function getAdminRedirectUri(config: GiteaOidcConfig, basePath: string): string {
  return `${config.server.url.replace(/\/+$/, "")}${normalizeAdminBasePath(basePath)}/callback`;
}

export function findAdminClient(
  config: GiteaOidcConfig,
  basePath: string,
): GiteaOidcConfig["clients"][number] | undefined {
  const redirectUri = getAdminRedirectUri(config, basePath);
  return config.clients.find(
    (candidate) =>
      candidate.redirect_uris.includes(redirectUri) &&
      candidate.response_types.includes("code") &&
      candidate.grant_types.includes("authorization_code") &&
      candidate.token_endpoint_auth_method === "client_secret_basic",
  );
}

export function formatAdminClientRequirement(redirectUri: string): string {
  return `clients[].redirect_uris 必须包含 ${redirectUri}，且该客户端必须支持 response_types=code、grant_types=authorization_code、token_endpoint_auth_method=client_secret_basic`;
}
