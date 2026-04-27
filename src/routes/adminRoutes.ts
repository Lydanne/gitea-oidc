/**
 * 内置后台管理路由
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import type { Provider } from "oidc-provider";
import { join } from "path";
import { AdminSessionStore } from "../admin/AdminSessionStore";
import type { GiteaOidcConfig } from "../config";
import { AuthCoordinator } from "../core/AuthCoordinator";
import { ProviderApiService } from "../provider-api/ProviderApiService";
import type { UserInfo, UserRepository } from "../types/auth";
import type { ProviderTokenRepository } from "../types/providerApi";
import { resolveBearerUser } from "../utils/oidcToken";

const ADMIN_COOKIE_NAME = "gitea_oidc_admin_session";

/**
 * 后台管理路由配置
 */
export interface AdminRoutesOptions {
  /** Fastify 实例 */
  app: FastifyInstance;

  /** 完整配置 */
  config: GiteaOidcConfig;

  /** OIDC Provider 实例 */
  oidcProvider: Provider;

  /** 认证协调器 */
  authCoordinator: AuthCoordinator;

  /** 用户仓储 */
  userRepository: UserRepository;

  /** Provider API 服务 */
  providerApiService?: ProviderApiService;

  /** Provider token 仓储 */
  tokenRepository?: ProviderTokenRepository;
}

/**
 * 注册内置后台管理路由
 * @param options 路由配置
 */
export function registerAdminRoutes(options: AdminRoutesOptions): AdminSessionStore | null {
  const { app, config, oidcProvider, authCoordinator, userRepository } = options;
  const adminConfig = config.admin;

  if (!adminConfig.enabled) {
    return null;
  }

  const basePath = adminConfig.basePath.replace(/\/+$/, "") || "/admin";
  const sessionStore = new AdminSessionStore(adminConfig.sessionTtlSeconds);
  const adminClient = config.clients[0];

  const sendAdminIndex = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply
      .type("text/html; charset=utf-8")
      .send(readFileSync(join(process.cwd(), "public", "admin", "index.html"), "utf8"));

  app.get(basePath, async (_request, reply) => {
    return reply.redirect(`${basePath}/users`);
  });

  for (const routePath of [
    `${basePath}/login`,
    `${basePath}/users`,
    `${basePath}/providers`,
    `${basePath}/tokens`,
  ]) {
    app.get(routePath, sendAdminIndex);
  }

  app.get(`${basePath}/login/start`, async (request, reply) => {
    const query = request.query as { returnTo?: string };
    const returnTo = normalizeAdminReturnPath(basePath, query.returnTo);
    const state = sessionStore.createLoginState(returnTo);
    const redirectUri = `${config.server.url}${basePath}/callback`;
    const url = new URL(`${config.oidc.issuer}/auth`);
    url.searchParams.set("client_id", adminClient.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid profile email");
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get(`${basePath}/callback`, async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    const returnTo = query.state ? sessionStore.consumeLoginState(query.state) : null;
    if (!query.code || !returnTo) {
      return reply.code(400).send("Invalid admin login state");
    }

    const tokenResponse = await exchangeAdminCode(config, basePath, adminClient, query.code);
    const accessToken = await (oidcProvider as any).AccessToken.find(tokenResponse.access_token);
    const userId = accessToken?.accountId;
    const user = userId ? await userRepository.findById(userId) : null;

    if (!user || !isAdminUser(user, adminConfig.allowedGroups)) {
      return reply.code(403).send("Forbidden");
    }

    const session = sessionStore.createSession(user.sub);
    reply.header(
      "Set-Cookie",
      `${ADMIN_COOKIE_NAME}=${session.id}; HttpOnly; SameSite=Lax; Path=${basePath}; Max-Age=${adminConfig.sessionTtlSeconds}`,
    );
    return reply.redirect(returnTo);
  });

  app.post(`${basePath}/logout`, async (request, reply) => {
    const sessionId = readCookie(request, ADMIN_COOKIE_NAME);
    if (sessionId) {
      sessionStore.deleteSession(sessionId);
    }
    reply.header(
      "Set-Cookie",
      `${ADMIN_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=${basePath}; Max-Age=0`,
    );
    return reply.send({ ok: true });
  });

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await resolveAdminUser(request, sessionStore, oidcProvider, userRepository);
    if (!user) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }

    if (!isAdminUser(user, adminConfig.allowedGroups)) {
      reply.code(403).send({ error: "Forbidden" });
      return null;
    }

    return user;
  };

  app.get(`${basePath}/api/me`, async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    return { user, admin: true };
  });

  app.get(`${basePath}/api/users`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return userRepository.list((request.query as any) ?? {});
  });

  app.get(`${basePath}/api/users/:sub`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { sub } = request.params as { sub: string };
    const user = await userRepository.findById(sub);
    return user ? user : reply.code(404).send({ error: "User not found" });
  });

  app.post(`${basePath}/api/users`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const user = await userRepository.create(request.body as any);
    return reply.code(201).send(user);
  });

  app.patch(`${basePath}/api/users/:sub`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { sub } = request.params as { sub: string };
    return userRepository.update(sub, request.body as Partial<UserInfo>);
  });

  app.delete(`${basePath}/api/users/:sub`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { sub } = request.params as { sub: string };
    await userRepository.delete(sub);
    return reply.code(204).send();
  });

  app.get(`${basePath}/api/providers`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return {
      authProviders: authCoordinator.getProviders().map(
        (provider) =>
          provider.getMetadata?.() ?? {
            name: provider.name,
            displayName: provider.displayName,
          },
      ),
      apiProviders:
        options.providerApiService?.getClients().map((client) => ({
          provider: client.provider,
          baseUrl: client.baseUrl,
        })) ?? [],
    };
  });

  app.get(`${basePath}/api/tokens`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return options.tokenRepository?.list((request.query as any) ?? {}) ?? [];
  });

  app.post(`${basePath}/api/tokens/probe`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = request.body as { provider: string; ownerType: "user" | "app"; ownerId: string };
    const status = await options.providerApiService?.probeToken(
      body.provider,
      body.ownerType,
      body.ownerId,
    );
    return { status };
  });

  return sessionStore;
}

async function resolveAdminUser(
  request: FastifyRequest,
  sessionStore: AdminSessionStore,
  oidcProvider: Provider,
  userRepository: UserRepository,
): Promise<UserInfo | null> {
  const sessionId = readCookie(request, ADMIN_COOKIE_NAME);
  const session = sessionId ? sessionStore.getSession(sessionId) : null;

  if (session) {
    return userRepository.findById(session.userId);
  }

  return resolveBearerUser(oidcProvider, userRepository, request.headers.authorization);
}

function isAdminUser(user: UserInfo, allowedGroups: string[]): boolean {
  return (user.groups ?? []).some((group) => allowedGroups.includes(group));
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const cookie = request.headers.cookie;
  if (!cookie) {
    return undefined;
  }

  for (const part of cookie.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === name) {
      return value;
    }
  }

  return undefined;
}

function normalizeAdminReturnPath(basePath: string, value?: string): string {
  const allowedPaths = new Set([
    `${basePath}/users`,
    `${basePath}/providers`,
    `${basePath}/tokens`,
  ]);
  if (!value) {
    return `${basePath}/users`;
  }

  try {
    const url = new URL(value, "http://admin.local");
    if (url.origin !== "http://admin.local" || !allowedPaths.has(url.pathname)) {
      return `${basePath}/users`;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `${basePath}/users`;
  }
}

async function exchangeAdminCode(
  config: GiteaOidcConfig,
  basePath: string,
  client: GiteaOidcConfig["clients"][number],
  code: string,
): Promise<{ access_token: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${config.server.url}${basePath}/callback`,
  });

  const response = await fetch(`${config.oidc.issuer}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString(
        "base64",
      )}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Admin token exchange failed: ${response.status}`);
  }

  return (await response.json()) as { access_token: string };
}
