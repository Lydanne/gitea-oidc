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
    trustedProxyIps: [],
    corsOrigins: [],
  },
  logging: {
    enabled: true,
    level: 'info',
  },
  oidc: {
    issuer: 'http://localhost:4000/oidc',
    cookieKeys: [
      'dev-cookie-key-at-least-32-chars-1',
      'dev-cookie-key-at-least-32-chars-2',
    ],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
    claims: {
      openid: ['sub'],
      profile: [
        'name',
        'preferred_username',
        'email',
        'picture',
        'groups',
        'groups_tree',
        'roles',
        'status',
      ],
      provider_api: [],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
    },
  },
  clients: [{
    client_id: 'my-app',
    client_secret: 'my-client-secret-at-least-32-chars',
    redirect_uris: [
      'http://localhost:8080/callback',
      'http://localhost:4000/admin/callback',
    ],
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'client_secret_basic',
  }],
  auth: {
    autoRedirectSingleProvider: false,
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
    stateStore: { type: 'memory' },
  },
  admin: {
    enabled: true,
    basePath: '/admin',
    allowedGroups: ['gitea-oidc-admins'],
    sessionTtlSeconds: 3600,
  },
  audit: {
    enabled: true,
    retentionDays: 30,
  },
  providerApi: {
    enabled: false,
    tokenEncryptionKey: 'provider-token-key-at-least-32-chars',
    refreshSkewSeconds: 300,
    probeIntervalSeconds: 300,
    requestTimeoutMs: 10000,
    responseBodyLimitBytes: 1048576,
    sdkProxy: true,
    allowedClientIds: [],
    providers: {},
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

传入 `customConfig` 时也会执行和配置文件一致的 Zod 校验与生产环境安全校验。
如果 `NODE_ENV=production`，HTTP 公网 URL、memory 仓储、弱 `oidc.cookieKeys`、
短或默认 `clients[].client_secret`、缺失 `providerApi.allowedClientIds` 等不安全配置会直接
阻止启动。`start()` 会抛出错误而不是调用 `process.exit()`，因此宿主应用可以记录错误并决定
自己的退出策略；调用方应在停止服务时执行 `await app.close()` 释放仓储、定时器和 OIDC 连接。
直接传入的 `customConfig` 应是完整配置；它不会像配置文件路径一样先与开发默认配置深度合并。

#### 示例 2: 使用配置文件

```typescript
import { start } from 'gitea-oidc/server';

// 不传入配置参数，会自动从以下位置加载配置：
// 1. gitea-oidc.config.js (优先)
// 2. gitea-oidc.config.json (备选)
// 3. 没有配置文件时使用开发默认配置
const app = await start();
console.log('OIDC 服务器已启动');
```

如果配置文件存在但无法加载、解析或通过校验，服务会直接启动失败，不会回退到默认配置。

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
      trustedProxyIps: (process.env.TRUSTED_PROXY_IPS || '').split(',').filter(Boolean),
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

请参考 `packages/server-core/src/config.ts` 中的 `GiteaOidcConfig` 接口定义，了解所有可配置选项。

### 关键配置项

- **server.url**: 对外访问的服务根地址，例如 `https://idp.example.com`，不能包含 query 或
  fragment
- **oidc.issuer**: 对外访问的 OIDC 发行者地址，必须等于 `${server.url}/oidc`，不能包含 query
  或 fragment
- **server.trustProxy**: 在反向代理（Nginx/Traefik）后必须设置为 `true`
- **oidc.cookieKeys**: 生产环境必须使用强密钥，建议使用多个密钥支持密钥轮换
- **clients**: 配置允许使用此 IdP 的客户端应用
- **auth.providers**: 配置启用的认证方式
- **auth.autoRedirectSingleProvider**: 只有一个可跳转登录方式时是否直接进入，默认关闭
- **audit.enabled**: 是否记录登录、退出和用户资料变更审计，默认启用
- **audit.retentionDays**: 审计记录保留天数，默认 `30`，范围 `1` 到 `3650`；超过期限的记录自动删除

### 单一登录方式自动跳转

只有一个 OAuth 登录入口时，可以跳过统一登录页：

```javascript
export default {
  auth: {
    autoRedirectSingleProvider: true,
    // userRepository、providers 和 stateStore 保持原配置
  },
};
```

服务端仅在最终可用的登录方式恰好为一个，且该方式提供安全的 HTTP(S) 或站内跳转地址时返回
`302`。本地用户名密码表单、多个登录入口、不可用入口和非法跳转地址仍会显示统一登录页。

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

## 用户到 Claim 的转换

`userToClaims()` 是统一的用户 Claim 投影入口。内部用户的 `groups` 保存对象树；转换结果中的
`groups` 是兼容 Gitea 的完整名称路径和 ID 路径字符串数组，`groups_tree` 保留完整层级。

```typescript
import { userToClaims } from 'gitea-oidc';
import type { UserInfo } from 'gitea-oidc';

const user: UserInfo = {
  id: '6a8706b9-c93d-4f4e-a5ad-6d5f0808df47',
  sub: 'user-1',
  username: 'alice',
  name: 'Alice',
  email: 'alice@example.com',
  authProvider: 'feishu',
  externalId: 'ou_example',
  groups: [
    { id: 'Default', name: 'Default' },
    {
      id: 'tenant_example',
      name: '示例组织',
      children: [
        {
          id: 'engineering',
          name: '研发中心',
          children: [{ id: 'backend', name: '后端组' }],
        },
      ],
    },
  ],
};

const claims = userToClaims(user);
// claims.groups:
// [
//   'Default',
//   '示例组织',
//   'tenant_example',
//   '示例组织/研发中心',
//   'tenant_example/engineering',
//   '示例组织/研发中心/后端组',
//   'tenant_example/engineering/backend',
// ]
// claims.groups_tree:
// user.groups 的完整树形结构
```

每个树节点都会生成从根节点到该节点的名称路径和 ID 路径。权限配置 `admin.allowedGroups` 可以
使用完整路径，也可以继续填写任一节点的 `id` 或 `name`。旧数据库里的
`groups: string[]` 不再转换，读取时按空分组处理；用户下次成功登录时，Provider 会用对象树
重新写入 `groups`。

`id` 是用户表内部保存的随机 UUID。新用户在创建时生成，SQLite 和 PostgreSQL 会在启动时
为缺失该字段的现有用户回填。当前查询主键、OIDC `sub`、管理 API 和 `userToClaims()` 都不使用它。

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
- 如果配置文件存在，加载、解析和校验失败都会阻止启动
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
- [认证插件开发](./dev/PLUGIN_ROUTES_GUIDE.md)
- [生产环境配置](./PRODUCTION_SETUP.md)
