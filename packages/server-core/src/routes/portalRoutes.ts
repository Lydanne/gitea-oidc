/**
 * 内置普通用户门户路由。
 *
 * 门户是身份中心自己的 confidential OIDC Client。浏览器只持有独立的 HttpOnly
 * BFF Session Cookie，OIDC access token 仅在回调中完成身份校验，不会返回前端或持久化。
 */

import { type PortalApplicationListV1, parsePortalApplicationListV1 } from "@gitea-oidc/contracts";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import type { Provider } from "oidc-provider";
import { join } from "path";
import type { ResolvedGiteaOidcConfig } from "../config.js";
import {
  DistributedPortalSessionStore,
  PORTAL_LOGIN_STATE_TTL_SECONDS,
  PortalLoginStateLimitError,
  PortalSessionStore,
  type PortalSessionStoreLike,
} from "../portal/PortalSessionStore.js";
import { NoopAuditLogRepository } from "../repositories/NoopAuditLogRepository.js";
import type { AuditLogInput, AuditLogRepository } from "../types/audit.js";
import type { StateStore, UserInfo, UserRepository } from "../types/auth.js";
import type { PortalMeResponse, PortalUserSummary } from "../types/portal.js";
import { Logger } from "../utils/Logger.js";
import { sanitizeForLog } from "../utils/logSanitizer.js";
import {
  getPortalPostLogoutRedirectUri,
  getPortalRedirectUri,
  normalizePortalBasePath,
  resolvePortalClient,
} from "../utils/portalClient.js";
import { userHasAnyGroup } from "../utils/userGroups.js";

const PORTAL_COOKIE_NAME = "gitea_oidc_portal_session";
const PORTAL_LOGIN_COOKIE_NAME = "gitea_oidc_portal_login";
const PORTAL_ACTION_HEADER = "x-gitea-oidc-portal-action";
interface HeaderTarget {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
}

interface PortalAccessTokenLike {
  accountId?: string;
  clientId?: string;
  grantId?: string;
  exp?: number;
  kind?: string;
  isExpired?: boolean;
  isValid?: boolean;
  destroy?: () => Promise<void> | void;
}

interface PortalGrantLike {
  accountId?: string;
  clientId?: string;
  isExpired?: boolean;
}

export interface PortalRoutesOptions {
  app: FastifyInstance;
  config: ResolvedGiteaOidcConfig;
  oidcProvider: Provider;
  userRepository: UserRepository;
  auditLogRepository?: AuditLogRepository;
  /** Redis stateStore 时门户 state 与 Session 可在多个实例间共享。 */
  stateStore?: StateStore;
  publicDir: string;
  /** 返回已经完成 active、visible 和安全字段投影的门户应用列表。 */
  listPortalApplications: () => PortalApplicationListV1 | Promise<PortalApplicationListV1>;
}

/** 注册门户静态页面、BFF 登录和只读 API。 */
export function registerPortalRoutes(options: PortalRoutesOptions): PortalSessionStoreLike | null {
  const { app, config, oidcProvider, userRepository } = options;
  if (!config.portal.enabled) return null;

  const portalConfig = config.portal;
  const basePath = normalizePortalBasePath(portalConfig.basePath);
  const allowHttpImages = !isHttpsUrl(config.server.url);
  const adminBasePath = normalizeAdminBasePath(config.admin.basePath);
  const portalClient = resolvePortalClient(config);
  const postLogoutRedirectUri = getPortalPostLogoutRedirectUri(config, basePath);
  const auditLogRepository = options.auditLogRepository ?? new NoopAuditLogRepository();
  const sessionStore: PortalSessionStoreLike =
    config.auth?.stateStore?.type === "redis" && options.stateStore
      ? new DistributedPortalSessionStore(options.stateStore, portalConfig.sessionTtlSeconds)
      : new PortalSessionStore(portalConfig.sessionTtlSeconds);
  const portalIndexHtml = injectPortalRuntimeConfig(
    readFileSync(join(options.publicDir, "portal", "index.html"), "utf8"),
    { basePath, adminBasePath },
  );

  const sendPortalIndex = async (_request: FastifyRequest, reply: FastifyReply) => {
    setPortalSecurityHeaders(reply, allowHttpImages);
    setNoStoreHeaders(reply);
    return reply.type("text/html; charset=utf-8").send(portalIndexHtml);
  };

  app.get(`${basePath}/assets/*`, async (request, reply) => {
    const assetPath = readPortalAssetPath(request.params);
    if (assetPath === undefined) return reply.code(404).send("Not Found");
    setPortalSecurityHeaders(reply, allowHttpImages);
    return reply.sendFile(`portal/assets/${assetPath}`, {
      maxAge: "1y",
      immutable: true,
    });
  });

  app.get(basePath, sendPortalIndex);
  app.get(`${basePath}/`, sendPortalIndex);
  app.get(`${basePath}/signed-out`, sendPortalIndex);

  app.get(`${basePath}/login/start`, async (request, reply) => {
    setPortalSecurityHeaders(reply, allowHttpImages);
    setNoStoreHeaders(reply);
    const query = request.query as { returnTo?: string };
    const returnTo = normalizePortalReturnPath(basePath, query.returnTo);
    const browserBinding = readValidPortalLoginBinding(request) ?? randomBytes(32).toString("hex");
    const bindingHash = hashPortalLoginValue(browserBinding);
    const codeVerifier = randomBytes(48).toString("base64url");
    let state: string;
    try {
      await sessionStore.checkLoginRateLimit([
        `source:${hashPortalLoginValue(readPortalRequestSource(request))}`,
        `browser:${bindingHash}`,
      ]);
      state = await sessionStore.createLoginState(returnTo, bindingHash, codeVerifier);
    } catch (error) {
      if (error instanceof PortalLoginStateLimitError) {
        return reply.code(429).send("Too many portal login attempts");
      }
      throw error;
    }

    const authorizationUrl = new URL(`${config.oidc.issuer.replace(/\/+$/u, "")}/auth`);
    authorizationUrl.searchParams.set("client_id", portalClient.client_id);
    authorizationUrl.searchParams.set("redirect_uri", getPortalRedirectUri(config, basePath));
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid profile email");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", createPkceChallenge(codeVerifier));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    reply.header(
      "Set-Cookie",
      buildPortalLoginCookie(config, basePath, browserBinding, PORTAL_LOGIN_STATE_TTL_SECONDS),
    );
    return reply.redirect(authorizationUrl.toString());
  });

  app.get(`${basePath}/callback`, async (request, reply) => {
    setPortalSecurityHeaders(reply, allowHttpImages);
    setNoStoreHeaders(reply);
    const query = request.query as { code?: string; state?: string; error?: string };
    const loginState = query.state ? await sessionStore.consumeLoginState(query.state) : null;
    const browserBinding = readValidPortalLoginBinding(request);
    const clearedLoginCookie = buildPortalLoginCookie(config, basePath, "", 0);
    reply.header("Set-Cookie", clearedLoginCookie);

    if (
      !loginState ||
      !browserBinding ||
      !matchesPortalLoginBinding(loginState.bindingHash, browserBinding)
    ) {
      if (loginState) {
        await appendPortalAuditSafely(auditLogRepository, {
          eventType: "user.login",
          outcome: "failure",
          source: "portal",
          clientId: portalClient.client_id,
          ipAddress: readPortalRequestSource(request),
          userAgent: readHeaderValue(request.headers?.["user-agent"]),
          reason: "invalid_state",
        });
      }
      return reply.code(400).send("Invalid portal login state");
    }

    if (query.error || !query.code) {
      await appendPortalAuditSafely(auditLogRepository, {
        eventType: "user.login",
        outcome: "failure",
        source: "portal",
        clientId: portalClient.client_id,
        ipAddress: readPortalRequestSource(request),
        userAgent: readHeaderValue(request.headers?.["user-agent"]),
        reason: query.error === "access_denied" ? "access_denied" : "missing_code",
      });
      return reply.code(400).send("Portal login was not completed");
    }

    let user: UserInfo | null = null;
    let accessToken: PortalAccessTokenLike | null = null;
    try {
      const tokenResponse = await exchangePortalCode(
        config,
        basePath,
        portalClient,
        query.code,
        loginState.codeVerifier,
      );
      const resolved = await resolvePortalCallbackIdentity(
        oidcProvider,
        tokenResponse.access_token,
        portalClient.client_id,
      );
      accessToken = resolved?.accessToken ?? null;
      user = resolved ? await userRepository.findById(resolved.userId) : null;
    } catch (error) {
      Logger.error("[用户门户] OIDC 回调失败:", sanitizeForLog(error));
      await appendPortalAuditSafely(auditLogRepository, {
        eventType: "user.login",
        outcome: "failure",
        source: "portal",
        clientId: portalClient.client_id,
        ipAddress: readPortalRequestSource(request),
        userAgent: readHeaderValue(request.headers?.["user-agent"]),
        reason: "callback_failed",
      });
      return reply.code(502).send("Portal login failed");
    } finally {
      if (accessToken?.destroy) {
        try {
          await accessToken.destroy();
        } catch (error) {
          Logger.error("[用户门户] 清理一次性 access token 失败:", sanitizeForLog(error));
        }
      }
    }

    if (!user || !isActiveUser(user)) {
      await appendPortalAuditSafely(auditLogRepository, {
        eventType: "user.login",
        outcome: "failure",
        source: "portal",
        userId: user?.sub,
        username: user?.username,
        clientId: portalClient.client_id,
        ipAddress: readPortalRequestSource(request),
        userAgent: readHeaderValue(request.headers?.["user-agent"]),
        reason: user ? "user_disabled" : "invalid_token_binding",
      });
      return reply.code(403).send("Forbidden");
    }

    const session = await sessionStore.createSession(user.sub);
    await appendPortalAuditSafely(auditLogRepository, {
      eventType: "user.login",
      outcome: "success",
      source: "portal",
      userId: user.sub,
      username: user.username,
      provider: user.authProvider,
      clientId: portalClient.client_id,
      ipAddress: readPortalRequestSource(request),
      userAgent: readHeaderValue(request.headers?.["user-agent"]),
    });
    reply.header("Set-Cookie", [
      clearedLoginCookie,
      buildPortalCookie(config, basePath, session.id, portalConfig.sessionTtlSeconds),
    ]);
    return reply.redirect(loginState.returnTo);
  });

  const requirePortalUser = async (request: FastifyRequest, reply: FastifyReply) => {
    setPortalSecurityHeaders(reply, allowHttpImages);
    setNoStoreHeaders(reply);
    const user = await resolvePortalUser(request, sessionStore, userRepository);
    if (!user) {
      reply.header("Set-Cookie", buildPortalCookie(config, basePath, "", 0));
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    return user;
  };

  app.get(`${basePath}/api/me`, async (request, reply) => {
    const user = await requirePortalUser(request, reply);
    if (!user) return;
    const response: PortalMeResponse = {
      user: toPortalUserSummary(user),
      admin: config.admin.enabled && userHasAnyGroup(user.groups, config.admin.allowedGroups ?? []),
      basePath,
      adminBasePath,
    };
    return response;
  });

  app.get(`${basePath}/api/applications`, async (request, reply) => {
    if (!(await requirePortalUser(request, reply))) return;
    try {
      return parsePortalApplicationListV1(await options.listPortalApplications());
    } catch (error) {
      Logger.error("[用户门户] 读取应用列表失败:", sanitizeForLog(error));
      return reply.code(500).send({ error: "Application directory is unavailable" });
    }
  });

  app.post(`${basePath}/logout`, async (request, reply) => {
    setPortalSecurityHeaders(reply, allowHttpImages);
    setNoStoreHeaders(reply);
    const sessionId = readCookie(request, PORTAL_COOKIE_NAME);
    if (sessionId && !isPortalLogoutRequestAllowed(request, config, basePath)) {
      return reply.code(403).send({ error: "CSRF protection failed" });
    }

    if (sessionId) {
      const session = await sessionStore.getSession(sessionId);
      await sessionStore.deleteSession(sessionId);
      if (session) {
        const user = await userRepository.findById(session.userId);
        await appendPortalAuditSafely(auditLogRepository, {
          eventType: "user.logout",
          outcome: "success",
          source: "portal",
          userId: session.userId,
          username: user?.username,
          provider: user?.authProvider,
          clientId: portalClient.client_id,
          ipAddress: readPortalRequestSource(request),
          userAgent: readHeaderValue(request.headers?.["user-agent"]),
        });
      }
    }

    reply.header("Set-Cookie", buildPortalCookie(config, basePath, "", 0));
    return {
      ok: true,
      redirectTo: buildPortalEndSessionUrl(config, portalClient.client_id, postLogoutRedirectUri),
    };
  });

  return sessionStore;
}

export function setPortalSecurityHeaders(target: HeaderTarget, allowHttpImages = false): void {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: https:${allowHttpImages ? " http:" : ""}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  setHeader(target, "Content-Security-Policy", contentSecurityPolicy);
  setHeader(target, "X-Frame-Options", "DENY");
  setHeader(target, "X-Content-Type-Options", "nosniff");
  setHeader(target, "Referrer-Policy", "same-origin");
  setHeader(target, "Cross-Origin-Opener-Policy", "same-origin");
  setHeader(target, "Cross-Origin-Resource-Policy", "same-origin");
  setHeader(target, "Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function setHeader(target: HeaderTarget, name: string, value: string): void {
  if (target.header) {
    target.header(name, value);
    return;
  }
  target.setHeader?.(name, value);
}

function setNoStoreHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

function injectPortalRuntimeConfig(
  html: string,
  runtime: { basePath: string; adminBasePath: string },
): string {
  const htmlElement = /<html(?=[\s>])/iu;
  if (!htmlElement.test(html)) throw new Error("用户门户 index.html 缺少 html 根元素");
  const attributes = [
    `data-gitea-oidc-portal-base-path="${escapeHtmlAttribute(runtime.basePath)}"`,
    `data-gitea-oidc-admin-base-path="${escapeHtmlAttribute(runtime.adminBasePath)}"`,
  ].join(" ");
  const withRuntime = html.replace(htmlElement, `<html ${attributes}`);
  const headElement = /<head(?=[\s>])[^>]*>/iu;
  if (!headElement.test(withRuntime)) throw new Error("用户门户 index.html 缺少 head 元素");
  return withRuntime.replace(
    headElement,
    (head) => `${head}\n  <base href="${escapeHtmlAttribute(`${runtime.basePath}/`)}">`,
  );
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>'"]/gu, (character) => {
    return (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      } as Record<string, string>
    )[character] as string;
  });
}

function readPortalAssetPath(params: unknown): string | undefined {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return undefined;
  const value = (params as Record<string, unknown>)["*"];
  if (typeof value !== "string" || value === "" || value.includes("\\")) return undefined;
  const segments = value.split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function normalizePortalReturnPath(basePath: string, value?: string): string {
  if (!value) return basePath;
  try {
    const url = new URL(value, "http://portal.local");
    const insidePortal = url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
    const reserved = ["/api", "/assets", "/callback", "/login", "/signed-out"].some(
      (suffix) =>
        url.pathname === `${basePath}${suffix}` || url.pathname.startsWith(`${basePath}${suffix}/`),
    );
    if (url.origin !== "http://portal.local" || !insidePortal || reserved) return basePath;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return basePath;
  }
}

async function exchangePortalCode(
  config: ResolvedGiteaOidcConfig,
  basePath: string,
  client: ResolvedGiteaOidcConfig["clients"][number],
  code: string,
  codeVerifier: string,
): Promise<{ access_token: string }> {
  const response = await fetch(`${config.oidc.issuer.replace(/\/+$/u, "")}/token`, {
    method: "POST",
    headers: {
      Authorization: buildOAuthBasicAuthorization(client.client_id, client.client_secret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getPortalRedirectUri(config, basePath),
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Portal token exchange failed: ${response.status}`);
  const value = (await response.json()) as { access_token?: unknown };
  if (typeof value.access_token !== "string" || !value.access_token) {
    throw new Error("Portal token exchange did not return an access token");
  }
  return { access_token: value.access_token };
}

function buildOAuthBasicAuthorization(clientId: string, clientSecret: string): string {
  const encoded = `${encodeFormComponent(clientId)}:${encodeFormComponent(clientSecret)}`;
  return `Basic ${Buffer.from(encoded).toString("base64")}`;
}

function encodeFormComponent(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

async function resolvePortalCallbackIdentity(
  oidcProvider: Provider,
  accessTokenValue: string,
  expectedClientId: string,
): Promise<{ userId: string; accessToken: PortalAccessTokenLike } | null> {
  const accessToken = (await (oidcProvider as any).AccessToken.find(accessTokenValue)) as
    | PortalAccessTokenLike
    | null
    | undefined;
  if (!isUsablePortalAccessToken(accessToken, expectedClientId)) return null;
  if (!(await isPortalAccessTokenBoundToActiveGrant(oidcProvider, accessToken))) return null;
  return { userId: accessToken.accountId, accessToken };
}

function isUsablePortalAccessToken(
  accessToken: PortalAccessTokenLike | null | undefined,
  expectedClientId: string,
): accessToken is PortalAccessTokenLike & {
  accountId: string;
  clientId: string;
  grantId: string;
} {
  if (!accessToken?.accountId || !accessToken.clientId || !accessToken.grantId) return false;
  if (accessToken.clientId !== expectedClientId) return false;
  if (accessToken.kind && accessToken.kind !== "AccessToken") return false;
  if (accessToken.isValid === false || accessToken.isExpired === true) return false;
  if (accessToken.exp && accessToken.exp * 1000 <= Date.now()) return false;
  return true;
}

async function isPortalAccessTokenBoundToActiveGrant(
  oidcProvider: Provider,
  accessToken: PortalAccessTokenLike & {
    accountId: string;
    clientId: string;
    grantId: string;
  },
): Promise<boolean> {
  const client = await (oidcProvider as any).Client?.find?.(accessToken.clientId);
  if (!client) return false;
  const grant = (await (oidcProvider as any).Grant?.find?.(accessToken.grantId, {
    ignoreExpiration: true,
  })) as PortalGrantLike | null | undefined;
  return Boolean(
    grant &&
      !grant.isExpired &&
      grant.clientId === accessToken.clientId &&
      grant.accountId === accessToken.accountId,
  );
}

async function resolvePortalUser(
  request: FastifyRequest,
  sessionStore: PortalSessionStoreLike,
  userRepository: UserRepository,
): Promise<UserInfo | null> {
  const sessionId = readCookie(request, PORTAL_COOKIE_NAME);
  const session = sessionId ? await sessionStore.getSession(sessionId) : null;
  if (!session) return null;
  const user = await userRepository.findById(session.userId);
  if (!user || !isActiveUser(user)) {
    await sessionStore.deleteSession(session.id);
    return null;
  }
  return user;
}

function isActiveUser(user: UserInfo): boolean {
  return !user.status || user.status === "active";
}

function toPortalUserSummary(user: UserInfo): PortalUserSummary {
  return omitUndefined({
    sub: user.sub,
    username: user.username,
    name: user.name,
    email: user.email,
    picture: user.picture,
    groups: user.groups,
    roles: user.roles,
    status: user.status,
  });
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function buildPortalCookie(
  config: ResolvedGiteaOidcConfig,
  basePath: string,
  value: string,
  maxAge: number,
): string {
  return buildCookie(config, PORTAL_COOKIE_NAME, basePath, value, maxAge);
}

function buildPortalLoginCookie(
  config: ResolvedGiteaOidcConfig,
  basePath: string,
  value: string,
  maxAge: number,
): string {
  return buildCookie(config, PORTAL_LOGIN_COOKIE_NAME, basePath, value, maxAge);
}

function buildCookie(
  config: ResolvedGiteaOidcConfig,
  name: string,
  basePath: string,
  value: string,
  maxAge: number,
): string {
  const secure = isHttpsUrl(config.server.url) || isHttpsUrl(config.oidc.issuer);
  return [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${basePath}`,
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const cookie = request.headers?.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === name) return value;
  }
  return undefined;
}

function readValidPortalLoginBinding(request: FastifyRequest): string | undefined {
  const value = readCookie(request, PORTAL_LOGIN_COOKIE_NAME);
  return value && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

function hashPortalLoginValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function matchesPortalLoginBinding(expectedHash: string, binding: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) return false;
  return timingSafeEqual(
    Buffer.from(expectedHash, "hex"),
    Buffer.from(hashPortalLoginValue(binding), "hex"),
  );
}

function isPortalLogoutRequestAllowed(
  request: FastifyRequest,
  config: ResolvedGiteaOidcConfig,
  basePath: string,
): boolean {
  return (
    hasHeaderValue(request, PORTAL_ACTION_HEADER, "logout") &&
    isJsonRequest(request) &&
    isTrustedPortalRequestSource(request, config, basePath)
  );
}

function hasHeaderValue(request: FastifyRequest, name: string, expected: string): boolean {
  const value = request.headers[name];
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

function isJsonRequest(request: FastifyRequest): boolean {
  const value = request.headers["content-type"];
  const contentType = Array.isArray(value) ? value.join(";") : value;
  return contentType?.toLowerCase().includes("application/json") ?? false;
}

function isTrustedPortalRequestSource(
  request: FastifyRequest,
  config: ResolvedGiteaOidcConfig,
  basePath: string,
): boolean {
  const expectedOrigin = new URL(config.server.url).origin;
  const origin = request.headers.origin;
  if (typeof origin === "string") return origin === expectedOrigin;
  const referer = request.headers.referer;
  if (typeof referer !== "string") return false;
  try {
    const url = new URL(referer);
    return (
      url.origin === expectedOrigin &&
      (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
    );
  } catch {
    return false;
  }
}

function buildPortalEndSessionUrl(
  config: ResolvedGiteaOidcConfig,
  clientId: string,
  postLogoutRedirectUri: string,
): string {
  const url = new URL(`${config.oidc.issuer.replace(/\/+$/u, "")}/session/end`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  return url.toString();
}

function normalizeAdminBasePath(basePath: string): string {
  return basePath.replace(/\/+$/u, "") || "/admin";
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function readPortalRequestSource(request: FastifyRequest): string {
  const target = request as FastifyRequest & {
    ip?: string;
    socket?: { remoteAddress?: string };
  };
  return target.ip || target.socket?.remoteAddress || "unknown";
}

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function appendPortalAuditSafely(
  repository: AuditLogRepository,
  input: AuditLogInput,
): Promise<void> {
  try {
    await repository.append(input);
  } catch (error) {
    Logger.error("[审计日志] 写入用户门户事件失败:", sanitizeForLog(error));
  }
}
