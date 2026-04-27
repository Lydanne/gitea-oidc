/**
 * Provider API 代理路由
 */

import type { FastifyInstance } from "fastify";
import type { Provider } from "oidc-provider";
import { ProviderApiService } from "../provider-api/ProviderApiService";
import type { UserRepository } from "../types/auth";
import type { ProviderApiRequest } from "../types/providerApi";
import { resolveBearerUser } from "../utils/oidcToken";

/**
 * Provider API 路由配置
 */
export interface ProviderApiRoutesOptions {
  /** Fastify 实例 */
  app: FastifyInstance;

  /** OIDC Provider 实例 */
  oidcProvider: Provider;

  /** 用户仓储 */
  userRepository: UserRepository;

  /** Provider API 服务 */
  providerApiService: ProviderApiService;

  /** 是否启用 SDK 代理 */
  sdkProxy: boolean;
}

/**
 * 注册 Provider API 代理路由
 * @param options 路由配置
 */
export function registerProviderApiRoutes(options: ProviderApiRoutesOptions): void {
  const { app, oidcProvider, userRepository, providerApiService, sdkProxy } = options;

  if (!sdkProxy) {
    return;
  }

  app.post("/api/provider/:provider/request", async (request, reply) => {
    const user = await resolveBearerUser(
      oidcProvider,
      userRepository,
      request.headers.authorization,
    );

    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { provider } = request.params as { provider: string };
    const providerRequest = request.body as ProviderApiRequest;

    try {
      const result = await providerApiService.request(provider, providerRequest, {
        userId: user.sub,
        groups: user.groups,
        roles: user.roles,
      });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(message.includes("permission") ? 403 : 400).send({ error: message });
    }
  });
}
