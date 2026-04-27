/**
 * Nest 接入工具
 */

import type { GiteaOidcExpressOptions } from "./express";

/**
 * 创建 Nest Guard
 * @param options bearer token 校验配置
 */
export function createGiteaOidcNestGuard(options: GiteaOidcExpressOptions) {
  return class GiteaOidcNestGuard {
    /**
     * Nest Guard 入口
     * @param context ExecutionContext
     */
    async canActivate(context: any): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const authorization = request.headers?.authorization;

      if (!authorization) {
        return false;
      }

      const response = await fetch(options.userInfoEndpoint, {
        headers: { Authorization: authorization },
      });

      if (!response.ok) {
        return false;
      }

      request.user = await response.json();
      return !!request.user;
    }
  };
}

/**
 * 从请求上读取当前用户
 * @param request HTTP 请求
 */
export function getGiteaOidcUser(request: any) {
  return request.user;
}
