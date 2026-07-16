import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import formBody from "@fastify/formbody";
import middie from "@fastify/middie";
import staticFiles from "@fastify/static";
import fastify, { type FastifyInstance } from "fastify";
import { type Configuration, Provider } from "oidc-provider";
import path, { join } from "path";
import { ApplicationClientAdapter } from "./adapters/ApplicationClientAdapter.js";
import { OidcAdapterFactory } from "./adapters/OidcAdapterFactory.js";
import {
  createApplicationRuntime,
  listConfiguredPortalApplications,
} from "./applications/applicationRuntime.js";
import { registerOidcAuditEvents } from "./audit/oidcAuditEvents.js";
import {
  DEFAULT_AUDIT_CONFIG,
  loadConfig,
  type ResolvedXOidcConfig,
  resolveApplicationsConfig,
  type XOidcConfig,
} from "./config.js";
// 认证系统导入
import { AuthCoordinator } from "./core/AuthCoordinator.js";
import { DingTalkProviderApiClient } from "./provider-api/DingTalkProviderApiClient.js";
import { FeishuProviderApiClient } from "./provider-api/FeishuProviderApiClient.js";
import { ProviderApiService } from "./provider-api/ProviderApiService.js";
import { ProviderTokenProbeScheduler } from "./provider-api/ProviderTokenProbeScheduler.js";
import { FeishuAuthProvider } from "./providers/FeishuAuthProvider.js";
import { LocalAuthProvider } from "./providers/LocalAuthProvider.js";
import { AuditedUserRepository } from "./repositories/AuditedUserRepository.js";
import { AuditLogRepositoryFactory } from "./repositories/AuditLogRepositoryFactory.js";
import { ProviderTokenRepositoryFactory } from "./repositories/ProviderTokenRepositoryFactory.js";
import { UserRepositoryFactory } from "./repositories/UserRepositoryFactory.js";
import { registerAdminRoutes, setAdminSecurityHeaders } from "./routes/adminRoutes.js";
import { registerPortalRoutes, setPortalSecurityHeaders } from "./routes/portalRoutes.js";
import { registerProviderApiRoutes } from "./routes/providerApiRoutes.js";
import { MemoryStateStore } from "./stores/MemoryStateStore.js";
import { RedisStateStore } from "./stores/RedisStateStore.js";
import type { AuditLogRepository } from "./types/audit.js";
import type { AuthContext, StateStore } from "./types/auth.js";
import type { ProviderTokenRepository } from "./types/providerApi.js";
import { readConsentGrantDisclosure, renderConsentPage } from "./ui/consentPageRenderer.js";
import { formatAuthError, getUserErrorMessage } from "./utils/authErrors.js";
import {
  formatValidationErrors,
  printValidationResult,
  validateConfig,
} from "./utils/configValidator.js";
import { getOrGenerateJWKS } from "./utils/jwksManager.js";
import { Logger, LogLevel } from "./utils/Logger.js";
import {
  sanitizeForLog,
  summarizeClaimsForLog,
  summarizeUserForLog,
} from "./utils/logSanitizer.js";
import { registerRawJsonBodyParser } from "./utils/rawBody.js";
import { userToClaims } from "./utils/userClaims.js";

interface ServerRuntimeResources {
  app?: Pick<FastifyInstance, "close">;
  authCoordinator?: Pick<AuthCoordinator, "destroy">;
  userRepository?: { close?: () => Promise<void> | void };
  auditLogRepository?: Pick<AuditLogRepository, "close">;
  providerTokenProbeScheduler?: Pick<ProviderTokenProbeScheduler, "stop">;
  tokenRepository?: Pick<ProviderTokenRepository, "close">;
  stateStore?: { destroy?: () => Promise<void> | void };
  applicationRuntime?: { close: () => Promise<void> | void };
  portalSessionStore?: { clear: () => Promise<void> | void };
}

interface ServerCleanupOptions {
  cleanupAdapters?: () => Promise<void>;
  closeApp?: boolean;
}

interface HeaderTarget {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
}

export interface IdentityServerOptions {
  /** 静态资源目录。相对路径基于当前工作目录，默认使用 npm 包内的 public 目录。 */
  publicDir?: string;
}

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
let activeIdentityServerLease: symbol | undefined;

const INTERACTION_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * 创建尚未监听端口的 OIDC 服务器。
 *
 * 该函数只负责组装运行时资源，不注册进程信号，也不调用 `listen()`。
 * @param customConfig - 可选的自定义配置，如果不提供则从配置文件加载
 * @param options - 运行时装配选项
 * @returns Fastify 应用实例
 */
export async function createIdentityServer(
  customConfig?: XOidcConfig,
  options: IdentityServerOptions = {},
): Promise<FastifyInstance> {
  const config = await resolveRuntimeConfig(customConfig);
  return createIdentityServerFromConfig(config, options);
}

async function createIdentityServerFromConfig(
  config: ResolvedXOidcConfig,
  options: IdentityServerOptions,
): Promise<FastifyInstance> {
  const publicDir = path.resolve(options.publicDir ?? DEFAULT_PUBLIC_DIR);
  const app = fastify({
    logger: config.logging.enabled
      ? {
          level: config.logging.level,
          serializers: {
            req(request) {
              const pathname = new URL(request.url, "http://x-oidc.local").pathname;
              return { method: request.method, url: pathname, remoteAddress: request.ip };
            },
          },
        }
      : false,
    trustProxy: config.server.trustProxy
      ? config.server.trustedProxyIps && config.server.trustedProxyIps.length > 0
        ? config.server.trustedProxyIps
        : true
      : false,
  });
  const releaseIdentityServerLease = acquireIdentityServerLease();
  const runtimeResources: ServerRuntimeResources = { app };
  let runtimeCleanup: Promise<void> | undefined;
  const cleanupRuntime = () => {
    runtimeCleanup ??= cleanupServerResources(runtimeResources, { closeApp: false }).finally(
      releaseIdentityServerLease,
    );
    return runtimeCleanup;
  };
  try {
    app.addHook("onClose", cleanupRuntime);
  } catch (err) {
    releaseIdentityServerLease();
    throw err;
  }

  try {
    // 从配置获取日志设置并配置 Logger
    Logger.setLevel(config.logging.enabled ? toLogLevel(config.logging.level) : LogLevel.ERROR);
    // 注册中间件插件
    await app.register(middie);
    await app.register(cors, { origin: resolveCorsOrigin(config.server.corsOrigins) });
    registerRawJsonBodyParser(app);
    // 解析 application/x-www-form-urlencoded 表单
    await app.register(formBody);

    // 配置静态文件服务
    await app.register(staticFiles, {
      root: publicDir,
      prefix: "/",
      setHeaders: (res, filePath) => {
        if (isAdminPublicFilePath(filePath, publicDir)) {
          setAdminSecurityHeaders(res);
        } else if (isPortalPublicFilePath(filePath, publicDir)) {
          setPortalSecurityHeaders(res, new URL(config.server.url).protocol === "http:");
        }
      },
    });

    // 初始化认证系统
    Logger.info("[认证系统] 正在初始化...");

    const stateStore = createStateStore(config);
    runtimeResources.stateStore = stateStore;
    const storedUserRepository = UserRepositoryFactory.create(config.auth.userRepository);
    runtimeResources.userRepository = storedUserRepository as {
      close?: () => Promise<void> | void;
    };
    const auditLogRepository = AuditLogRepositoryFactory.create(
      config.auth.userRepository,
      config.audit ?? DEFAULT_AUDIT_CONFIG,
    );
    runtimeResources.auditLogRepository = auditLogRepository;
    const userRepository = new AuditedUserRepository(storedUserRepository, auditLogRepository);
    const applicationRuntime = await createApplicationRuntime(config);
    runtimeResources.applicationRuntime = applicationRuntime;
    if (config.providerApi.enabled) {
      assertStrongProviderTokenKey(config.providerApi.tokenEncryptionKey);
    }
    const tokenRepository = config.providerApi.enabled
      ? ProviderTokenRepositoryFactory.create(
          config.auth.userRepository,
          config.providerApi.tokenEncryptionKey,
        )
      : undefined;
    runtimeResources.tokenRepository = tokenRepository;
    const providerApiService =
      config.providerApi.enabled && tokenRepository
        ? new ProviderApiService({
            adminGroups: config.admin.allowedGroups,
            tokenRepository,
          })
        : undefined;
    let providerTokenProbeScheduler: ProviderTokenProbeScheduler | undefined;

    // 创建认证协调器
    const authCoordinator = new AuthCoordinator({
      app,
      stateStore,
      userRepository,
      auditLogRepository,
      providersConfig: config.auth.providers,
      autoRedirectSingleProvider: config.auth.autoRedirectSingleProvider,
    });
    runtimeResources.authCoordinator = authCoordinator;

    // 注册认证插件
    if (config.auth.providers.local?.enabled) {
      const localProvider = new LocalAuthProvider(userRepository, stateStore);
      authCoordinator.registerProvider(localProvider);
      Logger.info("[认证系统] 已注册 LocalAuthProvider");
    }

    if (config.auth.providers.feishu?.enabled) {
      const feishuProvider = new FeishuAuthProvider(
        userRepository,
        authCoordinator,
        tokenRepository,
      );
      authCoordinator.registerProvider(feishuProvider);
      Logger.info("[认证系统] 已注册 FeishuAuthProvider");
    }

    // 初始化所有插件
    await authCoordinator.initialize();
    Logger.info("[认证系统] 初始化完成");

    // 配置 OIDC 适配器
    if (config.adapter) {
      Logger.info(`[适配器] 配置类型: ${config.adapter.type}`);
      OidcAdapterFactory.configure(
        config.adapter,
        applicationRuntime
          ? {
              Client: () => new ApplicationClientAdapter(applicationRuntime.clientProjector),
            }
          : {},
      );
    } else {
      Logger.warn("[适配器] 未配置适配器,使用默认 SQLite");
      OidcAdapterFactory.configure({ type: "sqlite" });
    }
    await applicationRuntime?.recoverPendingDisables(
      (clientId) => OidcAdapterFactory.revokeByClientId(clientId),
      (clientId) => OidcAdapterFactory.allowClientId(clientId),
    );

    // 加载或生成 JWKS
    Logger.info("[JWKS] 正在加载密钥...");
    const jwksFilePath = config.jwks?.filePath || join(process.cwd(), "jwks.json");
    const jwksKeyId = config.jwks?.keyId || "default-key";
    const jwks = await getOrGenerateJWKS(jwksFilePath, jwksKeyId);
    Logger.info(`[JWKS] 密钥加载完成 (文件: ${jwksFilePath}, keyId: ${jwksKeyId})`);

    // 配置OIDC Provider
    const adapterFactory = OidcAdapterFactory.getAdapterFactory();
    const configuration: Configuration = {
      ...(adapterFactory ? { adapter: adapterFactory } : {}),
      // 使用持久化的 JWKS
      jwks,
      clients:
        resolveApplicationsConfig(config).clientSource === "config" ? (config.clients as any) : [],
      interactions: {
        url: async (ctx, interaction) => {
          return `/interaction/${interaction.uid}`;
        },
      },
      cookies: {
        keys: config.oidc.cookieKeys,
      },
      claims: config.oidc.claims,
      features: config.oidc.features,
      extraClientMetadata: {
        properties: ["require_pkce"],
        validator: (_ctx, key, value) => {
          if (key === "require_pkce" && value !== undefined && typeof value !== "boolean") {
            throw new TypeError("require_pkce Client metadata 必须是 boolean");
          }
        },
      },
      findAccount: async (ctx, sub, token) => {
        Logger.debug("[查找账户]", {
          sub,
          tokenType: token?.constructor?.name || "unknown",
          context: sanitizeForLog({
            method: (ctx as any)?.method,
            path: (ctx as any)?.path,
            query: (ctx as any)?.query,
            headers: (ctx as any)?.headers,
          }),
        });

        // 使用 AuthCoordinator 查找用户
        const user = await authCoordinator.findAccount(sub);

        if (!user) {
          Logger.info(`[账户查找结果] ${sub}: 未找到`);
          return undefined;
        }

        Logger.debug("[账户查找结果] 找到用户", summarizeUserForLog(user));

        return {
          accountId: user.sub,
          async claims(use: string, scope: string, claims: any, rejected: any) {
            Logger.debug(
              "[声明生成]",
              sanitizeForLog({
                user: summarizeUserForLog(user),
                scope,
                claims,
                rejected,
                use,
              }),
            );

            const userClaims = userToClaims(user);

            Logger.debug("[返回声明]", summarizeClaimsForLog(userClaims));
            return userClaims;
          },
        };
      },
      ttl: config.oidc.ttl,
      pkce: {
        required: (_ctx, client) =>
          client.clientAuthMethod === "none" || client.require_pkce === true,
      },
    };

    const oidc = new Provider(config.oidc.issuer, configuration);
    registerOidcAuditEvents(oidc, auditLogRepository, userRepository);

    if (providerApiService && tokenRepository) {
      const feishuProviderConfig = config.auth.providers.feishu?.config as any;
      const feishuApiConfig = config.providerApi.providers.feishu;
      if (
        feishuApiConfig?.enabled &&
        feishuProviderConfig?.appId &&
        feishuProviderConfig?.appSecret
      ) {
        providerApiService.registerClient(
          new FeishuProviderApiClient({
            config: feishuProviderConfig,
            tokenRepository,
            baseUrl: feishuApiConfig.baseUrl ?? "https://open.feishu.cn/open-apis",
            refreshSkewSeconds: config.providerApi.refreshSkewSeconds,
            requestTimeoutMs: config.providerApi.requestTimeoutMs,
            responseBodyLimitBytes: config.providerApi.responseBodyLimitBytes,
            allowedOperations: feishuApiConfig.allowedOperations,
            defaultAppOwnerId: feishuApiConfig.defaultAppOwnerId,
          }),
        );
        Logger.info("[Provider API] 已注册 FeishuProviderApiClient");
      }

      const dingtalkApiConfig = config.providerApi.providers.dingtalk;
      if (dingtalkApiConfig?.enabled) {
        providerApiService.registerClient(
          new DingTalkProviderApiClient({
            tokenRepository,
            baseUrl: dingtalkApiConfig.baseUrl ?? "https://api.dingtalk.com",
            refreshSkewSeconds: config.providerApi.refreshSkewSeconds,
            requestTimeoutMs: config.providerApi.requestTimeoutMs,
            responseBodyLimitBytes: config.providerApi.responseBodyLimitBytes,
            allowedOperations: dingtalkApiConfig.allowedOperations,
            defaultAppOwnerId: dingtalkApiConfig.defaultAppOwnerId,
          }),
        );
        Logger.info("[Provider API] 已注册 DingTalkProviderApiClient 骨架");
      }

      providerTokenProbeScheduler = new ProviderTokenProbeScheduler({
        providerApiService,
        tokenRepository,
        probeIntervalSeconds: config.providerApi.probeIntervalSeconds,
        refreshSkewSeconds: config.providerApi.refreshSkewSeconds,
      });
      runtimeResources.providerTokenProbeScheduler = providerTokenProbeScheduler;
      providerTokenProbeScheduler.start();
    }

    // 配置 oidc-provider 信任反向代理（基于 Koa 的 proxy 设置）
    // 在反向代理（Nginx/Traefik）后必须启用，才能正确识别 X-Forwarded-Proto 等头信息
    if (config.server.trustProxy) {
      oidc.proxy = true;
      Logger.info(
        "[代理配置] oidc-provider 已启用 proxy 模式，将信任反向代理传递的 X-Forwarded-* 头",
      );
    }

    // 将 OIDC Provider 实例传递给 AuthCoordinator
    authCoordinator.setOidcProvider(oidc);

    if (providerApiService) {
      registerProviderApiRoutes({
        app,
        oidcProvider: oidc,
        userRepository,
        providerApiService,
        sdkProxy: config.providerApi.sdkProxy,
        allowedClientIds: config.providerApi.allowedClientIds,
      });
    }

    registerAdminRoutes({
      app,
      config,
      oidcProvider: oidc,
      authCoordinator,
      userRepository,
      auditLogRepository,
      providerApiService,
      tokenRepository,
      stateStore,
      publicDir,
      oidcAccountLifecycle: {
        acquireBlock: (accountId) => OidcAdapterFactory.acquireAccountIdBlock(accountId),
        revoke: (accountId) => OidcAdapterFactory.revokeByAccountId(accountId),
        allow: (accountId) => OidcAdapterFactory.allowAccountId(accountId),
      },
      applicationService: applicationRuntime?.applicationService,
      oidcClientLifecycle: applicationRuntime
        ? {
            acquireBlock: (clientId) => OidcAdapterFactory.acquireClientIdBlock(clientId),
            revoke: (clientId) => OidcAdapterFactory.revokeByClientId(clientId),
            allow: (clientId) => OidcAdapterFactory.allowClientId(clientId),
          }
        : undefined,
    });

    const portalSessionStore = registerPortalRoutes({
      app,
      config,
      oidcProvider: oidc,
      userRepository,
      auditLogRepository,
      stateStore,
      publicDir,
      listPortalApplications: applicationRuntime
        ? () => applicationRuntime.applicationService.listPortalApplications()
        : () => listConfiguredPortalApplications(config),
    });
    runtimeResources.portalSessionStore = portalSessionStore ?? undefined;

    // 挂载OIDC到Fastify
    app.use("/oidc", oidc.callback());

    // 添加中间件打印所有OIDC请求
    app.addHook("preHandler", (request, reply, done) => {
      if (request.url.startsWith("/oidc")) {
        const pathname = new URL(request.url, "http://x-oidc.local").pathname;
        Logger.info(`[OIDC请求] ${request.method} ${pathname}`);
        if (request.query && Object.keys(request.query).length > 0) {
          Logger.debug("[查询参数]", sanitizeForLog(request.query));
        }
        if (request.body && Object.keys(request.body).length > 0) {
          Logger.debug("[请求体]", sanitizeForLog(request.body));
        }
      }
      done();
    });

    // 首页 - 项目介绍和GitHub链接
    app.get("/", async (request, reply) => {
      Logger.info("[首页] 用户访问首页");
      return reply.redirect(config.portal.enabled ? config.portal.basePath : "/index.html");
    });

    // 统一登录页面（使用认证插件系统）
    app.get("/interaction/:uid", async (request, reply) => {
      const { uid } = request.params as { uid: string };
      Logger.info(`[交互页面] 用户访问交互页面, UID: ${uid}`);

      try {
        const details = await oidc.interactionDetails(request.raw, reply.raw);
        if (details.uid !== uid) {
          return reply.code(400).send("Invalid or expired interaction");
        }

        Logger.debug(
          "[GET 交互详情]",
          sanitizeForLog({
            uid: details.uid,
            prompt: details.prompt?.name,
            params: details.params,
            hasGrantId: Boolean(details.grantId),
          }),
        );

        // 静态兼容 Client 保留旧行为；动态第三方应用必须经过显式 consent。
        if (details.prompt.name === "consent") {
          const clientId = String((details.params as Record<string, unknown>).client_id ?? "");
          const policy =
            await applicationRuntime?.clientProjector.findAuthorizationPolicyByClientId(clientId);
          const applicationsConfig = resolveApplicationsConfig(config);
          const isConfiguredClient =
            applicationsConfig.clientSource === "config" &&
            config.clients.some((client) => client.client_id === clientId);
          if (!policy && !isConfiguredClient) {
            return reply.code(400).send("Invalid or disabled client");
          }
          if (
            isConfiguredClient ||
            (policy?.trustLevel === "first_party" && policy.consentPolicy === "skip_for_trusted")
          ) {
            const grantId = await approveConsent(oidc, details);
            await oidc.interactionFinished(
              request.raw,
              reply.raw,
              { consent: { grantId } },
              { mergeWithLastSubmission: true },
            );
            Logger.info(`[自动授予完成] clientId=${clientId}`);
            return;
          }

          if (!policy) {
            return reply.code(400).send("Invalid or disabled client");
          }

          const grantDetails = readConsentGrantDisclosure(details.prompt.details);
          const requestedScopes = [
            ...new Set([...readRequestedScopes(details.params), ...grantDetails.oidcScopes]),
          ];
          setInteractionSecurityHeaders(reply);
          return reply.type("text/html; charset=utf-8").send(
            renderConsentPage({
              uid,
              applicationName: policy.applicationName,
              clientId,
              scopes: requestedScopes,
              claims: grantDetails.oidcClaims,
              resources: grantDetails.resourceScopes,
            }),
          );
        }

        // 如果是 login prompt，渲染登录页面
        const context: AuthContext = {
          interactionUid: uid,
          request,
          reply,
          params: request.params as Record<string, any>,
          body: {},
          query: request.query as Record<string, any>,
          interaction: details,
        };

        const loginResult = await authCoordinator.resolveUnifiedLogin(context);

        setInteractionSecurityHeaders(reply);
        if (loginResult.type === "redirect") {
          return reply.redirect(loginResult.redirectUrl);
        }
        return reply.type("text/html; charset=utf-8").send(loginResult.html);
      } catch (err) {
        Logger.error("[交互页面] 渲染失败:", sanitizeForLog(err));

        // 检查是否是会话相关的错误
        if (
          err instanceof Error &&
          (err.name === "SessionNotFound" ||
            err.message?.includes("interaction session id cookie not found"))
        ) {
          // 返回用户友好的错误页面
          return reply.redirect("/error-session-expired.html");
        }

        // 其他错误保持原样
        return reply.code(500).send("Internal Server Error");
      }
    });

    app.post("/interaction/:uid/consent", async (request, reply) => {
      const { uid } = request.params as { uid: string };
      setInteractionSecurityHeaders(reply);
      if (!isTrustedInteractionPost(request, config, uid)) {
        return reply.code(403).send("Forbidden");
      }

      try {
        const details = await oidc.interactionDetails(request.raw, reply.raw);
        if (details.uid !== uid || details.prompt.name !== "consent") {
          return reply.code(400).send("Invalid or expired interaction");
        }

        const body = request.body as { decision?: unknown };
        if (body.decision === "deny") {
          await oidc.interactionFinished(
            request.raw,
            reply.raw,
            { error: "access_denied", error_description: "用户拒绝授权" },
            { mergeWithLastSubmission: false },
          );
          return;
        }
        if (body.decision !== "approve") {
          return reply.code(400).send("Invalid consent decision");
        }

        const grantId = await approveConsent(oidc, details);
        await oidc.interactionFinished(
          request.raw,
          reply.raw,
          { consent: { grantId } },
          { mergeWithLastSubmission: true },
        );
      } catch (err) {
        Logger.error("[Consent] 处理失败:", sanitizeForLog(err));
        return reply.code(400).send("Invalid or expired interaction");
      }
    });

    // OAuth 回调完成路由（用于飞书等第三方登录）
    app.get("/interaction/:uid/complete", async (request, reply) => {
      const { uid } = request.params as { uid: string };
      Logger.info(`[OAuth 完成] UID: ${uid}`);

      try {
        const details = await oidc.interactionDetails(request.raw, reply.raw);
        if (details.uid !== uid || details.prompt.name !== "login") {
          return reply.code(400).send("Invalid or expired interaction");
        }

        // 从临时存储中获取认证结果
        const userId = await authCoordinator.getAuthResult(uid);

        if (!userId) {
          Logger.warn(`[OAuth 完成] 未找到认证结果: ${uid}`);
          return reply.redirect(buildInteractionErrorRedirect(uid, "认证会话已过期"));
        }

        Logger.info(`[OAuth 完成] 用户 ${userId} 认证通过，完成 login 交互`);

        // 完成 OIDC 交互
        await oidc.interactionFinished(
          request.raw,
          reply.raw,
          {
            login: { accountId: userId },
          },
          { mergeWithLastSubmission: false },
        );

        Logger.info(`[OAuth Login 完成] 用户 ${userId}`);
      } catch (err) {
        Logger.error("[OAuth 完成] 错误:", sanitizeForLog(err));
        return reply.redirect(buildInteractionErrorRedirect(uid, "登录失败"));
      }
    });

    // 登录处理（使用认证插件系统）
    app.post("/interaction/:uid/login", async (request, reply) => {
      const { uid } = request.params as { uid: string };
      const body = request.body as Record<string, any>;

      Logger.info(`[登录尝试] UID: ${uid}, 认证方式: ${body.authMethod}`);

      try {
        // 必须先由 oidc-provider 校验 interaction cookie 与 uid，再调用本地认证。
        // 否则任意 uid 都能触发密码比较并形成账户枚举接口。
        const details = await oidc.interactionDetails(request.raw, reply.raw);
        if (details.uid !== uid || details.prompt.name !== "login") {
          return reply.code(400).send("Invalid or expired interaction");
        }

        // 创建认证上下文
        const context: AuthContext = {
          interactionUid: uid,
          request,
          reply,
          authMethod: body.authMethod,
          params: request.params as Record<string, any>,
          body,
          query: request.query as Record<string, any>,
          interaction: details,
        };

        // 执行认证
        const result = await authCoordinator.handleAuthentication(context);

        if (result.success && result.userId) {
          Logger.info(`[登录成功] 用户 ${result.userId} 认证通过，完成 login 交互`);

          // 只完成 login，consent 会在后续的 GET 请求中自动处理
          await oidc.interactionFinished(
            request.raw,
            reply.raw,
            {
              login: { accountId: result.userId },
            },
            { mergeWithLastSubmission: false },
          );

          Logger.info(`[Login 完成] 用户 ${result.userId}`);
        } else {
          // 记录详细错误日志
          if (result.error) {
            Logger.warn(`[登录失败] ${formatAuthError(result.error)}`);
          } else {
            Logger.warn("[登录失败] 未知错误");
          }

          // 认证失败，重定向回登录页面并显示用户友好的错误消息
          const errorMessage = result.error ? getUserErrorMessage(result.error) : "认证失败";
          return reply.redirect(buildInteractionErrorRedirect(uid, errorMessage));
        }
      } catch (err) {
        Logger.error("[登录处理] 错误:", sanitizeForLog(err));
        return reply.redirect(buildInteractionErrorRedirect(uid, "系统错误，请稍后重试"));
      }
    });
  } catch (err) {
    Logger.error("服务器初始化失败:", sanitizeForLog(err));
    try {
      await app.close();
    } catch (cleanupErr) {
      Logger.error("[服务器] 启动失败后的资源清理失败:", sanitizeForLog(cleanupErr));
    } finally {
      releaseIdentityServerLease();
    }
    throw err;
  }

  return app;
}

function acquireIdentityServerLease(): () => void {
  if (activeIdentityServerLease) {
    throw new Error("当前进程已经存在一个 Identity Server 实例；OIDC Adapter 尚不支持同进程多实例");
  }

  const lease = Symbol("identity-server");
  activeIdentityServerLease = lease;
  return () => {
    if (activeIdentityServerLease === lease) {
      activeIdentityServerLease = undefined;
    }
  };
}

/**
 * 创建并监听 OIDC 服务器，保留旧版 `start(config)` 的公开契约。
 */
export async function start(
  customConfig?: XOidcConfig,
  options: IdentityServerOptions = {},
): Promise<FastifyInstance> {
  const config = await resolveRuntimeConfig(customConfig);
  const app = await createIdentityServerFromConfig(config, options);

  try {
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });
    Logger.info(`OIDC IdP server listening on ${config.server.url}`);
  } catch (err) {
    Logger.error("服务器监听失败:", sanitizeForLog(err));
    try {
      await app.close();
    } catch (cleanupErr) {
      Logger.error("[服务器] 监听失败后的资源清理失败:", sanitizeForLog(cleanupErr));
    }
    throw err;
  }

  return app;
}

async function resolveRuntimeConfig(customConfig?: XOidcConfig): Promise<ResolvedXOidcConfig> {
  return customConfig === undefined ? loadConfig() : validateRuntimeConfig(customConfig);
}

/**
 * 验证模块化启动时传入的运行时配置。
 *
 * `loadConfig()` 已经会验证配置文件；这里覆盖 `start(customConfig)` 路径，避免集成方
 * 直接传配置时绕过生产环境安全校验。
 */
export function validateRuntimeConfig(config: XOidcConfig): ResolvedXOidcConfig {
  const validation = validateConfig(config);
  printValidationResult(validation);

  if (!validation.valid) {
    throw new Error(`配置验证失败:\n${formatValidationErrors(validation.errors)}`);
  }

  return validation.config!;
}

function assertStrongProviderTokenKey(tokenEncryptionKey: string): void {
  const defaultKeys = new Set([
    "change-this-provider-token-key",
    "replace-with-a-long-random-secret",
    "replace-with-a-long-random-provider-token-key",
  ]);

  if (tokenEncryptionKey.length < 32 || defaultKeys.has(tokenEncryptionKey)) {
    throw new Error(
      "providerApi.tokenEncryptionKey must be a non-default value with at least 32 characters when Provider API is enabled",
    );
  }
}

function createStateStore(
  config: ResolvedXOidcConfig,
): StateStore & { destroy?: () => Promise<void> | void } {
  const stateStoreConfig = config.auth.stateStore ?? { type: "memory" as const };
  if (stateStoreConfig.type === "redis") {
    if (!stateStoreConfig.redis) {
      throw new Error("Redis stateStore requires redis configuration");
    }
    return new RedisStateStore(stateStoreConfig.redis);
  }

  return new MemoryStateStore({
    maxSize: 10000,
    cleanupIntervalMs: 30000,
  });
}

function toLogLevel(level: ResolvedXOidcConfig["logging"]["level"]): LogLevel {
  return {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
  }[level];
}

export function resolveCorsOrigin(corsOrigins?: string[]): false | string[] {
  return corsOrigins && corsOrigins.length > 0 ? corsOrigins : false;
}

export function isAdminPublicFilePath(filePath: string, publicDir?: string): boolean {
  const normalizedPath = filePath.split(path.sep).join("/");
  if (publicDir) {
    const normalizedAdminDir = join(publicDir, "admin").split(path.sep).join("/");
    return normalizedPath.startsWith(`${normalizedAdminDir}/`);
  }
  return normalizedPath.includes("/public/admin/");
}

export function isPortalPublicFilePath(filePath: string, publicDir?: string): boolean {
  const normalizedPath = filePath.split(path.sep).join("/");
  if (publicDir) {
    const normalizedPortalDir = join(publicDir, "portal").split(path.sep).join("/");
    return normalizedPath.startsWith(`${normalizedPortalDir}/`);
  }
  return normalizedPath.includes("/public/portal/");
}

export function setInteractionSecurityHeaders(target: HeaderTarget): void {
  setHeader(target, "Content-Security-Policy", INTERACTION_CONTENT_SECURITY_POLICY);
  setHeader(target, "X-Frame-Options", "DENY");
  setHeader(target, "X-Content-Type-Options", "nosniff");
  setHeader(target, "Referrer-Policy", "same-origin");
  setHeader(target, "Cache-Control", "no-store");
  setHeader(target, "Pragma", "no-cache");
}

async function approveConsent(oidc: Provider, details: any): Promise<string> {
  const clientId = details.params?.client_id;
  const accountId = details.session?.accountId;
  if (typeof clientId !== "string" || clientId === "" || typeof accountId !== "string") {
    throw new Error("Consent interaction 缺少 Client 或账号上下文");
  }

  let grant = details.grantId ? await oidc.Grant.find(details.grantId) : undefined;
  if (!grant) {
    grant = new oidc.Grant({ accountId, clientId });
  }

  const grantDetails = readConsentGrantDisclosure(details.prompt?.details);
  if (grantDetails.oidcScopes.length > 0) {
    grant.addOIDCScope(grantDetails.oidcScopes.join(" "));
  }

  if (grantDetails.oidcClaims.length > 0) {
    grant.addOIDCClaims(grantDetails.oidcClaims);
  }

  for (const { indicator, scopes } of grantDetails.resourceScopes) {
    grant.addResourceScope(indicator, scopes.join(" "));
  }

  return grant.save();
}

function readRequestedScopes(params: unknown): string[] {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return ["openid"];
  }
  const scope = (params as Record<string, unknown>).scope;
  if (typeof scope !== "string") {
    return ["openid"];
  }
  const scopes = [...new Set(scope.split(" ").filter(Boolean))];
  return scopes.length > 0 ? scopes : ["openid"];
}

function isTrustedInteractionPost(
  request: { headers: Record<string, unknown> },
  config: ResolvedXOidcConfig,
  uid: string,
): boolean {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")
  ) {
    return false;
  }

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
    return (
      url.origin === expectedOrigin && url.pathname === `/interaction/${encodeURIComponent(uid)}`
    );
  } catch {
    return false;
  }
}

function setHeader(target: HeaderTarget, name: string, value: string): void {
  if (target.header) {
    target.header(name, value);
    return;
  }

  target.setHeader?.(name, value);
}

function buildInteractionErrorRedirect(uid: string, errorMessage: string): string {
  return `/interaction/${encodeURIComponent(uid)}?error=${encodeURIComponent(errorMessage)}`;
}

export async function cleanupServerResources(
  resources: ServerRuntimeResources,
  options: ServerCleanupOptions = {},
): Promise<void> {
  const errors: unknown[] = [];
  const cleanupAdapters = options.cleanupAdapters ?? (() => OidcAdapterFactory.cleanup());

  const runCleanupStep = async (label: string, cleanup: () => Promise<void> | void) => {
    try {
      await cleanup();
    } catch (err) {
      errors.push(err);
      Logger.error(`[服务器] ${label} 清理失败:`, sanitizeForLog(err));
    }
  };

  await runCleanupStep("Provider token 探活调度器", () =>
    resources.providerTokenProbeScheduler?.stop(),
  );
  await runCleanupStep("认证系统", () => resources.authCoordinator?.destroy());
  await runCleanupStep("Provider token 仓储", () => resources.tokenRepository?.close?.());
  await runCleanupStep("用户门户会话", () => resources.portalSessionStore?.clear());
  await runCleanupStep("应用仓储", () => resources.applicationRuntime?.close());
  await runCleanupStep("审计日志仓储", () => resources.auditLogRepository?.close?.());
  await runCleanupStep("用户仓储", () => resources.userRepository?.close?.());
  await runCleanupStep("State store", () => resources.stateStore?.destroy?.());
  await runCleanupStep("OIDC 适配器", cleanupAdapters);

  if (options.closeApp !== false) {
    await runCleanupStep("Fastify", () => resources.app?.close());
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Server resource cleanup failed");
  }
}

export type { UserInfo } from "./types/auth.js";
export type { UserClaims, UserGroup } from "./types/user.js";
export { userToClaims } from "./utils/userClaims.js";
