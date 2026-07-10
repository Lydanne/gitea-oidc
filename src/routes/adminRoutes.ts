/**
 * 内置后台管理路由
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import type { Provider } from "oidc-provider";
import { join } from "path";
import { OidcAdapterFactory } from "../adapters/OidcAdapterFactory";
import {
  AdminSessionStore,
  type AdminSessionStoreLike,
  DistributedAdminSessionStore,
} from "../admin/AdminSessionStore";
import type { GiteaOidcConfig } from "../config";
import { AuthCoordinator } from "../core/AuthCoordinator";
import { ProviderApiService } from "../provider-api/ProviderApiService";
import {
  isProviderTokenOwnerType,
  isProviderTokenStatus,
  normalizeTokenListString,
} from "../repositories/providerTokenListOptions";
import { isUserListSortField, USER_LIST_FILTER_FIELDS } from "../repositories/userListOptions";
import type { AdminTokenSummary, AdminUser } from "../types/admin";
import type { ListOptions, StateStore, UserInfo, UserRepository } from "../types/auth";
import type {
  ProviderTokenListOptions,
  ProviderTokenOwnerType,
  ProviderTokenRecord,
  ProviderTokenRepository,
} from "../types/providerApi";
import {
  findAdminClient,
  formatAdminClientRequirement,
  getAdminRedirectUri,
  normalizeAdminBasePath,
} from "../utils/adminClient";

const ADMIN_COOKIE_NAME = "gitea_oidc_admin_session";
const ADMIN_ACTION_HEADER = "x-gitea-oidc-admin-action";
const ADMIN_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const ADMIN_USER_STRING_FIELDS = ["username", "name", "email", "picture", "phone"] as const;
const ADMIN_USER_IDENTITY_FIELDS = ["authProvider", "externalId"] as const;
const ADMIN_USER_LIST_FIELDS = ["groups", "roles"] as const;
const ADMIN_USER_STATUS_VALUES = new Set(["active", "disabled", "locked", "pending"]);
const ADMIN_USER_LIST_DEFAULT_LIMIT = 100;
const ADMIN_USER_LIST_MAX_LIMIT = 500;
const ADMIN_TOKEN_LIST_DEFAULT_LIMIT = 100;
const ADMIN_TOKEN_LIST_MAX_LIMIT = 500;

interface AdminAccessTokenLike {
  accountId?: string;
  clientId?: string;
  grantId?: string;
  exp?: number;
  kind?: string;
  isExpired?: boolean;
  isValid?: boolean;
}

interface AdminGrantLike {
  accountId?: string;
  clientId?: string;
  isExpired?: boolean;
}

interface HeaderTarget {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
}

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

  /** Redis stateStore 时复用为后台 OAuth state 和会话的共享存储。 */
  stateStore?: StateStore;

  /** 删除用户或更换外部身份时撤销该账户的 OIDC 记录。 */
  revokeOidcAccount?: (accountId: string) => Promise<void>;
}

/**
 * 注册内置后台管理路由
 * @param options 路由配置
 */
export function registerAdminRoutes(options: AdminRoutesOptions): AdminSessionStoreLike | null {
  const { app, config, oidcProvider, authCoordinator, userRepository } = options;
  const adminConfig = config.admin;

  if (!adminConfig.enabled) {
    return null;
  }

  const basePath = normalizeAdminBasePath(adminConfig.basePath);
  const sessionStore: AdminSessionStoreLike =
    config.auth?.stateStore?.type === "redis" && options.stateStore
      ? new DistributedAdminSessionStore(options.stateStore, adminConfig.sessionTtlSeconds)
      : new AdminSessionStore(adminConfig.sessionTtlSeconds);
  const adminClient = resolveAdminClient(config, basePath);

  const sendAdminIndex = async (_request: FastifyRequest, reply: FastifyReply) => {
    setAdminSecurityHeaders(reply);
    return reply
      .type("text/html; charset=utf-8")
      .send(readFileSync(join(process.cwd(), "public", "admin", "index.html"), "utf8"));
  };

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
    const state = await sessionStore.createLoginState(returnTo);
    const redirectUri = getAdminRedirectUri(config, basePath);
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
    const returnTo = query.state ? await sessionStore.consumeLoginState(query.state) : null;
    if (!query.code || !returnTo) {
      return reply.code(400).send("Invalid admin login state");
    }

    const tokenResponse = await exchangeAdminCode(config, basePath, adminClient, query.code);
    const userId = await resolveAdminCallbackUserId(
      oidcProvider,
      tokenResponse.access_token,
      adminClient.client_id,
    );
    const user = userId ? await userRepository.findById(userId) : null;

    if (!user || !isActiveUser(user) || !isAdminUser(user, adminConfig.allowedGroups)) {
      return reply.code(403).send("Forbidden");
    }

    const session = await sessionStore.createSession(user.sub);
    reply.header(
      "Set-Cookie",
      buildAdminCookie(config, basePath, session.id, adminConfig.sessionTtlSeconds),
    );
    return reply.redirect(returnTo);
  });

  app.post(`${basePath}/logout`, async (request, reply) => {
    if (
      readCookie(request, ADMIN_COOKIE_NAME) &&
      !isAdminMutationRequestAllowed(request, config, basePath)
    ) {
      return reply.code(403).send({ error: "CSRF protection failed" });
    }

    const sessionId = readCookie(request, ADMIN_COOKIE_NAME);
    if (sessionId) {
      await sessionStore.deleteSession(sessionId);
    }
    reply.header("Set-Cookie", buildAdminCookie(config, basePath, "", 0));
    return reply.send({ ok: true });
  });

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await resolveAdminUser(request, sessionStore, userRepository);
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

  const requireAdminMutation = async (request: FastifyRequest, reply: FastifyReply) => {
    if (
      readCookie(request, ADMIN_COOKIE_NAME) &&
      !isAdminMutationRequestAllowed(request, config, basePath)
    ) {
      reply.code(403).send({ error: "CSRF protection failed" });
      return null;
    }

    return requireAdmin(request, reply);
  };

  app.get(`${basePath}/api/me`, async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    return { user: toAdminUser(user), admin: true };
  });

  app.get(`${basePath}/api/users`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = parseAdminUserListOptions(request.query);
    if (!query.ok) {
      return reply.code(400).send({ error: query.error });
    }
    const users = await userRepository.list(query.value);
    return users.map(toAdminUser);
  });

  app.get(`${basePath}/api/users/:sub`, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { sub } = request.params as { sub: string };
    const user = await userRepository.findById(sub);
    return user ? toAdminUser(user) : reply.code(404).send({ error: "User not found" });
  });

  app.post(`${basePath}/api/users`, async (request, reply) => {
    if (!(await requireAdminMutation(request, reply))) return;
    const payload = parseAdminUserPayload(request.body, { allowIdentityFields: true });
    if (!payload.ok) {
      return reply.code(400).send({ error: payload.error });
    }
    const user = await userRepository.create(payload.value as UserInfo);
    return reply.code(201).send(toAdminUser(user));
  });

  app.patch(`${basePath}/api/users/:sub`, async (request, reply) => {
    if (!(await requireAdminMutation(request, reply))) return;
    const { sub } = request.params as { sub: string };
    const payload = parseAdminUserPayload(request.body, { allowIdentityFields: false });
    if (!payload.ok) {
      return reply.code(400).send({ error: payload.error });
    }
    const existingUser = await userRepository.findById(sub);
    if (!existingUser) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (
      existingUser.status === "active" &&
      payload.value.status !== undefined &&
      payload.value.status !== "active"
    ) {
      await revokeUserCredentials(options, sub);
    }
    const user = await userRepository.update(sub, payload.value);
    return toAdminUser(user);
  });

  app.delete(`${basePath}/api/users/:sub`, async (request, reply) => {
    if (!(await requireAdminMutation(request, reply))) return;
    const { sub } = request.params as { sub: string };
    const user = await userRepository.findById(sub);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    await revokeUserCredentials(options, user.sub);
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
    const query = parseAdminTokenListOptions(request.query);
    if (!query.ok) {
      return reply.code(400).send({ error: query.error });
    }
    const tokens = (await options.tokenRepository?.list(query.value)) ?? [];
    return tokens.map(toAdminTokenSummary);
  });

  app.post(`${basePath}/api/tokens/probe`, async (request, reply) => {
    if (!(await requireAdminMutation(request, reply))) return;
    if (!options.providerApiService) {
      return reply.code(400).send({ error: "Provider API is not enabled" });
    }
    const body = parseAdminTokenProbePayload(request.body);
    if (!body.ok) {
      return reply.code(400).send({ error: body.error });
    }
    const status = await options.providerApiService?.probeToken(
      body.value.provider,
      body.value.ownerType,
      body.value.ownerId,
    );
    return { status };
  });

  return sessionStore;
}

export function setAdminSecurityHeaders(target: HeaderTarget): void {
  setHeader(target, "Content-Security-Policy", ADMIN_CONTENT_SECURITY_POLICY);
  setHeader(target, "X-Frame-Options", "DENY");
  setHeader(target, "X-Content-Type-Options", "nosniff");
  setHeader(target, "Referrer-Policy", "same-origin");
  setHeader(target, "Cross-Origin-Opener-Policy", "same-origin");
}

function setHeader(target: HeaderTarget, name: string, value: string): void {
  if (target.header) {
    target.header(name, value);
    return;
  }
  target.setHeader?.(name, value);
}

async function resolveAdminUser(
  request: FastifyRequest,
  sessionStore: AdminSessionStoreLike,
  userRepository: UserRepository,
): Promise<UserInfo | null> {
  const sessionId = readCookie(request, ADMIN_COOKIE_NAME);
  const session = sessionId ? await sessionStore.getSession(sessionId) : null;

  if (session) {
    const user = await userRepository.findById(session.userId);
    if (!user || !isActiveUser(user)) {
      await sessionStore.deleteSession(session.id);
      return null;
    }
    return user;
  }

  return null;
}

function isAdminUser(user: UserInfo, allowedGroups: string[]): boolean {
  return (user.groups ?? []).some((group) => allowedGroups.includes(group));
}

function isActiveUser(user: UserInfo): boolean {
  return !user.status || user.status === "active";
}

async function revokeUserCredentials(options: AdminRoutesOptions, userId: string): Promise<void> {
  // 先撤销 OIDC 令牌和第三方 provider token；任何一项失败都不继续停用或删除用户，避免
  // “状态已改变但旧 refresh token 仍可用”的不一致状态。
  await (options.revokeOidcAccount ?? OidcAdapterFactory.revokeByAccountId)(userId);
  await options.tokenRepository?.deleteByOwnerId(userId);
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

function buildAdminCookie(
  config: GiteaOidcConfig,
  basePath: string,
  value: string,
  maxAge: number,
): string {
  const secure = isHttpsUrl(config.server.url) || isHttpsUrl(config.oidc.issuer);
  return [
    `${ADMIN_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${basePath}`,
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function isAdminMutationRequestAllowed(
  request: FastifyRequest,
  config: GiteaOidcConfig,
  basePath: string,
): boolean {
  return (
    hasHeaderValue(request, ADMIN_ACTION_HEADER, "1") &&
    isJsonRequest(request) &&
    isTrustedAdminRequestSource(request, config, basePath)
  );
}

function hasHeaderValue(request: FastifyRequest, name: string, expected: string): boolean {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value.includes(expected);
  }
  return value === expected;
}

function isJsonRequest(request: FastifyRequest): boolean {
  const contentType = request.headers["content-type"];
  const value = Array.isArray(contentType) ? contentType.join(";") : contentType;
  return value?.toLowerCase().includes("application/json") ?? false;
}

function isTrustedAdminRequestSource(
  request: FastifyRequest,
  config: GiteaOidcConfig,
  basePath: string,
): boolean {
  const expectedOrigin = new URL(config.server.url).origin;
  const origin = request.headers.origin;
  if (typeof origin === "string") {
    return origin === expectedOrigin;
  }

  const referer = request.headers.referer;
  if (typeof referer !== "string") {
    return false;
  }

  try {
    const url = new URL(referer);
    return url.origin === expectedOrigin && isAdminRoutePath(url.pathname, basePath);
  } catch {
    return false;
  }
}

function isAdminRoutePath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function toAdminTokenSummary(token: ProviderTokenRecord): AdminTokenSummary {
  return {
    id: token.id,
    provider: token.provider,
    ownerType: token.ownerType,
    ownerId: token.ownerId,
    tokenType: token.tokenType,
    scope: token.scope,
    expiresAt: token.expiresAt,
    refreshExpiresAt: token.refreshExpiresAt,
    status: token.status,
    lastProbedAt: token.lastProbedAt,
    lastRefreshAt: token.lastRefreshAt,
    lastError: token.lastError,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
  };
}

function toAdminUser(user: UserInfo): AdminUser {
  return omitUndefined({
    sub: user.sub,
    username: user.username,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    authProvider: user.authProvider,
    externalId: user.externalId,
    groups: user.groups,
    roles: user.roles,
    status: user.status,
    picture: user.picture,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    lastLoginAt: user.lastLoginAt,
    lastSyncedAt: user.lastSyncedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function parseAdminUserPayload(
  body: unknown,
  options: { allowIdentityFields: boolean },
): { ok: true; value: Partial<UserInfo> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "User payload must be an object" };
  }

  const input = body as Record<string, unknown>;
  const stringFields = options.allowIdentityFields
    ? [...ADMIN_USER_STRING_FIELDS, ...ADMIN_USER_IDENTITY_FIELDS]
    : ADMIN_USER_STRING_FIELDS;
  const allowedKeys = new Set<string>([...stringFields, ...ADMIN_USER_LIST_FIELDS, "status"]);
  const unsupported = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    return { ok: false, error: `Unsupported user fields: ${unsupported.join(", ")}` };
  }

  const payload: Partial<UserInfo> = {};
  for (const field of stringFields) {
    const value = input[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      return { ok: false, error: `User field must be a string: ${field}` };
    }
    payload[field] = value;
  }

  for (const field of ADMIN_USER_LIST_FIELDS) {
    const value = input[field];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return { ok: false, error: `User field must be a string array: ${field}` };
    }
    payload[field] = value;
  }

  if (input.status !== undefined) {
    if (typeof input.status !== "string" || !ADMIN_USER_STATUS_VALUES.has(input.status)) {
      return { ok: false, error: "User status is invalid" };
    }
    payload.status = input.status as UserInfo["status"];
  }

  return { ok: true, value: payload };
}

function parseAdminUserListOptions(
  query: unknown,
): { ok: true; value: ListOptions } | { ok: false; error: string } {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return { ok: true, value: {} };
  }

  const input = query as Record<string, unknown>;
  const allowedKeys = new Set([
    ...USER_LIST_FILTER_FIELDS,
    "sortBy",
    "sortOrder",
    "offset",
    "limit",
  ]);
  const unsupported = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    return { ok: false, error: `Unsupported user list query fields: ${unsupported.join(", ")}` };
  }

  const filter: Record<string, string> = {};
  for (const field of USER_LIST_FILTER_FIELDS) {
    const value = input[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      return { ok: false, error: `User list query field must be a string: ${field}` };
    }
    filter[field] = value;
  }

  const value: ListOptions = {};
  if (Object.keys(filter).length > 0) {
    value.filter = filter;
  }

  if (input.sortBy !== undefined) {
    if (typeof input.sortBy !== "string" || !isUserListSortField(input.sortBy)) {
      return { ok: false, error: "Unsupported user sort field" };
    }
    value.sortBy = input.sortBy;
  }

  if (input.sortOrder !== undefined) {
    if (input.sortOrder !== "asc" && input.sortOrder !== "desc") {
      return { ok: false, error: "Unsupported user sort order" };
    }
    value.sortOrder = input.sortOrder;
  }

  const offset = parseAdminListInteger(
    input.offset,
    "offset",
    0,
    Number.MAX_SAFE_INTEGER,
    "User list",
  );
  if (!offset.ok) {
    return offset;
  }
  if (offset.value !== undefined) {
    value.offset = offset.value;
  }

  const limit = parseAdminListInteger(
    input.limit,
    "limit",
    1,
    ADMIN_USER_LIST_MAX_LIMIT,
    "User list",
  );
  if (!limit.ok) {
    return limit;
  }
  value.limit = limit.value ?? ADMIN_USER_LIST_DEFAULT_LIMIT;

  return { ok: true, value };
}

function parseAdminTokenListOptions(
  query: unknown,
): { ok: true; value: ProviderTokenListOptions } | { ok: false; error: string } {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return { ok: true, value: {} };
  }

  const input = query as Record<string, unknown>;
  const allowedKeys = new Set(["provider", "ownerType", "ownerId", "status", "offset", "limit"]);
  const unsupported = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    return { ok: false, error: `Unsupported token list query fields: ${unsupported.join(", ")}` };
  }

  const value: ProviderTokenListOptions = {};
  for (const field of ["provider", "ownerId"] as const) {
    const inputValue = input[field];
    if (inputValue === undefined) {
      continue;
    }
    if (typeof inputValue !== "string") {
      return { ok: false, error: `Provider token ${field} must be a string` };
    }
    try {
      value[field] = normalizeTokenListString(inputValue, field);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : `Provider token ${field} is invalid`,
      };
    }
  }

  if (input.ownerType !== undefined) {
    if (!isProviderTokenOwnerType(input.ownerType)) {
      return { ok: false, error: "Unsupported provider token owner type" };
    }
    value.ownerType = input.ownerType;
  }

  if (input.status !== undefined) {
    if (!isProviderTokenStatus(input.status)) {
      return { ok: false, error: "Unsupported provider token status" };
    }
    value.status = input.status;
  }

  const offset = parseAdminListInteger(
    input.offset,
    "offset",
    0,
    Number.MAX_SAFE_INTEGER,
    "Provider token list",
  );
  if (!offset.ok) {
    return offset;
  }
  if (offset.value !== undefined) {
    value.offset = offset.value;
  }

  const limit = parseAdminListInteger(
    input.limit,
    "limit",
    1,
    ADMIN_TOKEN_LIST_MAX_LIMIT,
    "Provider token list",
  );
  if (!limit.ok) {
    return limit;
  }
  value.limit = limit.value ?? ADMIN_TOKEN_LIST_DEFAULT_LIMIT;

  return { ok: true, value };
}

function parseAdminTokenProbePayload(
  body: unknown,
):
  | { ok: true; value: { provider: string; ownerType: ProviderTokenOwnerType; ownerId: string } }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Token probe payload must be an object" };
  }

  const input = body as Record<string, unknown>;
  const allowedKeys = new Set(["provider", "ownerType", "ownerId"]);
  const unsupported = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    return { ok: false, error: `Unsupported token probe fields: ${unsupported.join(", ")}` };
  }

  if (typeof input.provider !== "string") {
    return { ok: false, error: "Provider token provider must be a string" };
  }
  if (!isProviderTokenOwnerType(input.ownerType)) {
    return { ok: false, error: "Unsupported provider token owner type" };
  }
  if (typeof input.ownerId !== "string") {
    return { ok: false, error: "Provider token ownerId must be a string" };
  }

  try {
    return {
      ok: true,
      value: {
        provider: normalizeTokenListString(input.provider, "provider"),
        ownerType: input.ownerType,
        ownerId: normalizeTokenListString(input.ownerId, "ownerId"),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Token probe payload is invalid",
    };
  }
}

function parseAdminListInteger(
  input: unknown,
  name: string,
  min: number,
  max: number,
  subject: string,
): { ok: true; value?: number } | { ok: false; error: string } {
  if (input === undefined) {
    return { ok: true };
  }
  if (typeof input !== "string" || !/^\d+$/.test(input)) {
    return { ok: false, error: `${subject} ${name} must be an integer` };
  }

  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { ok: false, error: `${subject} ${name} is out of range` };
  }
  return { ok: true, value };
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

function resolveAdminClient(
  config: GiteaOidcConfig,
  basePath: string,
): GiteaOidcConfig["clients"][number] {
  const client = findAdminClient(config, basePath);

  if (!client) {
    const redirectUri = getAdminRedirectUri(config, basePath);
    throw new Error(
      `Admin client configuration is invalid: ${formatAdminClientRequirement(redirectUri)}`,
    );
  }

  return client;
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
    redirect_uri: getAdminRedirectUri(config, basePath),
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

async function resolveAdminCallbackUserId(
  oidcProvider: Provider,
  accessTokenValue: string | undefined,
  expectedClientId: string,
): Promise<string | null> {
  if (!accessTokenValue) {
    return null;
  }

  const accessToken = (await (oidcProvider as any).AccessToken.find(accessTokenValue)) as
    | AdminAccessTokenLike
    | null
    | undefined;
  if (!isUsableAdminAccessToken(accessToken, expectedClientId)) {
    return null;
  }

  if (!(await isAdminAccessTokenBoundToActiveGrant(oidcProvider, accessToken))) {
    return null;
  }

  return accessToken.accountId;
}

function isUsableAdminAccessToken(
  accessToken: AdminAccessTokenLike | null | undefined,
  expectedClientId: string,
): accessToken is AdminAccessTokenLike & {
  accountId: string;
  clientId: string;
  grantId: string;
} {
  if (!accessToken?.accountId || !accessToken.clientId || !accessToken.grantId) {
    return false;
  }

  if (accessToken.clientId !== expectedClientId) {
    return false;
  }

  if (accessToken.kind && accessToken.kind !== "AccessToken") {
    return false;
  }

  if (accessToken.isValid === false || accessToken.isExpired === true) {
    return false;
  }

  if (accessToken.exp && accessToken.exp * 1000 <= Date.now()) {
    return false;
  }

  return true;
}

async function isAdminAccessTokenBoundToActiveGrant(
  oidcProvider: Provider,
  accessToken: AdminAccessTokenLike & { accountId: string; clientId: string; grantId: string },
): Promise<boolean> {
  const client = await (oidcProvider as any).Client?.find?.(accessToken.clientId);
  if (!client) {
    return false;
  }

  const grant = (await (oidcProvider as any).Grant?.find?.(accessToken.grantId, {
    ignoreExpiration: true,
  })) as AdminGrantLike | null | undefined;
  if (!grant || grant.isExpired) {
    return false;
  }

  return grant.clientId === accessToken.clientId && grant.accountId === accessToken.accountId;
}
