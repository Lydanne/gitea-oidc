/**
 * OIDC bearer token 解析工具
 */

import type { Provider } from "oidc-provider";
import type { UserInfo, UserRepository } from "../types/auth.js";

export interface ResolvedBearerToken {
  user: UserInfo;
  clientId?: string;
  scope?: string;
}

interface OidcAccessTokenLike {
  accountId?: string;
  clientId?: string;
  grantId?: string;
  scope?: string;
  exp?: number;
  kind?: string;
  isValid?: boolean;
}

interface OidcGrantLike {
  accountId?: string;
  clientId?: string;
  isExpired?: boolean;
}

/**
 * 从 Authorization 头中解析当前用户
 * @param oidcProvider OIDC Provider 实例
 * @param userRepository 用户仓储
 * @param authorization Authorization 请求头
 */
export async function resolveBearerUser(
  oidcProvider: Provider,
  userRepository: UserRepository,
  authorization?: string,
): Promise<UserInfo | null> {
  return (await resolveBearerToken(oidcProvider, userRepository, authorization))?.user ?? null;
}

/**
 * 从 Authorization 头中解析当前用户和 access token 元数据。
 */
export async function resolveBearerToken(
  oidcProvider: Provider,
  userRepository: UserRepository,
  authorization?: string,
): Promise<ResolvedBearerToken | null> {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const accessToken = await (oidcProvider as any).AccessToken.find(match[1]);
  if (!isUsableAccessToken(accessToken)) {
    return null;
  }

  if (!(await isBoundToActiveGrant(oidcProvider, accessToken))) {
    return null;
  }

  const user = await userRepository.findById(accessToken.accountId);
  if (!user || (user.status && user.status !== "active")) {
    return null;
  }

  return {
    user,
    clientId: accessToken.clientId,
    scope: accessToken.scope,
  };
}

function isUsableAccessToken(
  accessToken: OidcAccessTokenLike | null | undefined,
): accessToken is OidcAccessTokenLike & { accountId: string } {
  if (!accessToken?.accountId) {
    return false;
  }

  if (accessToken.kind && accessToken.kind !== "AccessToken") {
    return false;
  }

  if (accessToken.isValid === false) {
    return false;
  }

  if (accessToken.exp && accessToken.exp * 1000 <= Date.now()) {
    return false;
  }

  return true;
}

async function isBoundToActiveGrant(
  oidcProvider: Provider,
  accessToken: OidcAccessTokenLike & { accountId: string },
): Promise<boolean> {
  if (!accessToken.clientId || !accessToken.grantId) {
    return false;
  }

  const client = await (oidcProvider as any).Client?.find?.(accessToken.clientId);
  if (!client) {
    return false;
  }

  const grant = (await (oidcProvider as any).Grant?.find?.(accessToken.grantId, {
    ignoreExpiration: true,
  })) as OidcGrantLike | null | undefined;
  if (!grant || grant.isExpired) {
    return false;
  }

  return grant.clientId === accessToken.clientId && grant.accountId === accessToken.accountId;
}
