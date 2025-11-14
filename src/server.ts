import fastify from 'fastify';
import staticFiles from '@fastify/static';
import cors from '@fastify/cors';
import middie from '@fastify/middie';
import formBody from '@fastify/formbody';
import path from 'path';
import { Provider, type Configuration } from 'oidc-provider';
import { loadConfig } from './config';

// 认证系统导入
import { AuthCoordinator } from './core/AuthCoordinator';
import { MemoryStateStore } from './stores/MemoryStateStore';
import { UserRepositoryFactory } from './repositories/UserRepositoryFactory';
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

  // 配置静态文件服务
  await app.register(staticFiles, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/',
  });

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
    return reply.redirect('/index.html');
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
        return reply.redirect('/error-session-expired.html');
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
