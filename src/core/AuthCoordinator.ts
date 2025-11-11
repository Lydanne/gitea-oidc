/**
 * 认证协调器
 * 管理所有认证插件，协调认证流程
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import type { Provider } from 'oidc-provider';
import type {
  IAuthCoordinator,
  AuthProvider,
  AuthContext,
  AuthResult,
  UserInfo,
  StateStore,
  UserRepository,
  OAuthStateData,
  PluginMiddlewareContext,
  PluginHookName,
  AuthProviderConfig,
} from '../types/auth';
import { PluginPermission } from '../types/auth';
import { AuthErrors } from '../utils/authErrors';
import { PermissionChecker } from './PermissionChecker';

export interface AuthCoordinatorConfig {
  /** Fastify 实例 */
  app: FastifyInstance;
  
  /** State 存储 */
  stateStore: StateStore;
  
  /** 用户仓储 */
  userRepository: UserRepository;
  
  /** 插件配置 */
  providersConfig: Record<string, AuthProviderConfig>;
  
  /** OIDC Provider 实例（可选，用于插件完成交互） */
  oidcProvider?: Provider;
}

export class AuthCoordinator implements IAuthCoordinator {
  private app: FastifyInstance;
  private stateStore: StateStore;
  private userRepository: UserRepository;
  private providersConfig: Record<string, AuthProviderConfig>;
  private providers = new Map<string, AuthProvider>();
  private permissionChecker = new PermissionChecker();
  private initialized = false;
  private oidcProvider?: Provider;

  constructor(config: AuthCoordinatorConfig) {
    this.app = config.app;
    this.stateStore = config.stateStore;
    this.userRepository = config.userRepository;
    this.providersConfig = config.providersConfig;
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
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider ${provider.name} already registered`);
    }

    // 获取插件元数据并注册权限
    const metadata = provider.getMetadata?.();
    if (metadata) {
      this.permissionChecker.registerPlugin(metadata.name, metadata.permissions);
      this.app.log.info(
        `Registered permissions for ${metadata.name}: ${metadata.permissions.join(', ')}`
      );
    }

    this.providers.set(provider.name, provider);
    this.app.log.info(`Registered auth provider: ${provider.name}`);

    // 注册插件路由（需要权限）
    if (provider.registerRoutes) {
      this.permissionChecker.requirePermission(
        provider.name,
        PluginPermission.REGISTER_ROUTES
      );
      this.registerProviderRoutes(provider);
    }

    // 注册插件静态资源（需要权限）
    if (provider.registerStaticAssets) {
      this.permissionChecker.requirePermission(
        provider.name,
        PluginPermission.REGISTER_STATIC
      );
      this.registerProviderStaticAssets(provider);
    }

    // 注册插件 Webhook（需要权限）
    if (provider.registerWebhooks) {
      this.permissionChecker.requirePermission(
        provider.name,
        PluginPermission.REGISTER_WEBHOOK
      );
      this.registerProviderWebhooks(provider);
    }

    // 注册插件中间件（需要权限，受限）
    if (provider.registerMiddleware) {
      this.permissionChecker.requirePermission(
        provider.name,
        PluginPermission.REGISTER_MIDDLEWARE
      );
      this.registerProviderMiddleware(provider);
    }
  }

  /**
   * 注册插件路由
   */
  private registerProviderRoutes(provider: AuthProvider): void {
    if (!provider.registerRoutes) {
      return;
    }

    const routes = provider.registerRoutes();
    const basePath = `/auth/${provider.name}`;

    for (const route of routes) {
      const fullPath = `${basePath}${route.path}`;
      
      this.app.route({
        method: route.method,
        url: fullPath,
        handler: route.handler,
        schema: route.options?.schema,
        ...route.options,
      });

      this.app.log.info(
        `Registered route: ${route.method} ${fullPath}` +
        (route.options?.description ? ` - ${route.options.description}` : '')
      );
    }
  }

  /**
   * 注册插件静态资源
   */
  private registerProviderStaticAssets(provider: AuthProvider): void {
    if (!provider.registerStaticAssets) {
      return;
    }

    const assets = provider.registerStaticAssets();
    const basePath = `/auth/${provider.name}`;

    for (const asset of assets) {
      const fullPath = `${basePath}${asset.path}`;
      
      this.app.get(fullPath, async (request, reply) => {
        if (asset.contentType) {
          reply.type(asset.contentType);
        }
        
        // 添加缓存控制
        reply.header('Cache-Control', 'public, max-age=3600');
        
        return asset.content;
      });

      this.app.log.info(`Registered static asset: ${fullPath}`);
    }
  }

  /**
   * 注册插件 Webhook
   */
  private registerProviderWebhooks(provider: AuthProvider): void {
    if (!provider.registerWebhooks) {
      return;
    }

    const webhooks = provider.registerWebhooks();
    const basePath = `/auth/${provider.name}`;

    for (const webhook of webhooks) {
      const fullPath = `${basePath}${webhook.path}`;
      
      this.app.post(fullPath, async (request, reply) => {
        // 验证签名（如果提供）
        if (webhook.verifySignature) {
          const isValid = await webhook.verifySignature(request);
          if (!isValid) {
            return reply.code(401).send({ error: 'Invalid signature' });
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
          if (request.url.startsWith(basePath)) {
            await handler(request, reply);
          }
        });
      },
    };

    provider.registerMiddleware(context).catch((err: unknown) => {
      this.app.log.error({ err, provider: provider.name }, 'Failed to register middleware');
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
   * 渲染统一登录页面
   */
  async renderUnifiedLoginPage(context: AuthContext): Promise<string> {
    const providers = this.getProviders();
    const loginOptions: Array<{ provider: AuthProvider; ui: any }> = [];

    // 收集所有插件的登录 UI
    for (const provider of providers) {
      try {
        const ui = await provider.renderLoginUI(context);
        loginOptions.push({ provider, ui });
      } catch (err) {
        this.app.log.error({ err, provider: provider.name }, 'Failed to render login UI');
      }
    }

    // 按优先级排序
    loginOptions.sort((a, b) => {
      const priorityA = this.providersConfig[a.provider.name]?.priority || 999;
      const priorityB = this.providersConfig[b.provider.name]?.priority || 999;
      return priorityA - priorityB;
    });

    // 生成 HTML
    return this.generateLoginPageHTML(context, loginOptions);
  }

  /**
   * 生成登录页面 HTML
   */
  private generateLoginPageHTML(
    context: AuthContext,
    loginOptions: Array<{ provider: AuthProvider; ui: any }>
  ): string {
    const forms: string[] = [];
    const buttons: string[] = [];

    for (const { provider, ui } of loginOptions) {
      if (ui.type === 'html') {
        forms.push(ui.html);
      } else if (ui.type === 'redirect' && ui.button) {
        buttons.push(`
          <a href="${ui.redirectUrl}" class="oauth-button" style="${ui.button.style || ''}">
            ${ui.button.icon ? `<img src="${ui.button.icon}" alt="${provider.displayName}" />` : ''}
            <span>${ui.button.text}</span>
          </a>
        `);
      }
    }

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - Gitea OIDC</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .login-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      max-width: 400px;
      width: 100%;
      padding: 40px;
    }
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo h1 {
      font-size: 28px;
      color: #333;
      margin-bottom: 8px;
    }
    .logo p {
      color: #666;
      font-size: 14px;
    }
    .login-form {
      margin-bottom: 20px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      color: #333;
      font-size: 14px;
      font-weight: 500;
    }
    .form-group input {
      width: 100%;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      transition: border-color 0.3s;
    }
    .form-group input:focus {
      outline: none;
      border-color: #667eea;
    }
    .submit-button {
      width: 100%;
      padding: 12px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.3s;
    }
    .submit-button:hover {
      background: #5568d3;
    }
    .divider {
      text-align: center;
      margin: 24px 0;
      position: relative;
    }
    .divider::before {
      content: "";
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background: #ddd;
    }
    .divider span {
      background: white;
      padding: 0 16px;
      color: #999;
      font-size: 14px;
      position: relative;
    }
    .oauth-buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .oauth-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      text-decoration: none;
      color: #333;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.3s;
    }
    .oauth-button:hover {
      border-color: #667eea;
      background: #f8f9ff;
    }
    .oauth-button img {
      width: 20px;
      height: 20px;
    }
    .error {
      background: #fee;
      border: 1px solid #fcc;
      color: #c33;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo">
      <h1>🔐 Gitea OIDC</h1>
      <p>统一身份认证平台</p>
    </div>
    
    ${forms.join('\n')}
    
    ${forms.length > 0 && buttons.length > 0 ? '<div class="divider"><span>或</span></div>' : ''}
    
    ${buttons.length > 0 ? `
      <div class="oauth-buttons">
        ${buttons.join('\n')}
      </div>
    ` : ''}
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * 处理认证请求
   */
  async handleAuthentication(context: AuthContext): Promise<AuthResult> {
    const { authMethod } = context;

    if (!authMethod) {
      return {
        success: false,
        error: AuthErrors.missingParameter(['authMethod']),
      };
    }

    const provider = this.providers.get(authMethod);

    if (!provider) {
      return {
        success: false,
        error: AuthErrors.providerNotFound(authMethod),
      };
    }

    try {
      // 检查插件是否可以处理该请求
      if (!provider.canHandle(context)) {
        return {
          success: false,
          error: AuthErrors.providerDisabled(authMethod),
        };
      }

      // 执行认证
      const result = await provider.authenticate(context);

      // 如果认证成功，记录日志
      if (result.success && result.userId) {
        this.app.log.info(
          `User ${result.userId} authenticated successfully via ${authMethod}`
        );
      }

      return result;
    } catch (err) {
      this.app.log.error({ err, provider: authMethod }, 'Authentication error');
      
      return {
        success: false,
        error: AuthErrors.internalError(
          err instanceof Error ? err : undefined,
          { provider: authMethod }
        ),
      };
    }
  }

  /**
   * 查找用户账户（供 OIDC Provider 调用）
   */
  async findAccount(userId: string): Promise<UserInfo | null> {
    try {
      return await this.userRepository.findById(userId);
    } catch (err) {
      this.app.log.error({ err, userId }, 'Failed to find account');
      return null;
    }
  }

  /**
   * 生成并存储 OAuth state
   */
  async generateOAuthState(
    interactionUid: string,
    provider: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    // 生成随机 state（32 字节 = 64 个十六进制字符）
    const state = randomBytes(32).toString('hex');
    
    const data: OAuthStateData = {
      interactionUid,
      provider,
      createdAt: Date.now(),
      metadata,
    };

    // 存储 state，10 分钟过期
    await this.stateStore.set(state, data, 600);

    this.app.log.info(`[OAuth State] Generated for ${provider}: ${state.substring(0, 8)}..., interactionUid: ${interactionUid}`);

    return state;
  }

  /**
   * 验证并消费 OAuth state
   */
  async verifyOAuthState(state: string): Promise<OAuthStateData | null> {
    try {
      this.app.log.info(`[OAuth State] Verifying state: ${state.substring(0, 8)}...`);
      
      // 列出所有存储的 state（调试用）
      if ('listAll' in this.stateStore && typeof (this.stateStore as any).listAll === 'function') {
        const allStates = (this.stateStore as any).listAll();
        this.app.log.info(`[OAuth State] Current stored states: ${JSON.stringify(allStates)}`);
      }
      
      // 获取 state 数据
      const data = await this.stateStore.get(state);
      
      if (!data) {
        this.app.log.warn(`[OAuth State] Invalid or expired state: ${state.substring(0, 8)}...`);
        return null;
      }

      this.app.log.info(`[OAuth State] Found state data: provider=${data.provider}, interactionUid=${data.interactionUid}, age=${Date.now() - data.createdAt}ms`);

      // 验证 state 未过期（额外检查）
      const age = Date.now() - data.createdAt;
      if (age > 600000) { // 10 分钟
        this.app.log.warn(`[OAuth State] Expired state: ${state.substring(0, 8)}..., age=${age}ms`);
        await this.stateStore.delete(state);
        return null;
      }

      // 消费 state（一次性使用）
      await this.stateStore.delete(state);

      this.app.log.info(`[OAuth State] Verified and consumed state for ${data.provider}`);

      return data;
    } catch (err) {
      this.app.log.error({ err }, 'Failed to verify OAuth state');
      return null;
    }
  }

  /**
   * 存储认证结果（用于 OAuth 回调后的重定向）
   */
  async storeAuthResult(interactionUid: string, userId: string): Promise<void> {
    const authResult = {
      userId,
      timestamp: Date.now(),
      type: 'auth_result', // 标记为认证结果
    };

    await this.stateStore.set(`auth_result_${interactionUid}`, authResult, 300); // 5分钟过期
    
    this.app.log.info(`Stored auth result for interaction: ${interactionUid}, user: ${userId}`);
  }

  async getAuthResult(interactionUid: string): Promise<string | null> {
    const key = `auth_result_${interactionUid}`;
    const result = await this.stateStore.get(key);
    
    if (!result) {
      return null;
    }

    // 验证这是认证结果而不是普通的 OAuth state
    if ((result as any).type !== 'auth_result' || !('userId' in result) || !('timestamp' in result)) {
      return null;
    }

    const authResult = result as { userId: string; timestamp: number; type: string };

    // 检查是否过期（5分钟）
    if (Date.now() - authResult.timestamp > 300000) {
      await this.stateStore.delete(key);
      return null;
    }
    
    // 消费后删除
    await this.stateStore.delete(key);
    
    return authResult.userId;
  }

  /**
   * 完成 OIDC 交互
   * 供插件调用，用于完成用户认证后的 OIDC 交互流程
   */
  async finishOidcInteraction(
    request: FastifyRequest,
    reply: FastifyReply,
    interactionUid: string,
    userId: string
  ): Promise<void> {
    if (!this.oidcProvider) {
      throw new Error('OIDC Provider not initialized');
    }

    try {
      await this.oidcProvider.interactionFinished(
        request.raw,
        reply.raw,
        {
          login: {
            accountId: userId,
          },
        },
        { mergeWithLastSubmission: false }
      );
      
      this.app.log.info(`OIDC interaction finished for user: ${userId}, uid: ${interactionUid}`);
    } catch (err) {
      this.app.log.error({ err, userId, interactionUid }, 'Failed to finish OIDC interaction');
      throw err;
    }
  }

  /**
   * 初始化所有插件
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('AuthCoordinator already initialized');
    }

    this.app.log.info('Initializing auth providers...');

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
        this.app.log.error({ err, provider: name }, 'Failed to initialize provider');
        throw err;
      }
    }

    this.initialized = true;
    this.app.log.info('All auth providers initialized successfully');
  }

  /**
   * 销毁所有插件
   */
  async destroy(): Promise<void> {
    this.app.log.info('Destroying auth providers...');

    for (const [name, provider] of this.providers.entries()) {
      if (provider.destroy) {
        try {
          await provider.destroy();
          this.app.log.info(`Destroyed provider: ${name}`);
        } catch (err) {
          this.app.log.error({ err, provider: name }, 'Failed to destroy provider');
        }
      }
    }

    this.providers.clear();
    this.initialized = false;
  }
}
