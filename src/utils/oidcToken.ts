/**
 * OIDC bearer token 解析工具
 */

import type { Provider } from "oidc-provider";
import type { UserInfo, UserRepository } from "../types/auth";

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
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const accessToken = await (oidcProvider as any).AccessToken.find(match[1]);
  if (!accessToken?.accountId) {
    return null;
  }

  if (accessToken.exp && accessToken.exp * 1000 <= Date.now()) {
    return null;
  }

  const user = await userRepository.findById(accessToken.accountId);
  if (!user || (user.status && user.status !== "active")) {
    return null;
  }

  return user;
}
