import fastify from 'fastify';
import cors from '@fastify/cors';
import middie from '@fastify/middie';
import formBody from '@fastify/formbody';
import { Provider, type Configuration } from 'oidc-provider';
import { loadConfig } from './config';

// 认证系统导入
import { AuthCoordinator } from './core/AuthCoordinator';
import { MemoryStateStore } from './stores/MemoryStateStore';
import { UserRepositoryFactory } from './repositories/UserRepositoryFactory.js';
import { LocalAuthProvider } from './providers/LocalAuthProvider';
import { FeishuAuthProvider } from './providers/FeishuAuthProvider';
import type { AuthContext, AuthProvider } from './types/auth';
import { getUserErrorMessage, formatAuthError } from './utils/authErrors';
import { Logger, LogLevel } from './utils/Logger';


async function start() {
  const config = await loadConfig();

  const app = fastify({ logger: true });
  
  // 从配置获取日志设置并配置 Logger
  const ENABLE_DETAILED_LOGGING = config.logging.enabled;
  Logger.setLevel(ENABLE_DETAILED_LOGGING ? LogLevel.INFO : LogLevel.WARN);
  // 注册中间件插件
  await app.register(middie);
  await app.register(cors, { origin: true });
  // 解析 application/x-www-form-urlencoded 表单
  await app.register(formBody);

  // 初始化认证系统
  Logger.info('[认证系统] 正在初始化...');
  
  const stateStore = new MemoryStateStore({
    maxSize: 10000,         // 最大存储10000个state
    cleanupIntervalMs: 30000 // 每30秒清理一次
  });
  const userRepository = UserRepositoryFactory.create(config.auth.userRepository);
  
  // 创建认证协调器
  const authCoordinator = new AuthCoordinator({
    app,
    stateStore,
    userRepository,
    providersConfig: config.auth.providers,
  });
  
  // 注册认证插件
  if (config.auth.providers.local?.enabled) {
    const localProvider = new LocalAuthProvider(userRepository);
    authCoordinator.registerProvider(localProvider);
    Logger.info('[认证系统] 已注册 LocalAuthProvider');
  }
  
  if (config.auth.providers.feishu?.enabled) {
    const feishuProvider = new FeishuAuthProvider(userRepository, authCoordinator);
    authCoordinator.registerProvider(feishuProvider);
    Logger.info('[认证系统] 已注册 FeishuAuthProvider');
  }
  
  // 初始化所有插件
  await authCoordinator.initialize();
  Logger.info('[认证系统] 初始化完成');

  // 配置OIDC Provider
  const configuration: Configuration = {
    clients: config.clients as any,
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
    findAccount: async (ctx, sub, token) => {
      Logger.debug(`[查找账户] sub: ${sub}, token类型: ${token?.constructor?.name || 'unknown'} ctx: ${JSON.stringify(ctx)}`);
      
      // 使用 AuthCoordinator 查找用户
      const user = await authCoordinator.findAccount(sub);
      
      if (!user) {
        Logger.info(`[账户查找结果] ${sub}: 未找到`);
        return undefined;
      }
      
      Logger.debug(`[账户查找结果] ${sub}: 找到 (${user.username}) JSON: ` + JSON.stringify(user));
      
      return {
        accountId: user.sub,
        async claims(use: string, scope: string, claims: any, rejected: any) {
          Logger.debug(`[声明生成] 用户: ${user.username}, scope: ${scope} claims: ${JSON.stringify(claims)} rejected: ${JSON.stringify(rejected)} use: ${use}`);
          
          // 直接使用 UserInfo 的 OIDC 标准字段
          const userClaims = {
            sub: user.sub,
            name: user.name,
            email: user.email,
            email_verified: user.email_verified ?? false,
            picture: user.picture,
            phone: user.phone,
            phone_verified: user.phone_verified ?? false,
            groups: user.groups ?? [],
            updated_at: user.updatedAt ? Math.floor(user.updatedAt.getTime() / 1000) : undefined,
          };
          
          Logger.debug(`[返回声明]`, userClaims);
          return userClaims;
        },
      };
    },
    ttl: config.oidc.ttl,
  };

  const oidc = new Provider(config.oidc.issuer, configuration);
  
  // 将 OIDC Provider 实例传递给 AuthCoordinator
  authCoordinator.setOidcProvider(oidc);

  // 挂载OIDC到Fastify
  app.use('/oidc', oidc.callback());

  // 添加中间件打印所有OIDC请求
  app.addHook('preHandler', (request, reply, done) => {
    if (request.url.startsWith('/oidc')) {
      Logger.info(`[OIDC请求] ${request.method} ${request.url}`);
      if (request.query && Object.keys(request.query).length > 0) {
        Logger.debug(`[查询参数]`, request.query);
      }
      if (request.body && Object.keys(request.body).length > 0) {
        Logger.debug(`[请求体]`, request.body);
      }
    }
    done();
  });

  // 首页 - 项目介绍和GitHub链接
  app.get('/', async (request, reply) => {
    Logger.info('[首页] 用户访问首页');

    const homeHtml = `
      <!DOCTYPE html>
      <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Gitea OIDC - 轻量级 OpenID Connect 身份提供者</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: #333;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 2rem;
            }
            .container {
              max-width: 800px;
              background: white;
              border-radius: 16px;
              box-shadow: 0 25px 50px rgba(0,0,0,0.15);
              overflow: hidden;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 3rem 2rem;
              text-align: center;
            }
            .header h1 {
              font-size: 2.5rem;
              font-weight: 700;
              margin-bottom: 0.5rem;
            }
            .header p {
              font-size: 1.2rem;
              opacity: 0.9;
              margin-bottom: 1.5rem;
            }
            .content {
              padding: 3rem 2rem;
            }
            .description {
              font-size: 1.1rem;
              line-height: 1.7;
              color: #666;
              margin-bottom: 2rem;
              text-align: center;
            }
            .oauth-providers {
              background: #f8f9fa;
              border-radius: 12px;
              padding: 1.5rem;
              margin-bottom: 2rem;
              border: 1px solid #e9ecef;
            }
            .oauth-providers h3 {
              font-size: 1.1rem;
              font-weight: 600;
              color: #2d3748;
              margin-bottom: 1rem;
              text-align: center;
            }
            .provider-list {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 1rem;
            }
            .provider-item {
              text-align: center;
              padding: 1rem;
              background: white;
              border-radius: 8px;
              border: 1px solid #dee2e6;
            }
            .provider-icon {
              font-size: 1.5rem;
              margin-bottom: 0.5rem;
              display: block;
              margin-left: auto;
              margin-right: auto;
            }
            .provider-name {
              font-weight: 500;
              color: #2d3748;
              font-size: 0.9rem;
            }
            .provider-status {
              font-size: 0.75rem;
              color: #718096;
              margin-top: 0.25rem;
            }
            .features {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
              gap: 2rem;
              margin-bottom: 3rem;
            }
            .feature {
              text-align: center;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 12px;
              border: 1px solid #e9ecef;
            }
            .feature-icon {
              font-size: 2.5rem;
              margin-bottom: 1rem;
              display: block;
            }
            .feature h3 {
              font-size: 1.2rem;
              font-weight: 600;
              margin-bottom: 0.5rem;
              color: #2d3748;
            }
            .feature p {
              color: #718096;
              line-height: 1.6;
            }
            .actions {
              text-align: center;
              margin-bottom: 2rem;
            }
            .btn {
              display: inline-block;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 1rem;
              font-weight: 500;
              text-decoration: none;
              transition: all 0.2s ease;
              margin: 0.5rem;
              border: none;
              cursor: pointer;
            }
            .btn-primary {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            .btn-primary:hover {
              transform: translateY(-2px);
              box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
            }
            .btn-secondary {
              background: #f8f9fa;
              color: #495057;
              border: 1px solid #dee2e6;
            }
            .btn-secondary:hover {
              background: #e9ecef;
              transform: translateY(-1px);
            }
            .footer {
              background: #f8f9fa;
              padding: 2rem;
              text-align: center;
              border-top: 1px solid #e9ecef;
            }
            .footer p {
              color: #6c757d;
              margin-bottom: 0.5rem;
            }
            .github-link {
              color: #0366d6;
              text-decoration: none;
              font-weight: 500;
            }
            .github-link:hover {
              text-decoration: underline;
            }
            .status {
              display: inline-block;
              padding: 4px 8px;
              background: #d4edda;
              color: #155724;
              border-radius: 4px;
              font-size: 0.875rem;
              font-weight: 500;
              margin-left: 0.5rem;
            }
            @media (max-width: 768px) {
              .header h1 {
                font-size: 2rem;
              }
              .features {
                grid-template-columns: 1fr;
              }
              .content {
                padding: 2rem 1rem;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Gitea OIDC IdP</h1>
              <p>轻量级 OpenID Connect 身份提供者</p>
              <div>
                <span class="status">🚀 运行中</span>
              </div>
            </div>

            <div class="content">
              <div class="description">
                一个基于 Node.js 和 oidc-provider 构建的现代化 OIDC 身份提供者，
                专为 Gitea 等应用提供统一认证服务。支持多种认证方式，包括本地密码和第三方 OAuth。
              </div>

              <div class="oauth-providers">
                <h3>🔐 支持的认证方式</h3>
                <div class="provider-list">
                  <div class="provider-item">
                    <span class="provider-icon">🔑</span>
                    <div class="provider-name">本地密码</div>
                    <div class="provider-status">✅ 已启用</div>
                  </div>
                  <div class="provider-item">
                    <img src="https://p1-hera.feishucdn.com/tos-cn-i-jbbdkfciu3/84a9f036fe2b44f99b899fff4beeb963~tplv-jbbdkfciu3-image:0:0.image" 
                         alt="飞书" class="provider-icon" style="width: 24px; height: 24px; object-fit: contain;">
                    <div class="provider-name">飞书</div>
                    <div class="provider-status">✅ 已启用</div>
                  </div>
                  <div class="provider-item">
                    <span class="provider-icon">➕</span>
                    <div class="provider-name">更多提供者</div>
                    <div class="provider-status">🚀 可扩展</div>
                  </div>
                </div>
              </div>

              <div class="features">
                <div class="feature">
                  <span class="feature-icon">🔐</span>
                  <h3>OIDC 标准</h3>
                  <p>完全兼容 OpenID Connect 1.0 规范，支持授权码、隐式和混合流程</p>
                </div>
                <div class="feature">
                  <span class="feature-icon">🔌</span>
                  <h3>插件化架构</h3>
                  <p>支持多种认证提供者，可轻松扩展新的登录方式，如飞书、企业微信、GitHub等</p>
                </div>
                <div class="feature">
                  <span class="feature-icon">🛡️</span>
                  <h3>企业级安全</h3>
                  <p>使用 bcrypt 密码哈希、JWT 令牌、请求签名验证，确保企业数据安全</p>
                </div>
                <div class="feature">
                  <span class="feature-icon">⚡</span>
                  <h3>高性能</h3>
                  <p>基于 Fastify 框架，响应速度快，资源占用低，支持高并发访问</p>
                </div>
                <div class="feature">
                  <span class="feature-icon">📱</span>
                  <h3>现代化 UI</h3>
                  <p>响应式设计，支持移动端，提供优秀的用户体验和统一登录界面</p>
                </div>
                <div class="feature">
                  <span class="feature-icon">🔄</span>
                  <h3>自动同步</h3>
                  <p>支持 Webhook 事件处理，自动同步用户信息、组织架构和权限变更</p>
                </div>
              </div>

              <div class="actions">
                <a href="https://github.com/Lydanne/gitea-oidc" class="btn btn-primary" target="_blank">
                  📖 查看文档
                </a>
                <a href="https://github.com/Lydanne/gitea-oidc" class="btn btn-secondary" target="_blank">
                  ⭐ GitHub
                </a>
              </div>
            </div>

            <div class="footer">
              <p>
                <a href="https://github.com/Lydanne/gitea-oidc" class="github-link" target="_blank">
                  GitHub: Lydanne/gitea-oidc
                </a>
              </p>
              <p>© 2025 XGJ Team By Lyda. Licensed under ISC.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return reply.type('text/html').send(homeHtml);
  });

  // 统一登录页面（使用认证插件系统）
  app.get('/interaction/:uid', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    Logger.info(`[交互页面] 用户访问交互页面, UID: ${uid}`);
    
    try {
      const details = await oidc.interactionDetails(request.raw, reply.raw);
      
      Logger.debug(`[GET 交互详情]` + JSON.stringify({
        uid: details.uid,
        prompt: details.prompt,
        params: details.params,
        grantId: details.grantId,
      }));
      
      // 如果是 consent prompt，说明用户已经登录，直接自动授予同意
      if (details.prompt.name === 'consent') {
        Logger.info(`[自动授予同意] 用户已登录，自动处理 consent`);
        
        // 获取或创建 grant
        let grant = details.grantId ? await oidc.Grant.find(details.grantId) : undefined;
        if (!grant) {
          grant = new oidc.Grant({
            accountId: details.session?.accountId,
            clientId: (details.params as any).client_id,
          });
        }

        // 添加缺失的 scope/claims
        const missingScope = (details.prompt as any)?.details?.missingOIDCScope as string[] | undefined;
        if (missingScope && missingScope.length > 0) {
          grant.addOIDCScope(missingScope.join(' '));
        }

        const missingClaims = (details.prompt as any)?.details?.missingOIDCClaims as string[] | undefined;
        if (missingClaims && missingClaims.length > 0) {
          grant.addOIDCClaims(missingClaims);
        }

        const missingResourceScopes = (details.prompt as any)?.details?.missingResourceScopes as Record<string, string[]> | undefined;
        if (missingResourceScopes) {
          for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
            if (scopes && scopes.length > 0) {
              grant.addResourceScope(indicator, scopes.join(' '));
            }
          }
        }

        const grantId = await grant.save();
        
        // 完成交互
        await oidc.interactionFinished(
          request.raw,
          reply.raw,
          {
            consent: { grantId },
          },
          { mergeWithLastSubmission: true }
        );
        
        Logger.info(`[自动授予完成] grantId: ${grantId}`);
        return;
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
      
      // 渲染统一登录页面
      const html = await authCoordinator.renderUnifiedLoginPage(context);
      
      return reply.type('text/html').send(html);
    } catch (err) {
      Logger.error('[交互页面] 渲染失败:', err);

      // 检查是否是会话相关的错误
      if (err instanceof Error && (err.name === 'SessionNotFound' || err.message?.includes('interaction session id cookie not found'))) {
        // 返回用户友好的错误页面
        const errorHtml = `
          <!DOCTYPE html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>认证会话已过期 - Gitea OIDC</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  margin: 0;
                  padding: 0;
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                }
                .error-container {
                  background: white;
                  border-radius: 12px;
                  padding: 2rem;
                  box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                  text-align: center;
                  max-width: 400px;
                  margin: 1rem;
                }
                .error-icon {
                  font-size: 3rem;
                  color: #f56565;
                  margin-bottom: 1rem;
                }
                .error-title {
                  color: #2d3748;
                  font-size: 1.5rem;
                  font-weight: 600;
                  margin-bottom: 0.5rem;
                }
                .error-message {
                  color: #718096;
                  margin-bottom: 1.5rem;
                  line-height: 1.6;
                }
                .retry-btn {
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  border: none;
                  padding: 12px 24px;
                  border-radius: 8px;
                  font-size: 1rem;
                  font-weight: 500;
                  cursor: pointer;
                  text-decoration: none;
                  display: inline-block;
                  transition: transform 0.2s ease;
                }
                .retry-btn:hover {
                  transform: translateY(-2px);
                  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
                }
                .help-text {
                  color: #a0aec0;
                  font-size: 0.875rem;
                  margin-top: 1rem;
                }
              </style>
            </head>
            <body>
              <div class="error-container">
                <div class="error-icon">⏰</div>
                <h1 class="error-title">认证会话已过期</h1>
                <p class="error-message">
                  您的登录会话已过期或无效。这可能是因为：<br>
                  • 页面停留时间过长<br>
                  • 浏览器 cookies 被清除<br>
                  • 直接访问了登录链接
                </p>
                <a href="/" class="retry-btn">返回应用重新登录</a>
                <p class="help-text">
                  如果问题持续存在，请联系系统管理员
                </p>
              </div>
            </body>
          </html>
        `;
        return reply.type('text/html').send(errorHtml);
      }

      // 其他错误保持原样
      return reply.code(500).send('Internal Server Error');
    }
  });

  // OAuth 回调完成路由（用于飞书等第三方登录）
  app.get('/interaction/:uid/complete', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    Logger.info(`[OAuth 完成] UID: ${uid}`);

    try {
      // 从临时存储中获取认证结果
      const userId = await authCoordinator.getAuthResult(uid);
      
      if (!userId) {
        Logger.warn(`[OAuth 完成] 未找到认证结果: ${uid}`);
        return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent('认证会话已过期')}`);
      }

      Logger.info(`[OAuth 完成] 用户 ${userId} 认证通过，完成 login 交互`);

      // 完成 OIDC 交互
      await oidc.interactionFinished(
        request.raw,
        reply.raw,
        {
          login: { accountId: userId },
        },
        { mergeWithLastSubmission: false }
      );

      Logger.info(`[OAuth Login 完成] 用户 ${userId}`);
    } catch (err) {
      Logger.error('[OAuth 完成] 错误:', err);
      return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent('登录失败')}`);
    }
  });

  // 登录处理（使用认证插件系统）
  app.post('/interaction/:uid/login', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const body = request.body as Record<string, any>;

    Logger.info(`[登录尝试] UID: ${uid}, 认证方式: ${body.authMethod}`);

    try {
      // 创建认证上下文
      const context: AuthContext = {
        interactionUid: uid,
        request,
        reply,
        authMethod: body.authMethod,
        params: request.params as Record<string, any>,
        body,
        query: request.query as Record<string, any>,
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
          { mergeWithLastSubmission: false }
        );

        Logger.info(`[Login 完成] 用户 ${result.userId}`);
      } else {
        // 记录详细错误日志
        if (result.error) {
          Logger.warn(`[登录失败] ${formatAuthError(result.error)}`);
        } else {
          Logger.warn('[登录失败] 未知错误');
        }
        
        // 认证失败，重定向回登录页面并显示用户友好的错误消息
        const errorMessage = result.error 
          ? getUserErrorMessage(result.error)
          : '认证失败';
        return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent(errorMessage)}`);
      }
    } catch (err) {
      Logger.error('[登录处理] 错误:', err);
      return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent('系统错误，请稍后重试')}`);
    }
  });

  try {
    await app.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });
    Logger.info(`OIDC IdP server listening on ${config.server.url}`);
    Logger.info(`认证插件已启用: ${authCoordinator.getProviders().map((p: AuthProvider) => p.name).join(', ')}`);
  } catch (err) {
    Logger.error('服务器启动失败:', err);
    process.exit(1);
  }
  
  // 优雅关闭
  const shutdown = async () => {
    Logger.info('[服务器] 正在关闭...');
    
    // 销毁认证系统
    await authCoordinator.destroy();
    stateStore.destroy();
    
    // 关闭 Fastify
    await app.close();
    
    Logger.info('[服务器] 关闭完成');
    process.exit(0);
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start();
