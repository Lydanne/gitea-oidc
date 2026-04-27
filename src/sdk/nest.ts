/**
 * Nest 接入工具
 */

import { createGiteaOidcExpressMiddleware, type GiteaOidcExpressOptions } from "./express";

/**
 * 创建 Nest Guard
 * @param options bearer token 校验配置
 */
export function createGiteaOidcNestGuard(options: GiteaOidcExpressOptions) {
  const middleware = createGiteaOidcExpressMiddleware(options);

  return class GiteaOidcNestGuard {
    /**
     * Nest Guard 入口
     * @param context ExecutionContext
     */
    async canActivate(context: any): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const response = context.switchToHttp().getResponse();

      await new Promise<void>((resolve, reject) => {
        middleware(request, response, (err?: unknown) => {
          if (err) reject(err);
          else resolve();
        });
      });

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
