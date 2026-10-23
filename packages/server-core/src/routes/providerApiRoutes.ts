/**
 * Provider API 代理路由
 */

import type { FastifyInstance } from "fastify";
import type { Provider } from "oidc-provider";
import { ProviderApiService } from "../provider-api/ProviderApiService.js";
import type { UserRepository } from "../types/auth.js";
import type { ProviderApiRequest } from "../types/providerApi.js";
import { resolveBearerToken } from "../utils/oidcToken.js";
import { summarizeTokenError } from "../utils/tokenCrypto.js";
import { userGroupPermissionValues } from "../utils/userGroups.js";

export const PROVIDER_API_REQUIRED_SCOPE = "provider_api";

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

  /** 允许调用 SDK 代理路由的 OIDC client_id */
  allowedClientIds?: string[];
}

/**
 * 注册 Provider API 代理路由
 * @param options 路由配置
 */
export function registerProviderApiRoutes(options: ProviderApiRoutesOptions): void {
  const { app, oidcProvider, userRepository, providerApiService, sdkProxy } = options;
  const allowedClientIds = new Set(options.allowedClientIds ?? []);

  if (!sdkProxy) {
    return;
  }

  app.post("/api/provider/:provider/request", async (request, reply) => {
    const bearer = await resolveBearerToken(
      oidcProvider,
      userRepository,
      request.headers.authorization,
    );

    if (!bearer) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (allowedClientIds.size > 0 && (!bearer.clientId || !allowedClientIds.has(bearer.clientId))) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    if (!hasScope(bearer.scope, PROVIDER_API_REQUIRED_SCOPE)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const { provider } = request.params as { provider: string };
    const providerRequest = request.body as ProviderApiRequest;

    try {
      const result = await providerApiService.request(provider, providerRequest, {
        userId: bearer.user.sub,
        groups: userGroupPermissionValues(bearer.user.groups),
        roles: bearer.user.roles,
      });
      return reply.send(result);
    } catch (err) {
      const error = toProviderApiError(err);
      return reply.code(error.statusCode).send({ error: error.message });
    }
  });
}

function toProviderApiError(error: unknown): { statusCode: number; message: string } {
  const message = summarizeTokenError(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("permission")) {
    return { statusCode: 403, message: "Forbidden" };
  }

  if (lowerMessage.includes("token not found")) {
    return { statusCode: 404, message: "Provider token not found" };
  }

  if (lowerMessage.includes("client not found")) {
    return { statusCode: 404, message: "Provider API provider not found" };
  }

  return { statusCode: 400, message };
}

function hasScope(scope: string | undefined, requiredScope: string): boolean {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean)).has(requiredScope);
}
