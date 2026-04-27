# Gitea OIDC 认证插件系统设计文档

## 1. 概述

### 1.1 目标

设计一个可扩展的认证插件系统，支持多种国内外登录方式：

- 本地密码认证（htpasswd 格式）
- 飞书 OAuth 登录
- 企业微信登录
- 钉钉登录
- LDAP/AD 认证
- 其他自定义认证方式

### 1.2 设计原则

- **开放封闭原则**：对扩展开放，对修改封闭
- **插件化架构**：新增认证方式无需修改核心代码
- **配置驱动**：通过配置文件启用/禁用插件
- **统一接口**：所有认证插件实现相同接口
- **独立性**：插件之间互不影响，可独立开发和测试

---

## 2. 核心架构

### 2.1 系统分层

```
┌─────────────────────────────────────────────┐
│           OIDC Provider (oidc-provider)     │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│         认证协调器 (AuthCoordinator)         │
│  - 管理多个认证插件                          │
│  - 路由认证请求到对应插件                     │
│  - 统一用户身份映射                          │
└─────────────────────────────────────────────┘
                      ↓
┌──────────────┬──────────────┬──────────────┐
│ LocalAuth    │ FeishuAuth   │ CustomAuth   │
│ Plugin       │ Plugin       │ Plugin       │
└──────────────┴──────────────┴──────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│         用户仓储层 (UserRepository)          │
│  - 内存存储                                  │
│  - 数据库存储                                │
│  - 外部 API                                  │
└─────────────────────────────────────────────┘
```

### 2.2 核心接口定义

#### 2.2.1 AuthProvider 核心方法

- `initialize()`: 插件初始化
- `canHandle()`: 判断是否处理该请求
- `renderLoginUI()`: 渲染登录界面
- `authenticate()`: 执行认证逻辑
- `getUserInfo()`: 获取用户信息

#### 2.2.2 AuthProvider 扩展能力（可选）

- `registerRoutes()`: 注册自定义 API 路由
- `registerStaticAssets()`: 注册静态资源（图标、样式等）
- `registerWebhooks()`: 注册 Webhook 接收外部回调
- `registerMiddleware()`: 注册 Fastify 中间件
- `getMetadata()`: 返回插件元数据
- `destroy()`: 清理资源

详见附录 A：完整的 TypeScript 接口定义

---

## 3. 认证协调器 (AuthCoordinator)

### 3.1 职责

- 管理所有认证插件的生命周期
- 路由认证请求到对应插件
- 渲染统一登录页面
- 统一用户身份映射

### 3.2 认证流程

```
用户访问 /interaction/:uid
         ↓
AuthCoordinator.renderUnifiedLoginPage()
         ↓
显示所有可用的登录方式
         ↓
用户选择登录方式并提交
         ↓
AuthCoordinator.handleAuthentication()
         ↓
根据 authMethod 路由到对应插件
         ↓
Plugin.authenticate()
         ↓
返回 AuthResult
         ↓
AuthCoordinator 完成 OIDC 交互
```

---

## 4. 内置插件设计

### 4.1 本地密码认证插件 (LocalAuthProvider)

#### 功能特性

- 支持用户名/密码登录
- 支持 htpasswd 格式密码文件
- 支持 bcrypt、MD5、SHA 等多种哈希算法
- 可选：支持密码策略（长度、复杂度）

#### 配置示例

```json
{
  "authProviders": {
    "local": {
      "enabled": true,
      "displayName": "本地密码登录",
      "config": {
        "passwordFile": "/path/to/.htpasswd",
        "passwordFormat": "bcrypt"
      }
    }
  }
}
```

#### htpasswd 格式支持

```
# bcrypt 格式
user1:$2y$05$hash...

# MD5 格式
user2:$apr1$salt$hash...

# SHA 格式
user3:{SHA}base64hash...
```

### 4.2 飞书认证插件 (FeishuAuthProvider)

#### 功能特性

- 支持飞书 OAuth 2.0 登录
- 自动获取用户信息（姓名、邮箱、头像）
- 支持企业内部应用和自建应用

#### 配置示例

```json
{
  "authProviders": {
    "feishu": {
      "enabled": true,
      "displayName": "飞书登录",
      "config": {
        "appId": "cli_xxx",
        "appSecret": "xxx",
        "redirectUri": "http://localhost:3000/auth/feishu/callback",
        "scope": "contact:user.base:readonly"
      }
    }
  }
}
```

#### OAuth 流程

```
用户点击"飞书登录"
         ↓
重定向到飞书授权页面
         ↓
用户授权
         ↓
飞书回调 /auth/feishu/callback?code=xxx
         ↓
Plugin.handleCallback()
         ↓
用 code 换取 access_token
         ↓
获取用户信息
         ↓
创建/更新本地用户
         ↓
完成 OIDC 交互
```

---

## 5. 用户仓储层 (UserRepository)

### 5.1 接口定义

提供统一的用户数据访问接口：

- `findById(userId)`: 根据 ID 查找用户
- `findByUsername(username)`: 根据用户名查找
- `create(user)`: 创建用户
- `update(userId, updates)`: 更新用户
- `delete(userId)`: 删除用户

### 5.2 内置实现

#### 内存存储 (MemoryUserRepository)

- 适用于开发和测试
- 数据不持久化

#### 配置文件存储 (ConfigUserRepository)

- 从配置文件读取用户
- 只读，不支持动态创建

#### 数据库存储 (DatabaseUserRepository)

- 支持 SQLite、PostgreSQL、MySQL
- 完整的 CRUD 操作

---

## 6. 配置文件结构

### 6.1 完整配置示例

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "http://localhost:3000"
  },
  
  "auth": {
    "userRepository": {
      "type": "memory",
      "config": {}
    },
    
    "providers": {
      "local": {
        "enabled": true,
        "displayName": "本地密码",
        "priority": 1,
        "config": {
          "passwordFile": ".htpasswd",
          "passwordFormat": "bcrypt"
        }
      },
      
      "feishu": {
        "enabled": true,
        "displayName": "飞书登录",
        "priority": 2,
        "config": {
          "appId": "cli_xxx",
          "appSecret": "xxx",
          "redirectUri": "http://localhost:3000/auth/feishu/callback"
        }
      }
    }
  }
}
```

---

## 7. 统一登录页面

### 7.1 UI 设计

动态渲染所有启用的认证方式：

- 本地密码登录表单
- 第三方登录按钮（飞书、企业微信等）
- 现代化、响应式设计

### 7.2 路由设计

```
GET  /interaction/:uid
     → 显示统一登录页面

POST /interaction/:uid/auth/:provider
     → 处理指定插件的认证请求

GET  /auth/:provider/callback
     → 处理 OAuth 回调
```

---

## 8. 插件动态路由和扩展

### 8.1 动态路由注册

插件可以注册自定义 API 路由，提供额外的功能接口。

#### 示例：飞书插件注册路由

```typescript
class FeishuAuthProvider implements AuthProvider {
  registerRoutes(): PluginRoute[] {
    return [
      {
        method: 'GET',
        path: '/status',
        handler: async (request, reply) => {
          return { status: 'active', users: this.userCount };
        }
      },
      {
        method: 'POST',
        path: '/sync',
        handler: async (request, reply) => {
          const { openId } = request.body;
          const user = await this.syncUser(openId);
          return { user };
        },
        options: {
          requireAuth: true,
          schema: { /* Fastify schema */ }
        }
      }
    ];
  }
}
```

#### 路由路径映射

```
插件路径: /status
实际路径: GET /auth/feishu/status

插件路径: /sync
实际路径: POST /auth/feishu/sync
```

### 8.2 静态资源

插件可以提供静态文件（图标、样式、脚本）。

```typescript
registerStaticAssets(): PluginStaticAsset[] {
  return [
    {
      path: '/icon.svg',
      content: '<svg>...</svg>',
      contentType: 'image/svg+xml'
    },
    {
      path: '/style.css',
      content: '.feishu-btn { background: #00b96b; }',
      contentType: 'text/css'
    }
  ];
}
```

访问路径：`/auth/feishu/icon.svg`

### 8.3 Webhook 支持

接收外部系统的事件通知。

```typescript
registerWebhooks(): PluginWebhook[] {
  return [
    {
      path: '/webhook',
      handler: async (request, reply) => {
        const event = request.body;
        await this.handleEvent(event);
        return { success: true };
      },
      verifySignature: async (request) => {
        // 验证签名防止伪造
        return this.verifyFeishuSignature(request);
      }
    }
  ];
}
```

### 8.4 中间件注册

插件可以注册 Fastify 中间件。

```typescript
async registerMiddleware(app: FastifyInstance): Promise<void> {
  // 请求日志
  app.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/auth/feishu')) {
      console.log(`[Feishu] ${request.method} ${request.url}`);
    }
  });
  
  // 速率限制
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });
}
```

### 8.5 插件元数据

提供插件详细信息，用于管理界面。

```typescript
getMetadata(): PluginMetadata {
  return {
    name: 'feishu',
    displayName: '飞书登录',
    version: '1.0.0',
    description: '飞书 OAuth 2.0 认证插件',
    author: 'Your Name',
    icon: '/auth/feishu/icon.svg',
    features: ['OAuth 2.0', 'User Sync', 'Webhooks'],
    status: {
      initialized: true,
      healthy: true,
      stats: { users: 100 }
    }
  };
}
```

### 8.6 使用场景

#### 管理 API

```
GET  /auth/:provider/status    - 获取插件状态
POST /auth/:provider/sync      - 同步用户
GET  /auth/:provider/users     - 获取用户列表
```

#### 监控和统计

```
GET /auth/:provider/stats      - 获取统计信息
GET /auth/:provider/health     - 健康检查
```

#### Webhook 回调

```
POST /auth/:provider/webhook   - 接收外部事件
```

详见 `PLUGIN_ROUTES_GUIDE.md` 获取完整的开发指南。

---

## 9. 插件开发指南

### 9.1 创建自定义插件

#### 步骤 1: 实现 AuthProvider 接口

```typescript
export class CustomAuthProvider implements AuthProvider {
  name = 'custom';
  displayName = '自定义认证';
  
  async initialize(config: any) { }
  async authenticate(context: AuthContext): Promise<AuthResult> { }
  async getUserInfo(userId: string) { }
}
```

#### 步骤 2: 注册插件

```typescript
authCoordinator.registerProvider(new CustomAuthProvider());
```

#### 步骤 3: 配置插件

```json
{
  "auth": {
    "providers": {
      "custom": {
        "enabled": true,
        "config": { }
      }
    }
  }
}
```

---

## 10. 安全考虑

### 10.1 认证安全

- 密码使用 bcrypt 等强哈希算法
- 生产环境必须使用 HTTPS
- 实施速率限制防止暴力破解

### 10.2 OAuth 安全

- 使用 state 参数防止 CSRF
- 验证 redirect URI
- 安全存储 access token

### 10.3 插件路由安全

- **输入验证**：使用 Fastify schema 验证所有输入
- **认证授权**：设置 `requireAuth: true` 保护敏感接口
- **速率限制**：防止 API 滥用
- **Webhook 签名**：验证外部回调的真实性
- **CORS 配置**：限制跨域访问

---

## 11. 实施计划

### Phase 1: 核心框架（1-2 周）

- [ ] 定义核心接口
- [ ] 实现 AuthCoordinator
- [ ] 实现 UserRepository 基础接口
- [ ] 重构现有认证逻辑

### Phase 2: 本地认证插件（1 周）

- [ ] 实现 LocalAuthProvider
- [ ] 支持 htpasswd 格式
- [ ] 密码验证逻辑

### Phase 3: 飞书认证插件（1-2 周）

- [ ] 实现 FeishuAuthProvider
- [ ] OAuth 流程集成
- [ ] 用户信息同步

### Phase 4: UI 和测试（1 周）

- [ ] 统一登录页面
- [ ] 插件开发文档
- [ ] 单元测试和集成测试

---

## 附录 A: TypeScript 接口定义

详见 `src/types/auth.ts`
