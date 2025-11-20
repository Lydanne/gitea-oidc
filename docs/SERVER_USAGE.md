# Server 使用指南

本文档说明如何使用 `server.ts` 的两种方式。

## 方式 1: 直接启动（推荐用于独立部署）

当你直接运行 `server.ts` 文件时，服务器会自动启动并从配置文件加载配置。

### 开发模式

```bash
pnpm dev
```

这会使用 `tsx watch` 启动服务器，支持热重载。

### 生产模式

```bash
pnpm build
pnpm start
```

这会先构建项目，然后运行构建后的代码。

## 方式 2: 作为模块导入（推荐用于集成到其他项目）

当你需要在其他项目中集成此 OIDC 服务器时，可以将其作为模块导入。

### 安装

```bash
npm install gitea-oidc
# 或
pnpm add gitea-oidc
```

### 使用示例

#### 示例 1: 使用自定义配置

```typescript
import { start } from 'gitea-oidc/server';
import type { GiteaOidcConfig } from 'gitea-oidc/config';

const customConfig: GiteaOidcConfig = {
  server: {
    host: '0.0.0.0',
    port: 4000,
    url: 'http://localhost:4000',
    trustProxy: false,
  },
  logging: {
    enabled: true,
    level: 'info',
  },
  oidc: {
    issuer: 'http://localhost:4000',
    cookieKeys: ['your-secret-key-here'],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
    claims: {
      openid: ['sub'],
      profile: ['name', 'email', 'picture'],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
    },
  },
  clients: [{
    client_id: 'my-app',
    client_secret: 'my-secret',
    redirect_uris: ['http://localhost:8080/callback'],
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'client_secret_basic',
  }],
  auth: {
    userRepository: {
      type: 'memory',
      memory: {},
    },
    providers: {
      local: {
        enabled: true,
        displayName: '本地密码',
        priority: 1,
        config: {
          passwordFile: '.htpasswd',
          passwordFormat: 'bcrypt',
        },
      },
    },
  },
  adapter: {
    type: 'sqlite',
    sqlite: {
      dbPath: './oidc.db',
    },
  },
};

// 启动服务器
const app = await start(customConfig);
console.log('OIDC 服务器已启动');
```

#### 示例 2: 使用配置文件

```typescript
import { start } from 'gitea-oidc/server';

// 不传入配置参数，会自动从以下位置加载配置：
// 1. gitea-oidc.config.js (优先)
// 2. gitea-oidc.config.json (备选)
// 3. 默认配置 (兜底)
const app = await start();
console.log('OIDC 服务器已启动');
```

#### 示例 3: 集成到现有 Express/Fastify 应用

```typescript
import { start } from 'gitea-oidc/server';
import type { GiteaOidcConfig } from 'gitea-oidc/config';

// 在你的应用中启动 OIDC 服务器
async function setupOIDC() {
  const config: Partial<GiteaOidcConfig> = {
    server: {
      host: '0.0.0.0',
      port: 3000,
      url: process.env.OIDC_ISSUER_URL || 'http://localhost:3000',
      trustProxy: process.env.NODE_ENV === 'production',
    },
    // ... 其他配置
  };

  try {
    const oidcApp = await start(config as GiteaOidcConfig);
    console.log('✅ OIDC 服务器已启动');
    return oidcApp;
  } catch (error) {
    console.error('❌ OIDC 服务器启动失败:', error);
    throw error;
  }
}

// 在应用启动时调用
setupOIDC();
```

## 配置说明

### 完整配置接口

请参考 `src/config.ts` 中的 `GiteaOidcConfig` 接口定义，了解所有可配置选项。

### 关键配置项

- **server.url**: 必须与 `oidc.issuer` 保持一致
- **server.trustProxy**: 在反向代理（Nginx/Traefik）后必须设置为 `true`
- **oidc.cookieKeys**: 生产环境必须使用强密钥，建议使用多个密钥支持密钥轮换
- **clients**: 配置允许使用此 IdP 的客户端应用
- **auth.providers**: 配置启用的认证方式

## 返回值

`start()` 函数返回一个 Fastify 应用实例，你可以：

- 访问应用的所有 Fastify API
- 添加额外的路由或中间件
- 监听应用事件
- 优雅关闭应用

```typescript
const app = await start(config);

// 添加自定义路由
app.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// 优雅关闭
process.on('SIGTERM', async () => {
  await app.close();
});
```

## 注意事项

1. **端口冲突**: 确保配置的端口未被占用
2. **配置验证**: 配置会自动验证，如果验证失败会抛出错误
3. **日志输出**: 通过 `logging.enabled` 和 `logging.level` 控制日志详细程度
4. **生产环境**: 务必使用强密钥、启用 HTTPS、配置 `trustProxy`

## 故障排查

### 问题 1: 服务器启动失败

检查：

- 端口是否被占用
- 配置文件格式是否正确
- 依赖是否完整安装

### 问题 2: 配置未生效

检查：

- 配置文件路径是否正确
- 配置文件格式（JS 优先级高于 JSON）
- 配置项是否拼写正确

### 问题 3: 认证失败

检查：

- 客户端配置是否正确
- redirect_uris 是否匹配
- 用户仓储配置是否正确
- 认证提供者是否启用

## 更多信息

- [完整配置示例](../example.gitea-oidc.config.json)
- [认证插件开发](./PLUGIN_ROUTES_GUIDE.md)
- [生产环境配置](./PRODUCTION_SETUP.md)
