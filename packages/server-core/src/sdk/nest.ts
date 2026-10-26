/**
 * Nest 接入工具
 */

import { createBearerTokenVerifier } from "./bearer.js";
import type { XOidcExpressOptions } from "./express.js";

/**
 * 创建 Nest Guard
 * @param options bearer token 校验配置
 */
export function createXOidcNestGuard(options: XOidcExpressOptions) {
  const verify = createBearerTokenVerifier(options);
  return class XOidcNestGuard {
    /**
     * Nest Guard 入口
     * @param context ExecutionContext
     */
    async canActivate(context: any): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const user = await verify(request.headers?.authorization);
      if (!user) return false;
      request.user = user;
      return true;
    }
  };
}

/**
 * 从请求上读取当前用户
 * @param request HTTP 请求
 */
export function getXOidcUser(request: any) {
  return request.user;
}
