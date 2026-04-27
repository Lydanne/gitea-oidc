/**
 * Express 接入中间件
 */

/**
 * Express 中间件配置
 */
export interface GiteaOidcExpressOptions {
  /** userinfo 端点 URL */
  userInfoEndpoint: string;
}

/**
 * 创建 Express bearer token 中间件
 * @param options 中间件配置
 */
export function createGiteaOidcExpressMiddleware(options: GiteaOidcExpressOptions) {
  return async (req: any, res: any, next: any) => {
    const authorization = req.headers?.authorization;
    if (!authorization) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }

    try {
      const response = await fetch(options.userInfoEndpoint, {
        headers: { Authorization: authorization },
      });

      if (!response.ok) {
        res.status(401).json({ error: "Invalid access token" });
        return;
      }

      req.user = await response.json();
      next();
    } catch (err) {
      next(err);
    }
  };
}
