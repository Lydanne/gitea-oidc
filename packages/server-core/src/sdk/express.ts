import { createBearerTokenVerifier, type XOidcBearerOptions } from "./bearer.js";

export type XOidcExpressOptions = XOidcBearerOptions;
export type { XOidcBearerClaims } from "./bearer.js";

/**
 * 创建 Express bearer token 中间件
 * @param options 中间件配置
 */
export function createXOidcExpressMiddleware(options: XOidcExpressOptions) {
  const verify = createBearerTokenVerifier(options);
  return async (req: any, res: any, next: any) => {
    const user = await verify(req.headers?.authorization);
    if (!user) {
      res.status(401).json({ error: "Invalid access token" });
      return;
    }
    req.user = user;
    next();
  };
}
