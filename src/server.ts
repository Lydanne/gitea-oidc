import fastify from 'fastify';
import cors from '@fastify/cors';
import middie from '@fastify/middie';
// @ts-ignore
import { Provider, type Configuration } from 'oidc-provider';
import { config, type GiteaOidcConfig } from './config';

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

async function start() {
  // 注册中间件插件
  await app.register(middie);
  await app.register(cors, { origin: true });

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
      logInfo(`[查找账户] sub: ${sub}, token类型: ${token?.constructor?.name || 'unknown'}`);
      
      // 从配置获取用户账户
      const accounts: Record<string, any> = {};
      
      // 将配置中的账户转换为 oidc-provider 需要的格式
      for (const [accountId, accountData] of Object.entries(config.accounts)) {
        accounts[accountId] = {
          accountId: accountData.accountId,
          async claims(use: string, scope: string, claims: any, rejected: any) {
            logInfo(`[声明生成] 用户: ${accountId}, scope: ${scope}, claims:`, claims);
            const userClaims = {
              sub: accountData.accountId,
              name: accountData.name,
              email: accountData.email,
            };
            logInfo(`[返回声明]`, userClaims);
            return userClaims;
          },
        };
      }
      
      const account = accounts[sub];
      logInfo(`[账户查找结果] ${sub}: ${account ? '找到' : '未找到'}`);
      return account;
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

  // 自定义交互页面（简化版）
  app.get('/interaction/:uid', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    logInfo(`[交互页面] 用户访问交互页面, UID: ${uid}`);
    
    const interaction = await oidc.interactionDetails(request.raw, reply.raw);
    if (!interaction) {
      logWarn(`[交互页面] 交互详情未找到, UID: ${uid}`);
      return reply.code(404).send('Interaction not found');
    }

    logInfo(`[交互详情]`, {
      uid: interaction.uid,
      prompt: interaction.prompt,
      params: interaction.params,
      session: interaction.session
    });

    // 简单的登录表单
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Login</title></head>
      <body>
        <h1>Login to ${interaction.params.client_id}</h1>
        <form method="post" action="/interaction/${uid}/login">
          <input type="text" name="username" placeholder="Username" value="testuser" required><br>
          <input type="password" name="password" placeholder="Password" value="password" required><br>
          <button type="submit">Login</button>
        </form>
      </body>
      </html>
    `;
    reply.type('text/html').send(html);
  });

  app.post('/interaction/:uid/login', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const { username, password } = request.body as { username: string; password: string };

    logInfo(`[登录尝试] UID: ${uid}, 用户名: ${username}`);

    // 简化认证（检查配置中的用户）
    const accountData = config.accounts[username];
    const validPassword = password === 'password'; // 简化密码验证
    
    if (accountData && validPassword) {
      logInfo(`[登录成功] 用户 ${username} 认证通过，正在完成交互`);
      
      const result = await oidc.interactionFinished(request.raw, reply.raw, {
        login: { accountId: username },
      });
      
      logInfo(`[交互完成] 结果:`, result);
    } else {
      logWarn(`[登录失败] 用户名或密码错误: ${username}`);
      reply.code(401).send('Invalid credentials');
    }
  });

  try {
    await app.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });
    console.log(`OIDC IdP server listening on ${config.server.url}`);
  } catch (err) {
    logError('服务器启动失败:', err);
    process.exit(1);
  }
};

start();
