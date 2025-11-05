# Gitea OIDC Identity Provider

一个使用 Fastify + TypeScript + oidc-provider 实现的简单 OIDC (OpenID Connect) 身份提供者，用于演示 Gitea 的 OIDC 认证集成。

## 功能特性

- ✅ 完整的 OIDC 认证流程支持
- ✅ 自定义用户交互界面
- ✅ 支持授权码流程 (Authorization Code Flow)
- ✅ JWT 令牌生成和验证
- ✅ 用户信息端点
- ✅ 详细的调试日志输出
- ✅ TypeScript 支持
- ✅ Fastify 框架集成

## 技术栈

- **Fastify** - 高性能 Node.js Web 框架
- **oidc-provider** - OpenID Certified™ OIDC 服务器实现
- **TypeScript** - 类型安全的 JavaScript
- **@fastify/middie** - Express 中间件兼容层
- **@fastify/cors** - CORS 支持

## 程序实现

### 核心组件

#### 1. OIDC Provider 配置

```typescript
const configuration: Configuration = {
  clients: [{
    client_id: 'gitea',
    client_secret: 'secret',
    redirect_uris: ['http://localhost:3001/user/oauth2/gitea/callback'],
    response_types: ['code'],
    grant_types: ['authorization_code'],
    token_endpoint_auth_method: 'client_secret_basic',
  }],
  interactions: {
    url: async (ctx, interaction) => `/interaction/${interaction.uid}`,
  },
  cookies: {
    keys: ['some-secret-key'],
  },
  claims: {
    openid: ['sub'],
    profile: ['name', 'email'],
  },
  features: {
    devInteractions: { enabled: false },
    registration: { enabled: false },
    revocation: { enabled: true },
  },
  findAccount: async (ctx, sub, token) => {
    // 用户查找和声明生成逻辑
  },
  ttl: {
    AccessToken: 3600,
    AuthorizationCode: 600,
    IdToken: 3600,
    RefreshToken: 86400,
  },
};
```

#### 2. 用户账户管理

```typescript
findAccount: async (ctx: any, sub: string, token: any) => {
  const accounts = {
    'testuser': {
      accountId: 'testuser',
      async claims(use, scope, claims, rejected) {
        return {
          sub: 'testuser',
          name: 'Test User',
          email: 'test@example.com',
        };
      },
    },
  };
  return accounts[sub];
}
```

#### 3. 自定义交互界面

```typescript
app.get('/interaction/:uid', async (request, reply) => {
  const interaction = await oidc.interactionDetails(request.raw, reply.raw);
  // 生成登录表单 HTML
});

app.post('/interaction/:uid/login', async (request, reply) => {
  const { username, password } = request.body;
  if (username === 'testuser' && password === 'password') {
    await oidc.interactionFinished(request.raw, reply.raw, {
      login: { accountId: username },
    });
  }
});
```

#### 4. Fastify 集成

```typescript
const app = fastify({ logger: true });

async function start() {
  await app.register(middie);
  await app.register(cors, { origin: true });

  const oidc = new Provider('http://localhost:3000', configuration);
  app.use('/oidc', oidc.callback());

  await app.listen({ port: 3000, host: '0.0.0.0' });
}
```

## oidc-provider 使用详解

### 核心概念

1. **Provider** - OIDC 服务器实例
2. **Client** - 注册的客户端应用（如 Gitea）
3. **Interaction** - 用户交互流程（登录、同意等）
4. **Claims** - 用户声明信息
5. **Tokens** - 访问令牌、ID 令牌等

### 配置选项

#### 客户端配置
- `client_id` - 客户端唯一标识
- `client_secret` - 客户端密钥
- `redirect_uris` - 允许的重定向 URI
- `response_types` - 支持的响应类型
- `grant_types` - 支持的授权类型

#### 功能特性
- `devInteractions` - 开发模式交互界面（已禁用，使用自定义）
- `registration` - 动态客户端注册（已禁用）
- `revocation` - 令牌撤销支持

#### 令牌配置
- `ttl` - 各种令牌的生存时间
- `claims` - 支持的声明类型
- `cookies` - Cookie 加密密钥

### 端点说明

- **发现端点**: `/.well-known/openid_configuration`
- **授权端点**: `/oidc/auth`
- **令牌端点**: `/oidc/token`
- **用户信息端点**: `/oidc/userinfo`
- **撤销端点**: `/oidc/revocation`
- **内省端点**: `/oidc/introspect`

### 认证流程

1. **客户端请求授权** → 重定向到 IdP
2. **用户登录** → 自定义交互界面
3. **授权码生成** → 返回给客户端
4. **令牌交换** → 客户端用授权码换取令牌
5. **用户信息获取** → 客户端获取用户详情

## 安装和运行

### 环境要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### 安装依赖

```bash
pnpm install
```

### 编译 TypeScript

```bash
pnpm run build
```

### 启动服务器

```bash
# 开发模式（带热重载）
pnpm run dev

# 生产模式
pnpm run start
```

服务器将在 `http://localhost:3000` 启动

## 测试用户

- **用户名**: `testuser`
- **密码**: `password`
- **用户信息**:
  - sub: `testuser`
  - name: `Test User`
  - email: `test@example.com`

## Gitea 配置

### 1. 启动 Gitea

确保 Gitea 运行在 `http://localhost:3001`（或相应端口）

### 2. 管理员登录

使用管理员账号登录 Gitea

### 3. 配置 OIDC 认证源

1. 进入 **管理面板** → **认证源**
2. 点击 **添加认证源**
3. 填写配置：

#### 基本配置
- **认证类型**: OpenID Connect
- **名称**: `OIDC IdP` (自定义)
- **激活**: ✅ 启用

#### OIDC 配置
- **发现 URL**: `http://localhost:3000/.well-known/openid_configuration`
- **客户端 ID**: `gitea`
- **客户端密钥**: `secret`

#### 高级配置
- **图标 URL**: (可选)
- **跳过本地登录**: ✅ 启用 (如果只使用 OIDC)
- **允许注册**: ✅ 启用 (允许新用户通过 OIDC 注册)

#### 声明映射 (可选)
- **邮箱声明名称**: `email`
- **用户名声明名称**: `preferred_username` (或留空使用邮箱前缀)
- **全名声明名称**: `name`

### 4. 保存配置

点击 **保存** 按钮

### 5. 测试登录

1. 访问 Gitea 登录页面
2. 点击 OIDC 登录按钮
3. 会被重定向到 IdP 登录页面 (`http://localhost:3000/interaction/xxx`)
4. 输入测试用户凭据：
   - 用户名: `testuser`
   - 密码: `password`
5. 登录成功后会自动重定向回 Gitea

## 调试和日志

程序包含详细的调试日志，包括：

- `[OIDC请求]` - 所有 OIDC 相关请求
- `[查询参数]` - 请求参数
- `[请求体]` - POST 请求体
- `[交互页面]` - 用户访问登录页面
- `[交互详情]` - 交互详细信息
- `[登录尝试]` - 登录尝试记录
- `[查找账户]` - 用户查找过程
- `[声明生成]` - JWT 声明生成
- `[返回声明]` - 返回的用户信息

## 生产环境注意事项

### 安全配置

1. **替换签名密钥**:

   ```typescript
   jwks: {
     keys: [/* 你的 RSA 密钥对 */]
   }
   ```

2. **使用强密码**:

   ```typescript
   cookies: {
     keys: ['your-secure-random-key-here']
   }
   ```

3. **HTTPS 强制**:

   ```typescript
   features: {
     tls: { enabled: true }
   }
   ```

### 数据库集成

将硬编码用户替换为数据库查询：

```typescript
findAccount: async (ctx, sub, token) => {
  const user = await db.findUserById(sub);
  if (!user) return undefined;

  return {
    accountId: user.id,
    async claims(use, scope, claims, rejected) {
      return {
        sub: user.id,
        name: user.name,
        email: user.email,
      };
    },
  };
}
```

### 扩展功能

- 添加多租户支持
- 实现同意界面
- 添加 MFA 支持
- 集成外部用户存储
- 支持其他 OIDC 流程

## 许可证

ISC License

## 贡献

欢迎提交 Issue 和 Pull Request！
