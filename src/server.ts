import fastify from 'fastify';
import cors from '@fastify/cors';
import middie from '@fastify/middie';
import { Provider, type Configuration } from 'oidc-provider';

const app = fastify({ logger: true });

async function start() {
  // 注册中间件插件
  await app.register(middie);
  await app.register(cors, { origin: true });

  // 配置OIDC Provider
  const configuration: Configuration = {
    clients: [{
      client_id: 'gitea',
      client_secret: 'secret',
      redirect_uris: ['http://localhost:3001/user/oauth2/gitea/callback'], // Gitea回调URL
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'client_secret_basic',
    }],
    interactions: {
      url: async (ctx: any, interaction: any) => {
        return `/interaction/${interaction.uid}`;
      },
    },
    cookies: {
      keys: ['some-secret-key'],
    },
    claims: {
      openid: ['sub'],
      profile: ['name', 'email'],
    },
    features: {
      devInteractions: { enabled: false }, // 禁用开发交互，使用自定义
      registration: { enabled: false },
      revocation: { enabled: true },
    },
    findAccount: async (ctx: any, sub: string, token: any) => {
      console.log(`[查找账户] sub: ${sub}, token类型: ${token?.constructor?.name || 'unknown'}`);
      
      // 硬编码用户
      const accounts: Record<string, any> = {
        'testuser': {
          accountId: 'testuser',
          async claims(use: string, scope: string, claims: any, rejected: any) {
            console.log(`[声明生成] 用户: testuser, scope: ${scope}, claims:`, claims);
            const userClaims = {
              sub: 'testuser',
              name: 'Test User',
              email: 'test@example.com',
            };
            console.log(`[返回声明]`, userClaims);
            return userClaims;
          },
        },
      };
      
      const account = accounts[sub];
      console.log(`[账户查找结果] ${sub}: ${account ? '找到' : '未找到'}`);
      return account;
    },
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
  };

  const oidc = new Provider(`http://localhost:3000`, configuration);

  // 挂载OIDC到Fastify
  app.use('/oidc', oidc.callback());

  // 添加中间件打印所有OIDC请求
  app.addHook('preHandler', (request, reply, done) => {
    if (request.url.startsWith('/oidc')) {
      console.log(`[OIDC请求] ${request.method} ${request.url}`);
      if (request.query && Object.keys(request.query).length > 0) {
        console.log(`[查询参数]`, request.query);
      }
      if (request.body && Object.keys(request.body).length > 0) {
        console.log(`[请求体]`, request.body);
      }
    }
    done();
  });

  // 自定义交互页面（简化版）
  app.get('/interaction/:uid', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    console.log(`[交互页面] 用户访问交互页面, UID: ${uid}`);
    
    const interaction = await oidc.interactionDetails(request.raw, reply.raw);
    if (!interaction) {
      console.log(`[交互页面] 交互详情未找到, UID: ${uid}`);
      return reply.code(404).send('Interaction not found');
    }

    console.log(`[交互详情]`, {
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

    console.log(`[登录尝试] UID: ${uid}, 用户名: ${username}`);

    // 简化认证（仅检查硬编码用户）
    if (username === 'testuser' && password === 'password') {
      console.log(`[登录成功] 用户 ${username} 认证通过，正在完成交互`);
      
      const result = await oidc.interactionFinished(request.raw, reply.raw, {
        login: { accountId: username },
      });
      
      console.log(`[交互完成] 结果:`, result);
    } else {
      console.log(`[登录失败] 用户名或密码错误: ${username}`);
      reply.code(401).send('Invalid credentials');
    }
  });

  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log('OIDC IdP server listening on http://localhost:3000');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
