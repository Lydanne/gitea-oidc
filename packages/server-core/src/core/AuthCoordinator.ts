/**
 * 认证协调器
 * 管理所有认证插件，协调认证流程
 */

import { createHash, randomBytes } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Provider } from "oidc-provider";
import { NoopAuditLogRepository } from "../repositories/NoopAuditLogRepository.js";
import type { AccountSecurity } from "../security/AccountSecurity.js";
import type {
  AuditLogInput,
  AuditLogRepository,
  AuthenticationAuditContext,
  AuthenticationAuditEvent,
} from "../types/audit.js";
import type {
  AuthContext,
  AuthProvider,
  AuthProviderConfig,
  AuthResult,
  IAuthCoordinator,
  LoginUIResult,
  OAuthStateData,
  PluginHookName,
  PluginMiddlewareContext,
  StateStore,
  UserInfo,
  UserRepository,
} from "../types/auth.js";
import { PluginPermission } from "../types/auth.js";
import { renderLoginPageHTML, sanitizeLoginUrl } from "../ui/loginPageRenderer.js";
import { AuthErrors } from "../utils/authErrors.js";
import { sanitizeForLog } from "../utils/logSanitizer.js";
import { PermissionChecker } from "./PermissionChecker.js";

export interface AuthenticationRevocations {
  captureLoginGeneration(): string | Promise<string>;
  assertLoginGeneration(generation: string): void | Promise<void>;
}

export interface PendingAuthentication {
  userId: string;
  authenticationGeneration?: string;
  userRecordId?: string;
}

export interface AuthCoordinatorConfig {
  accountSecurity?: AccountSecurity;
  authenticationRevocations?: AuthenticationRevocations;
  /** Fastify 实例 */
  app: FastifyInstance;

  /** State 存储 */
  stateStore: StateStore;

  /** 用户仓储 */
  userRepository: UserRepository;

  /** 结构化审计日志仓储 */
  auditLogRepository?: AuditLogRepository;

  /** 插件配置 */
  providersConfig: Record<string, AuthProviderConfig>;

  /** 仅有一个可跳转登录方式时由服务端直接进入。 */
  autoRedirectSingleProvider?: boolean;

  /** OIDC Provider 实例（可选，用于插件完成交互） */
  oidcProvider?: Provider;
}

type UnifiedLoginOption = { provider: AuthProvider; ui: LoginUIResult };

export type UnifiedLoginResult =
  | { type: "html"; html: string }
  | { type: "redirect"; redirectUrl: string };

export class AuthCoordinator implements IAuthCoordinator {
  private readonly accountSecurity?: AccountSecurity;
  private app: FastifyInstance;
  private stateStore: StateStore;
  private userRepository: UserRepository;
  private auditLogRepository: AuditLogRepository;
  private providersConfig: Record<string, AuthProviderConfig>;
  private autoRedirectSingleProvider: boolean;
  private providers = new Map<string, AuthProvider>();
  private permissionChecker = new PermissionChecker();
  private initialized = false;
  private oidcProvider?: Provider;
  private readonly authenticationRevocations?: AuthenticationRevocations;

  constructor(config: AuthCoordinatorConfig) {
    this.accountSecurity = config.accountSecurity;
    this.authenticationRevocations = config.authenticationRevocations;
    this.app = config.app;
    this.stateStore = config.stateStore;
    this.userRepository = config.userRepository;
    this.auditLogRepository = config.auditLogRepository ?? new NoopAuditLogRepository();
    this.providersConfig = config.providersConfig;
    this.autoRedirectSingleProvider = config.autoRedirectSingleProvider ?? false;
    this.oidcProvider = config.oidcProvider;
  }

  /**
   * 设置 OIDC Provider 实例
   * 在 OIDC Provider 创建后调用
   */
  setOidcProvider(provider: Provider): void {
    this.oidcProvider = provider;
  }

  /**
   * 注册认证插件
   */
  registerProvider(provider: AuthProvider): void {
    assertSafePluginName(provider.name);

    if (this.providers.has(provider.name)) {
      throw new Error(`Provider ${provider.name} already registered`);
    }

    // 获取插件元数据并注册权限
    const metadata = provider.getMetadata?.();
    if (metadata) {
      this.permissionChecker.registerPlugin(metadata.name, metadata.permissions);
      this.app.log.info(
        `Registered permissions for ${metadata.name}: ${metadata.permissions.join(", ")}`,
      );
    }

    // 先收集并验证全部声明，随后才向 Fastify 注册。这样一个后置的非法路径或
    // 缺失权限不会留下已经挂载的半套插件路由。
    const routes = provider.registerRoutes ? provider.registerRoutes() : undefined;
    const staticAssets = provider.registerStaticAssets
      ? provider.registerStaticAssets()
      : undefined;
    const webhooks = provider.registerWebhooks ? provider.registerWebhooks() : undefined;

    if (routes) {
      this.permissionChecker.requirePermission(provider.name, PluginPermission.REGISTER_ROUTES);
      for (const route of routes) {
        buildPluginChildPath(`/auth/${provider.name}`, route.path, "route");
        sanitizePluginRouteOptions(route.options);
      }
    }
    if (staticAssets) {
      this.permissionChecker.requirePermission(provider.name, PluginPermission.REGISTER_STATIC);
      for (const asset of staticAssets) {
        buildPluginChildPath(`/auth/${provider.name}`, asset.path, "static asset");
      }
    }
    if (webhooks) {
      this.permissionChecker.requirePermission(provider.name, PluginPermission.REGISTER_WEBHOOK);
      for (const webhook of webhooks) {
        buildPluginChildPath(`/auth/${provider.name}`, webhook.path, "webhook");
      }
    }
    if (provider.registerMiddleware) {
      this.permissionChecker.requirePermission(provider.name, PluginPermission.REGISTER_MIDDLEWARE);
    }

    // 注册插件路由（需要权限）
    if (routes) {
      this.registerProviderRoutes(provider, routes);
    }

    // 注册插件静态资源（需要权限）
    if (staticAssets) {
      this.registerProviderStaticAssets(provider, staticAssets);
    }

    // 注册插件 Webhook（需要权限）
    if (webhooks) {
      this.registerProviderWebhooks(provider, webhooks);
    }

    // 注册插件中间件（需要权限，受限）
    if (provider.registerMiddleware) {
      this.registerProviderMiddleware(provider);
    }

    this.providers.set(provider.name, provider);
    this.app.log.info(`Registered auth provider: ${provider.name}`);
  }

  /**
   * 注册插件路由
   */
  private registerProviderRoutes(provider: AuthProvider, routes: any[]): void {
    const basePath = `/auth/${provider.name}`;

    for (const route of routes) {
      const fullPath = buildPluginChildPath(basePath, route.path, "route");
      const routeOptions = sanitizePluginRouteOptions(route.options);

      this.app.route({
        ...routeOptions,
        method: route.method,
        url: fullPath,
        handler: route.handler,
        schema: route.options?.schema,
      });

      this.app.log.info(
        `Registered route: ${route.method} ${fullPath}` +
          (route.options?.description ? ` - ${route.options.description}` : ""),
      );
    }
  }

  /**
   * 注册插件静态资源
   */
  private registerProviderStaticAssets(provider: AuthProvider, assets: any[]): void {
    const basePath = `/auth/${provider.name}`;

    for (const asset of assets) {
      const fullPath = buildPluginChildPath(basePath, asset.path, "static asset");

      this.app.get(fullPath, async (request, reply) => {
        if (asset.contentType) {
          reply.type(asset.contentType);
        }

        // 添加缓存控制
        reply.header("Cache-Control", "public, max-age=3600");

        return asset.content;
      });

      this.app.log.info(`Registered static asset: ${fullPath}`);
    }
  }

  /**
   * 注册插件 Webhook
   */
  private registerProviderWebhooks(provider: AuthProvider, webhooks: any[]): void {
    const basePath = `/auth/${provider.name}`;

    for (const webhook of webhooks) {
      const fullPath = buildPluginChildPath(basePath, webhook.path, "webhook");

      this.app.post(fullPath, async (request, reply) => {
        // 验证签名（如果提供）
        if (webhook.verifySignature) {
          const isValid = await webhook.verifySignature(request);
          if (!isValid) {
            return reply.code(401).send({ error: "Invalid signature" });
          }
        }

        return webhook.handler(request, reply);
      });

      this.app.log.info(`Registered webhook: POST ${fullPath}`);
    }
  }

  /**
   * 注册插件中间件（受限）
   */
  private registerProviderMiddleware(provider: AuthProvider): void {
    if (!provider.registerMiddleware) {
      return;
    }

    const basePath = `/auth/${provider.name}`;

    // 创建受限上下文
    const context: PluginMiddlewareContext = {
      basePath,
      pluginName: provider.name,
      addHook: (hookName: PluginHookName, handler) => {
        // 只为插件路径注册钩子
        this.app.addHook(hookName, async (request: FastifyRequest, reply: FastifyReply) => {
          // 只在请求匹配插件路径时执行
          if (isPluginRequestPath(request.url, basePath)) {
            await handler(request, reply);
          }
        });
      },
    };

    provider.registerMiddleware(context).catch((err: unknown) => {
      this.app.log.error(
        { err: sanitizeForLog(err), provider: provider.name },
        "Failed to register middleware",
      );
    });

    this.app.log.info(`Registered middleware for provider: ${provider.name}`);
  }

  /**
   * 获取所有已启用的插件
   */
  getProviders(): AuthProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 根据名称获取插件
   */
  getProvider(name: string): AuthProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 解析统一登录入口；运行时路由使用此结果决定直接跳转或渲染页面。
   */
  async resolveUnifiedLogin(context: AuthContext): Promise<UnifiedLoginResult> {
    const loginOptions = await this.collectLoginOptions(context);
    if (this.autoRedirectSingleProvider) {
      const redirectUrl = findSingleRedirectLoginUrl(loginOptions);
      if (redirectUrl) {
        return { type: "redirect", redirectUrl };
      }
    }

    return { type: "html", html: this.generateLoginPageHTML(context, loginOptions) };
  }

  /**
   * 渲染统一登录页面；只返回 HTML，不发送服务端重定向。
   */
  async renderUnifiedLoginPage(context: AuthContext): Promise<string> {
    const loginOptions = await this.collectLoginOptions(context);
    return this.generateLoginPageHTML(context, loginOptions);
  }

  private async collectLoginOptions(context: AuthContext): Promise<UnifiedLoginOption[]> {
    const providers = this.getProviders();
    const loginOptions: UnifiedLoginOption[] = [];

    // 收集所有插件的登录 UI
    for (const provider of providers) {
      try {
        const ui = await provider.renderLoginUI(context);
        loginOptions.push({ provider, ui });
      } catch (err) {
        this.app.log.error(
          { err: sanitizeForLog(err), provider: provider.name },
          "Failed to render login UI",
        );
      }
    }

    // 按优先级排序
    loginOptions.sort((a, b) => {
      const priorityA = this.providersConfig[a.provider.name]?.priority || 999;
      const priorityB = this.providersConfig[b.provider.name]?.priority || 999;
      return priorityA - priorityB;
    });

    return loginOptions;
  }

  /**
   * 生成登录页面 HTML
   */
  private generateLoginPageHTML(context: AuthContext, loginOptions: UnifiedLoginOption[]): string {
    return renderLoginPageHTML(context, loginOptions);
  }

  /**
   * 处理认证请求
   */
  async handleAuthentication(context: AuthContext): Promise<AuthResult> {
    const { authMethod } = context;

    if (!authMethod) {
      return {
        success: false,
        error: AuthErrors.missingParameter(["authMethod"]),
      };
    }

    const provider = this.providers.get(authMethod);

    if (!provider) {
      return {
        success: false,
        error: AuthErrors.providerNotFound(authMethod),
      };
    }

    if (authMethod === LOCAL_AUTH_PROVIDER) {
      try {
        if (await this.isLocalAuthenticationRateLimited(context)) {
          return {
            success: false,
            error: AuthErrors.invalidCredentials({ rateLimited: true }),
          };
        }
      } catch (err) {
        this.app.log.error(
          { err: sanitizeForLog(err) },
          "Failed to enforce local authentication rate limit",
        );
        return {
          success: false,
          error: AuthErrors.internalError(err instanceof Error ? err : undefined),
        };
      }

      const invalidInput = validateLocalAuthenticationInput(context);
      if (invalidInput) {
        return invalidInput;
      }
    }

    try {
      // 检查插件是否可以处理该请求
      if (!provider.canHandle(context)) {
        return {
          success: false,
          error: AuthErrors.providerDisabled(authMethod),
        };
      }

      // 凭据验证之前捕获代际，账号管理操作不能让在途认证重新生效。
      const generation = await this.captureAuthenticationGeneration();
      const result = await provider.authenticate(context);
      if (result.success) {
        await this.assertAuthenticationGeneration(generation, result.userId);
        result.metadata = { ...result.metadata, authenticationGeneration: generation };
      }

      // Provider 这里只确认凭据；OIDC 登录成功由 authorization.success 统一记录。
      if (result.success && result.userId) {
        this.app.log.info(`User ${result.userId} authenticated successfully via ${authMethod}`);
      } else if (
        result.metadata?.passwordChangeRequired !== true &&
        result.metadata?.passwordChanged !== true
      ) {
        const attemptedUsername = readAttemptedUsername(context);
        const subject = await this.resolveFailedAuthenticationSubject(
          authMethod,
          attemptedUsername,
        );
        await this.recordLoginAudit({
          context,
          provider: authMethod,
          outcome: "failure",
          userId: subject?.sub,
          username: subject?.username ?? attemptedUsername,
          reason: result.error?.code,
        });
      }

      return result;
    } catch (err) {
      this.app.log.error(
        { err: sanitizeForLog(err), provider: authMethod },
        "Authentication error",
      );

      const attemptedUsername = readAttemptedUsername(context);
      const subject = await this.resolveFailedAuthenticationSubject(authMethod, attemptedUsername);
      await this.recordLoginAudit({
        context,
        provider: authMethod,
        outcome: "failure",
        userId: subject?.sub,
        username: subject?.username ?? attemptedUsername,
        reason: "internal_error",
      });

      return {
        success: false,
        error: AuthErrors.internalError(err instanceof Error ? err : undefined, {
          provider: authMethod,
        }),
      };
    }
  }

  /**
   * 查找用户账户（供 OIDC Provider 调用）
   */
  async findAccount(userId: string): Promise<UserInfo | null> {
    try {
      const user = await this.userRepository.findById(userId);
      if (user?.status && user.status !== "active") {
        this.app.log.warn(`User ${userId} is not active: ${user.status}`);
        return null;
      }
      if (user && (await this.accountSecurity?.requiresPasswordChange(user))) return null;
      return user;
    } catch (err) {
      this.app.log.error({ err: sanitizeForLog(err), userId }, "Failed to find account");
      return null;
    }
  }

  /**
   * 生成并存储 OAuth state
   */
  async generateOAuthState(
    interactionUid: string,
    provider: string,
    metadata?: Record<string, any>,
  ): Promise<string> {
    // 生成随机 state（32 字节 = 64 个十六进制字符）
    const state = randomBytes(32).toString("hex");

    const data: OAuthStateData = {
      interactionUid,
      provider,
      authenticationGeneration: await this.captureAuthenticationGeneration(),
      createdAt: Date.now(),
      metadata,
    };

    // 存储 state，10 分钟过期
    await this.stateStore.set(state, data, 600);

    this.app.log.info(
      `[OAuth State] Generated for ${provider}: ${state.substring(0, 8)}..., interactionUid: ${interactionUid}`,
    );

    return state;
  }

  /**
   * 验证并消费 OAuth state
   */
  async verifyOAuthState(state: string): Promise<OAuthStateData | null> {
    try {
      this.app.log.info(`[OAuth State] Verifying state: ${state.substring(0, 8)}...`);

      // 原子读取并消费 state，避免并发 callback 重放同一个 OAuth state。
      const data = await this.stateStore.take(state);

      if (!data) {
        this.app.log.warn(`[OAuth State] Invalid or expired state: ${state.substring(0, 8)}...`);
        return null;
      }

      this.app.log.info(
        `[OAuth State] Found state data: provider=${data.provider}, interactionUid=${data.interactionUid}, age=${Date.now() - data.createdAt}ms`,
      );

      // 验证 state 未过期（额外检查）
      const age = Date.now() - data.createdAt;
      if (age > 600000) {
        // 10 分钟
        this.app.log.warn(`[OAuth State] Expired state: ${state.substring(0, 8)}..., age=${age}ms`);
        return null;
      }

      await this.assertAuthenticationGeneration(data.authenticationGeneration);

      this.app.log.info(`[OAuth State] Verified and consumed state for ${data.provider}`);

      return data;
    } catch (err) {
      this.app.log.error({ err: sanitizeForLog(err) }, "Failed to verify OAuth state");
      return null;
    }
  }

  /**
   * 存储认证结果（用于 OAuth 回调后的重定向）
   */
  async storeAuthResult(
    interactionUid: string,
    userId: string,
    _auditContext?: AuthenticationAuditContext,
    authenticationGeneration?: string,
  ): Promise<void> {
    await this.assertAuthenticationGeneration(authenticationGeneration, userId);
    const user = this.authenticationRevocations ? await this.findAccount(userId) : undefined;
    if (this.authenticationRevocations && !user) throw new Error("Authentication expired");
    await this.assertAuthenticationGeneration(authenticationGeneration, userId);
    const authResult = {
      authenticationGeneration,
      userRecordId: user?.id,
      userId,
      timestamp: Date.now(),
      type: "auth_result", // 标记为认证结果
    };

    await this.stateStore.set(`auth_result_${interactionUid}`, authResult, 300); // 5分钟过期

    await this.assertAuthenticationGeneration(authenticationGeneration, userId);

    this.app.log.info(`Stored auth result for interaction: ${interactionUid}, user: ${userId}`);
  }

  async recordAuthenticationEvent(event: AuthenticationAuditEvent): Promise<void> {
    await this.appendAuditSafely({
      eventType: "user.login",
      source: "provider",
      ...event,
    });
  }

  async captureAuthenticationGeneration(): Promise<string | undefined> {
    const login = await this.authenticationRevocations?.captureLoginGeneration();
    if (!this.accountSecurity) return login;
    return JSON.stringify({
      login,
      security: await this.accountSecurity.captureAuthenticationVersion(),
    });
  }

  async assertAuthenticationGeneration(generation: unknown, userId?: string): Promise<void> {
    let login = generation;
    if (this.accountSecurity) {
      if (typeof generation !== "string") throw new Error("Authentication expired");
      const snapshot = JSON.parse(generation);
      if (!snapshot || typeof snapshot !== "object") throw new Error("Authentication expired");
      await this.accountSecurity.assertAuthenticationVersion(snapshot.security, userId);
      login = snapshot.login;
    }
    if (!this.authenticationRevocations) return;
    if (typeof login !== "string") throw new Error("Authentication expired");
    await this.authenticationRevocations.assertLoginGeneration(login);
  }

  async createInteractionAuthentication(generation: unknown, userId: string) {
    await this.assertAuthenticationGeneration(generation, userId);
    const user = this.authenticationRevocations ? await this.findAccount(userId) : undefined;
    if (this.authenticationRevocations && !user) throw new Error("Authentication expired");
    await this.assertAuthenticationGeneration(generation, userId);
    return { generation, userId, recordId: user?.id };
  }

  async validateInteractionAuthentication(proof: unknown, accountId: string): Promise<void> {
    if (!this.authenticationRevocations) return;
    if (!proof || typeof proof !== "object") throw new Error("Authentication expired");
    const value = proof as Record<string, unknown>;
    await this.assertAuthenticationGeneration(value.generation, accountId);
    const user = await this.findAccount(accountId);
    if (!user || value.userId !== accountId || value.recordId !== user.id) {
      throw new Error("Authentication expired");
    }
    await this.assertAuthenticationGeneration(value.generation, accountId);
  }

  async consumeAuthResult(interactionUid: string): Promise<PendingAuthentication | null> {
    const result = await this.stateStore.take(`auth_result_${interactionUid}`);
    if (
      !result ||
      result.type !== "auth_result" ||
      typeof result.userId !== "string" ||
      typeof result.timestamp !== "number" ||
      Date.now() - result.timestamp > 300000
    ) {
      return null;
    }
    try {
      await this.validateInteractionAuthentication(
        {
          generation: result.authenticationGeneration,
          userId: result.userId,
          recordId: result.userRecordId,
        },
        result.userId,
      );
      return result;
    } catch {
      return null;
    }
  }

  async getAuthResult(interactionUid: string): Promise<string | null> {
    return (await this.consumeAuthResult(interactionUid))?.userId ?? null;
  }

  /**
   * 完成 OIDC 交互
   * 供插件调用，用于完成用户认证后的 OIDC 交互流程
   */
  async finishOidcInteraction(
    request: FastifyRequest,
    reply: FastifyReply,
    interactionUid: string,
    userId: string,
    authenticationGeneration?: string,
  ): Promise<void> {
    if (!this.oidcProvider) {
      throw new Error("OIDC Provider not initialized");
    }

    try {
      const proof = await this.createInteractionAuthentication(authenticationGeneration, userId);
      await this.oidcProvider.interactionFinished(
        request.raw,
        reply.raw,
        {
          login: {
            accountId: userId,
          },
          x_oidc_authentication: proof,
        },
        { mergeWithLastSubmission: false },
      );

      this.app.log.info(`OIDC interaction finished for user: ${userId}, uid: ${interactionUid}`);
    } catch (err) {
      this.app.log.error(
        { err: sanitizeForLog(err), userId, interactionUid },
        "Failed to finish OIDC interaction",
      );
      throw err;
    }
  }

  /**
   * 初始化所有插件
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error("AuthCoordinator already initialized");
    }

    this.app.log.info("Initializing auth providers...");

    for (const [name, provider] of this.providers.entries()) {
      const config = this.providersConfig[name];

      if (!config || !config.enabled) {
        this.app.log.info(`Skipping disabled provider: ${name}`);
        continue;
      }

      try {
        await provider.initialize(config);
        this.app.log.info(`Initialized provider: ${name}`);
      } catch (err) {
        this.app.log.error(
          { err: sanitizeForLog(err), provider: name },
          "Failed to initialize provider",
        );
        throw err;
      }
    }

    this.initialized = true;
    this.app.log.info("All auth providers initialized successfully");
  }

  /**
   * 销毁所有插件
   */
  async destroy(): Promise<void> {
    this.app.log.info("Destroying auth providers...");

    for (const [name, provider] of this.providers.entries()) {
      if (provider.destroy) {
        try {
          await provider.destroy();
          this.app.log.info(`Destroyed provider: ${name}`);
        } catch (err) {
          this.app.log.error(
            { err: sanitizeForLog(err), provider: name },
            "Failed to destroy provider",
          );
        }
      }
    }

    this.providers.clear();
    this.initialized = false;
  }

  private async resolveFailedAuthenticationSubject(
    provider: string,
    attemptedUsername?: string,
  ): Promise<UserInfo | null> {
    if (!attemptedUsername) return null;
    try {
      return await this.userRepository.findByProviderAndExternalId(provider, attemptedUsername);
    } catch (err) {
      this.app.log.warn(
        { err: sanitizeForLog(err), provider },
        "Failed to resolve authentication audit subject",
      );
      return null;
    }
  }

  private async isLocalAuthenticationRateLimited(context: AuthContext): Promise<boolean> {
    const source = typeof context.request.ip === "string" ? context.request.ip : "unknown";
    const dimensions = [
      {
        key: buildLocalLoginRateLimitKey("source", source),
        maximum: LOCAL_LOGIN_SOURCE_MAX_ATTEMPTS,
        dimension: "source",
      },
      {
        key: buildLocalLoginRateLimitKey("interaction", context.interactionUid),
        maximum: LOCAL_LOGIN_INTERACTION_MAX_ATTEMPTS,
        dimension: "interaction",
      },
    ] as const;

    for (const { key, maximum, dimension } of dimensions) {
      const attempts = await this.stateStore.increment(key, LOCAL_LOGIN_RATE_LIMIT_TTL_SECONDS);
      if (attempts > maximum) {
        if (attempts === maximum + 1) {
          this.app.log.warn({ dimension, maximum }, "Local authentication rate limit exceeded");
        }
        return true;
      }
    }

    return false;
  }

  private async recordLoginAudit(input: {
    context: AuthContext;
    provider: string;
    outcome: "failure";
    userId?: string;
    username?: string;
    reason?: string;
  }): Promise<void> {
    await this.recordAuthenticationEvent({
      outcome: input.outcome,
      userId: input.userId,
      username: input.username,
      provider: input.provider,
      clientId: readInteractionClientId(input.context.interaction),
      ipAddress: input.context.request.ip,
      userAgent: readHeader(input.context.request.headers["user-agent"]),
      reason: input.reason,
    });
  }

  private async appendAuditSafely(input: AuditLogInput): Promise<void> {
    try {
      await this.auditLogRepository.append(input);
    } catch (error) {
      this.app.log.error({ err: sanitizeForLog(error) }, "Failed to persist audit log");
    }
  }
}

function findSingleRedirectLoginUrl(loginOptions: UnifiedLoginOption[]): string | null {
  let availableOptionCount = 0;
  let redirectUrl: string | null = null;

  for (const { ui } of loginOptions) {
    if (ui.showInUnifiedPage === false) {
      continue;
    }

    if (ui.type === "html" && ui.html) {
      availableOptionCount += 1;
      redirectUrl = null;
    } else if (ui.type === "redirect" && ui.button && ui.redirectUrl) {
      const safeUrl = sanitizeLoginUrl(ui.redirectUrl);
      if (safeUrl) {
        availableOptionCount += 1;
        redirectUrl = safeUrl;
      }
    }

    if (availableOptionCount > 1) {
      return null;
    }
  }

  return availableOptionCount === 1 ? redirectUrl : null;
}

function readAttemptedUsername(context: AuthContext): string | undefined {
  return typeof context.body.username === "string" ? context.body.username : undefined;
}

function validateLocalAuthenticationInput(context: AuthContext): AuthResult | null {
  const { username, password } = context.body;
  const missingParameters: string[] = [];
  if (typeof username !== "string" || username.length === 0) {
    missingParameters.push("username");
  }
  if (typeof password !== "string" || password.length === 0) {
    missingParameters.push("password");
  }
  if (missingParameters.length > 0) {
    return { success: false, error: AuthErrors.missingParameter(missingParameters) };
  }

  if (
    Buffer.byteLength(username, "utf8") > LOCAL_LOGIN_USERNAME_MAX_BYTES ||
    Buffer.byteLength(password, "utf8") > LOCAL_LOGIN_PASSWORD_MAX_BYTES
  ) {
    return { success: false, error: AuthErrors.invalidCredentials() };
  }

  return null;
}

function buildLocalLoginRateLimitKey(dimension: "source" | "interaction", value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return `local-login-rate-limit:${dimension}:${digest}`;
}

function readInteractionClientId(interaction: unknown): string | undefined {
  if (!interaction || typeof interaction !== "object") return undefined;
  const params = (interaction as { params?: unknown }).params;
  if (!params || typeof params !== "object") return undefined;
  const clientId = (params as Record<string, unknown>).client_id;
  return typeof clientId === "string" ? clientId : undefined;
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function assertSafePluginName(name: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid auth provider name: ${name}`);
  }
}

function buildPluginChildPath(basePath: string, path: string, kind: string): string {
  if (!isSafePluginChildPath(path)) {
    throw new Error(`Invalid plugin ${kind} path: ${path}`);
  }
  return `${basePath}${path}`;
}

function sanitizePluginRouteOptions(options: Record<string, any> | undefined): Record<string, any> {
  if (!options) {
    return {};
  }

  const { handler: _handler, method: _method, path: _path, url: _url, ...safeOptions } = options;
  return safeOptions;
}

function isSafePluginChildPath(path: string): boolean {
  if (!path.startsWith("/") || path.includes("//") || /[?#%\\]/.test(path)) {
    return false;
  }
  if (!/^\/[A-Za-z0-9._~:/-]*$/.test(path)) {
    return false;
  }

  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .every((segment) => segment !== "." && segment !== "..");
}

function isPluginRequestPath(requestUrl: string, basePath: string): boolean {
  try {
    const pathname = new URL(requestUrl, "http://plugin.local").pathname;
    return pathname === basePath || pathname.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

const LOCAL_AUTH_PROVIDER = "local";
const LOCAL_LOGIN_USERNAME_MAX_BYTES = 128;
const LOCAL_LOGIN_PASSWORD_MAX_BYTES = 1024;
const LOCAL_LOGIN_RATE_LIMIT_TTL_SECONDS = 60;
const LOCAL_LOGIN_SOURCE_MAX_ATTEMPTS = 120;
const LOCAL_LOGIN_INTERACTION_MAX_ATTEMPTS = 10;
