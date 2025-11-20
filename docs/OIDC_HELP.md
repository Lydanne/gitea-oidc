# OIDC-Provider 使用指南

基于 Context7 查询的最新 oidc-provider 文档生成的使用指南。

## 📦 安装

```bash
npm install oidc-provider
# 或
yarn add oidc-provider
# 或
pnpm add oidc-provider
```

## 🚀 快速开始

### 基础配置

```javascript
import * as oidc from "oidc-provider";

const provider = new oidc.Provider("http://localhost:3000", {
  clients: [{
    client_id: "foo",
    client_secret: "bar",
    redirect_uris: ["http://localhost:8080/cb"],
    // ... 其他客户端属性
  }],
});

const server = provider.listen(3000, () => {
  console.log(
    "oidc-provider listening on port 3000, check http://localhost:3000/oidc/.well-known/openid-configuration"
  );
});
```

### TypeScript 支持

```typescript
import { Provider, type Configuration } from 'oidc-provider';

const configuration: Configuration = {
  // 配置选项
};

const provider = new Provider("http://localhost:3000", configuration);
```

## ⚙️ 核心配置选项

### 客户端配置 (Clients)

```javascript
clients: [{
  client_id: "my-client",
  client_secret: "my-secret",
  redirect_uris: ["http://localhost:8080/callback"],
  response_types: ["code"],
  grant_types: ["authorization_code"],
  token_endpoint_auth_method: "client_secret_basic",
  // 可选属性
  client_name: "My Application",
  logo_uri: "https://example.com/logo.png",
  scope: "openid profile email",
}]
```

#### 客户端认证方法

- `"client_secret_basic"` - HTTP Basic 认证
- `"client_secret_post"` - POST 请求体认证
- `"client_secret_jwt"` - JWT 签名认证
- `"private_key_jwt"` - 私钥 JWT 认证
- `"none"` - 无认证（与 PKCE 一起使用）

### 路由配置 (Routes)

```javascript
routes: {
  authorization: '/auth',
  backchannel_authentication: '/backchannel',
  code_verification: '/device',
  device_authorization: '/device/auth',
  end_session: '/session/end',
  introspection: '/token/introspection',
  jwks: '/jwks',
  pushed_authorization_request: '/request',
  registration: '/reg',
  revocation: '/token/revocation',
  token: '/token',
  userinfo: '/me'
}
```

### 功能特性 (Features)

```javascript
features: {
  devInteractions: { enabled: false }, // 开发交互界面
  registration: { enabled: true },     // 动态客户端注册
  revocation: { enabled: true },       // 令牌撤销
  introspection: { enabled: true },    // 令牌内省
  oauthNativeApps: true,               // 原生应用支持
}
```

### PKCE 配置

```javascript
pkce: {
  required: (ctx, client) => false, // 是否强制要求 PKCE
  forcedForNative: true,            // 原生应用强制使用 PKCE
  skipClientAuth: false,            // 是否跳过客户端认证
}
```

### Cookie 配置

```javascript
cookies: {
  keys: ['some-secret-key'], // 用于签名 cookies 的密钥
  long: { signed: true, maxAge: 24 * 60 * 60 * 1000 }, // 长会话
  short: { signed: true, maxAge: 5 * 60 * 1000 },      // 短会话
}
```

### 声明配置 (Claims)

```javascript
claims: {
  openid: ['sub'],
  profile: ['name', 'family_name', 'given_name', 'preferred_username'],
  email: ['email', 'email_verified'],
  address: ['address'],
  phone: ['phone_number', 'phone_number_verified'],
}
```

### 令牌配置 (TTL)

```javascript
ttl: {
  AccessToken: 3600,           // 1 小时
  AuthorizationCode: 600,      // 10 分钟
  IdToken: 3600,              // 1 小时
  RefreshToken: 86400,        // 24 小时
  DeviceCode: 300,            // 5 分钟
  Interaction: 3600,          // 1 小时
}
```

## 🔗 框架集成

### Express 集成

```javascript
const express = require('express');
const app = express();

app.use('/oidc', provider.callback());

app.listen(3000);
```

### Fastify 集成

```javascript
import fastify from 'fastify';
import middie from '@fastify/middie';

const app = fastify();
await app.register(middie);

app.use('/oidc', provider.callback());

await app.listen({ port: 3000 });
```

### Koa 集成

```javascript
const Koa = require('koa');
const mount = require('koa-mount');

const app = new Koa();
app.use(mount('/oidc', provider));

app.listen(3000);
```

### Hapi 集成

```javascript
const Hapi = require('@hapi/hapi');

const server = Hapi.server({ port: 3000 });

server.route({
  method: '*',
  path: '/oidc/{any*}',
  handler: (request, h) => {
    const { req, res } = request.raw;
    req.originalUrl = req.url;
    req.url = req.url.replace('/oidc', '');
    provider.callback()(req, res);
    return res;
  }
});
```

## 👤 用户账户管理

### findAccount 函数

```javascript
findAccount: async (ctx, sub, token) => {
  // sub: 用户标识符
  // token: 令牌对象 (可选)

  const user = await db.findUserById(sub);

  if (!user) {
    return undefined; // 用户不存在
  }

  return {
    accountId: user.id,
    async claims(use, scope, claims, rejected) {
      // 返回用户声明
      return {
        sub: user.id,
        name: user.name,
        email: user.email,
        email_verified: user.emailVerified,
      };
    },
  };
}
```

### 声明生成示例

```javascript
async claims(use, scope, claims, rejected) {
  // use: 声明用途 ('id_token', 'userinfo', 'access_token')
  // scope: 请求的 scope
  // claims: 请求的特定声明
  // rejected: 被拒绝的声明

  const userClaims = {
    sub: user.id,
    name: user.displayName,
    email: user.email,
    email_verified: user.emailVerified,
    preferred_username: user.username,
  };

  // 只返回请求的声明
  if (claims && claims.length > 0) {
    const filtered = {};
    claims.forEach(claim => {
      if (userClaims[claim]) {
        filtered[claim] = userClaims[claim];
      }
    });
    return filtered;
  }

  return userClaims;
}
```

## 🎨 自定义交互界面

### 自定义登录页面

```javascript
interactions: {
  url: async (ctx, interaction) => {
    return `/interaction/${interaction.uid}`;
  },
}
```

### 登录路由实现

```javascript
// GET /interaction/:uid - 显示登录表单
app.get('/interaction/:uid', async (req, reply) => {
  const interaction = await provider.interactionDetails(req.raw, reply.raw);

  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Login to ${interaction.params.client_id}</h1>
        <form method="post" action="/interaction/${req.params.uid}/login">
          <input name="username" placeholder="Username">
          <input name="password" type="password" placeholder="Password">
          <button type="submit">Login</button>
        </form>
      </body>
    </html>
  `;

  reply.type('text/html').send(html);
});

// POST /interaction/:uid/login - 处理登录
app.post('/interaction/:uid/login', async (req, reply) => {
  const { username, password } = req.body;

  // 验证用户凭据
  const user = await authenticateUser(username, password);

  if (user) {
    await provider.interactionFinished(req.raw, reply.raw, {
      login: { accountId: user.id },
    });
  } else {
    reply.code(401).send('Invalid credentials');
  }
});
```

## 🛡️ 安全配置

### 客户端密钥编码 (Basic Auth)

```javascript
const client_id = 'an:identifier';
const client_secret = 'some secure & non-standard secret';

// 需要先进行 form-encoding，然后 Base64 编码
const encoded_id = encodeURIComponent(client_id);      // 'an%3Aidentifier'
const encoded_secret = encodeURIComponent(client_secret); // 'some+secure+%26+non-standard+secret'

const auth = Buffer.from(`${encoded_id}:${encoded_secret}`).toString('base64');
const header = `Basic ${auth}`;
```

### 错误处理

```javascript
function handleClientAuthErrors({ headers: { authorization }, oidc: { body, client } }, err) {
  if (err.statusCode === 401 && err.message === 'invalid_client') {
    console.log('Client authentication failed:', {
      client: client?.clientId,
      authorization: authorization,
      body: body,
      error: err.message
    });
    // 保存错误详情用于调试
  }
}

provider.on('grant.error', handleClientAuthErrors);
provider.on('introspection.error', handleClientAuthErrors);
provider.on('revocation.error', handleClientAuthErrors);
```

## 🔧 中间件

### 自定义中间件

```javascript
provider.use(async (ctx, next) => {
  // 前处理
  console.log('Request:', ctx.method, ctx.path);

  await next();

  // 后处理
  console.log('Response:', ctx.status, ctx.oidc?.route);
});
```

### 路由特定的中间件

```javascript
provider.use(async (ctx, next) => {
  if (ctx.path === '/auth') {
    // 仅在授权端点执行
    console.log('Authorization request');
  }

  await next();

  if (ctx.oidc?.route === 'authorization') {
    // 授权路由的后处理
    console.log('Authorization response');
  }
});
```

## 📊 动态客户端注册

### 基本配置

```javascript
features: {
  registration: {
    enabled: true,
    initialAccessToken: true,
    policies: {
      'my-policy': async (ctx, properties) => {
        // 验证和修改客户端属性
        if (!properties.client_name) {
          properties.client_name = 'Default App Name';
        }

        // 强制某些设置
        properties.token_endpoint_auth_method = 'client_secret_basic';

        // 抛出错误拒绝注册
        if (someValidationFails) {
          throw new errors.InvalidClientMetadata('Validation failed');
        }
      }
    }
  }
}
```

### 初始访问令牌

```javascript
// 创建初始访问令牌
const initialAccessToken = await new provider.InitialAccessToken({
  policies: ['my-policy']
}).save();

// 使用令牌
// POST /reg
// Authorization: Bearer <initial_access_token>
```

## 🔄 令牌管理

### 令牌撤销

```javascript
// POST /token/revocation
// Content-Type: application/x-www-form-urlencoded

// token=<token>&client_id=<client_id>&client_secret=<client_secret>
```

### 令牌内省

```javascript
// POST /token/introspection
// Content-Type: application/x-www-form-urlencoded

// token=<token>&client_id=<client_id>&client_secret=<client_secret>

// 响应:
// {
//   "active": true,
//   "client_id": "client_id",
//   "sub": "user_id",
//   "scope": "openid profile",
//   "token_type": "Bearer"
// }
```

## 🌐 端点列表

- `/oidc/.well-known/openid-configuration` - OpenID 配置
- `/auth` - 授权端点
- `/token` - 令牌端点
- `/me` - 用户信息端点
- `/jwks` - JWKS 端点
- `/reg` - 动态注册端点
- `/token/revocation` - 令牌撤销端点
- `/token/introspection` - 令牌内省端点
- `/device/auth` - 设备授权端点
- `/session/end` - 结束会话端点

## 🎯 最佳实践

### 1. 使用 HTTPS

```javascript
const provider = new Provider("https://my-domain.com", config);
```

### 2. 配置强密钥

```javascript
cookies: {
  keys: ['very-strong-random-key-here']
}
```

### 3. 启用 PKCE

```javascript
pkce: {
  forcedForNative: true,  // 原生应用强制使用
}
```

### 4. 配置适当的 TTL

```javascript
ttl: {
  AccessToken: 3600,      // 生产环境建议更短
  AuthorizationCode: 300, // 5分钟足够
}
```

### 5. 实现错误处理

```javascript
provider.on('grant.error', (ctx, err) => {
  console.error('Grant error:', err);
});
```

## 🐛 故障排除

### 常见问题

#### 客户端认证失败

- 检查 `client_secret` 是否正确
- 确认 `token_endpoint_auth_method` 设置
- 验证 Basic Auth 编码

#### 重定向 URI 不匹配

- 确保 `redirect_uris` 完全匹配
- 检查协议 (http/https)

#### CORS 错误

- 配置适当的 CORS 设置
- 检查预检请求

#### 令牌过期

- 调整 `ttl` 配置
- 实现令牌刷新逻辑

## 📚 参考资源

- [官方文档](https://github.com/panva/node-oidc-provider)
- [OpenID Connect 规范](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 规范](https://tools.ietf.org/html/rfc6749)
- [OIDC 认证](https://openid.net/certification/)

## 🔄 更新日志

### v8.x 主要变化

- 改进的 TypeScript 支持
- 更强的安全默认设置
- 更好的错误处理
- 支持最新的 OAuth 2.1 规范

---

*本文档基于 oidc-provider v8.x 版本，使用 Context7 从官方文档生成。*
