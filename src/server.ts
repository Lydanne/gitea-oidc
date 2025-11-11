import fastify from 'fastify';
import cors from '@fastify/cors';
import middie from '@fastify/middie';
import formBody from '@fastify/formbody';
import { Provider, type Configuration } from 'oidc-provider';
import { loadConfig } from './config';

// 认证系统导入
import { AuthCoordinator } from './core/AuthCoordinator';
import { MemoryStateStore } from './stores/MemoryStateStore';
import { MemoryUserRepository } from './repositories/MemoryUserRepository';
import { LocalAuthProvider } from './providers/LocalAuthProvider';
import { FeishuAuthProvider } from './providers/FeishuAuthProvider';
import type { AuthContext, AuthProvider } from './types/auth';
import { getUserErrorMessage, formatAuthError } from './utils/authErrors';


async function start() {
  const config = await loadConfig();

  const app = fastify({ logger: true });
  
  // 从配置获取日志设置
  const ENABLE_DETAILED_LOGGING = config.logging.enabled;
  
  function logInfo(message: string, ...args: any[]) {
    if (ENABLE_DETAILED_LOGGING) {
      console.log(message, ...args);
    }
  }
  
  function logWarn(message: string, ...args: any[]) {
    if (ENABLE_DETAILED_LOGGING) {
      console.warn(message, ...args);
    }
  }
  
  function logError(message: string, ...args: any[]) {
    console.error(message, ...args); // 错误日志始终输出
  }
  // 注册中间件插件
  await app.register(middie);
  await app.register(cors, { origin: true });
  // 解析 application/x-www-form-urlencoded 表单
  await app.register(formBody);

  // 初始化认证系统
  logInfo('[认证系统] 正在初始化...');
  
  const stateStore = new MemoryStateStore(60000); // 每分钟清理一次
  const userRepository = new MemoryUserRepository();
  
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
    logInfo('[认证系统] 已注册 LocalAuthProvider');
  }
  
  if (config.auth.providers.feishu?.enabled) {
    const feishuProvider = new FeishuAuthProvider(userRepository, authCoordinator);
    authCoordinator.registerProvider(feishuProvider);
    logInfo('[认证系统] 已注册 FeishuAuthProvider');
  }
  
  // 初始化所有插件
  await authCoordinator.initialize();
  logInfo('[认证系统] 初始化完成');

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
      logInfo(`[查找账户] sub: ${sub}, token类型: ${token?.constructor?.name || 'unknown'} ctx: ${JSON.stringify(ctx)}`);
      
      // 使用 AuthCoordinator 查找用户
      const user = await authCoordinator.findAccount(sub);
      
      if (!user) {
        logInfo(`[账户查找结果] ${sub}: 未找到`);
        return undefined;
      }
      
      logInfo(`[账户查找结果] ${sub}: 找到 (${user.username}) JSON: ` + JSON.stringify(user));
      
      return {
        accountId: user.sub,
        async claims(use: string, scope: string, claims: any, rejected: any) {
          logInfo(`[声明生成] 用户: ${user.username}, scope: ${scope} claims: ${JSON.stringify(claims)} rejected: ${JSON.stringify(rejected)} use: ${use}`);
          
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
          
          logInfo(`[返回声明]`, userClaims);
          return userClaims;
        },
      };
    },
    ttl: config.oidc.ttl,
  };

  const oidc = new Provider(config.oidc.issuer, configuration);

  // 挂载OIDC到Fastify
  app.use('/oidc', oidc.callback());

  // 添加中间件打印所有OIDC请求
  app.addHook('preHandler', (request, reply, done) => {
    if (request.url.startsWith('/oidc')) {
      logInfo(`[OIDC请求] ${request.method} ${request.url}`);
      if (request.query && Object.keys(request.query).length > 0) {
        logInfo(`[查询参数]`, request.query);
      }
      if (request.body && Object.keys(request.body).length > 0) {
        logInfo(`[请求体]`, request.body);
      }
    }
    done();
  });

  // 统一登录页面（使用认证插件系统）
  app.get('/interaction/:uid', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    logInfo(`[交互页面] 用户访问交互页面, UID: ${uid}`);
    
    try {
      const details = await oidc.interactionDetails(request.raw, reply.raw);
      
      logInfo(`[GET 交互详情]` + JSON.stringify({
        uid: details.uid,
        prompt: details.prompt,
        params: details.params,
        grantId: details.grantId,
      }));
      
      // 如果是 consent prompt，说明用户已经登录，直接自动授予同意
      if (details.prompt.name === 'consent') {
        logInfo(`[自动授予同意] 用户已登录，自动处理 consent`);
        
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
        
        logInfo(`[自动授予完成] grantId: ${grantId}`);
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
      logError('[交互页面] 渲染失败:', err);
      return reply.code(500).send('Internal Server Error');
    }
  });

  // 登录处理（使用认证插件系统）
  app.post('/interaction/:uid/login', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const body = request.body as Record<string, any>;

    logInfo(`[登录尝试] UID: ${uid}, 认证方式: ${body.authMethod}`);

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
        logInfo(`[登录成功] 用户 ${result.userId} 认证通过，完成 login 交互`);

        // 只完成 login，consent 会在后续的 GET 请求中自动处理
        await oidc.interactionFinished(
          request.raw,
          reply.raw,
          {
            login: { accountId: result.userId },
          },
          { mergeWithLastSubmission: false }
        );

        logInfo(`[Login 完成] 用户 ${result.userId}`);
      } else {
        // 记录详细错误日志
        if (result.error) {
          logWarn(`[登录失败] ${formatAuthError(result.error)}`);
        } else {
          logWarn('[登录失败] 未知错误');
        }
        
        // 认证失败，重定向回登录页面并显示用户友好的错误消息
        const errorMessage = result.error 
          ? getUserErrorMessage(result.error)
          : '认证失败';
        return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent(errorMessage)}`);
      }
    } catch (err) {
      logError('[登录处理] 错误:', err);
      return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent('系统错误，请稍后重试')}`);
    }
  });
  
  // 飞书登录成功回调处理
  app.get('/interaction/:uid/feishu-success', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const { userId } = request.query as { userId: string };
    
    logInfo(`[飞书登录] 回调成功, UID: ${uid}, 用户: ${userId}`);
    
    try {
      if (!userId) {
        return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent('用户ID缺失')}`);
      }
      
      // 完成 OIDC 交互
      await oidc.interactionFinished(
        request.raw,
        reply.raw,
        {
          login: {
            accountId: userId,
          },
        },
        { mergeWithLastSubmission: false }
      );
      
      logInfo(`[交互完成] 飞书用户 ${userId}`);
    } catch (err) {
      logError('[飞书登录] 完成交互失败:', err);
      return reply.redirect(`/interaction/${uid}?error=${encodeURIComponent('登录失败')}`);
    }
  });

  try {
    await app.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });
    console.log(`OIDC IdP server listening on ${config.server.url}`);
    console.log(`认证插件已启用: ${authCoordinator.getProviders().map((p: AuthProvider) => p.name).join(', ')}`);
  } catch (err) {
    logError('服务器启动失败:', err);
    process.exit(1);
  }
  
  // 优雅关闭
  const shutdown = async () => {
    logInfo('[服务器] 正在关闭...');
    
    // 销毁认证系统
    await authCoordinator.destroy();
    stateStore.destroy();
    
    // 关闭 Fastify
    await app.close();
    
    logInfo('[服务器] 关闭完成');
    process.exit(0);
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start();
