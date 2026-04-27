# 插件动态路由开发指南

## 概述

认证插件系统支持插件动态注册自定义路由、静态资源、Webhook 和中间件，使插件能够提供丰富的扩展功能。

---

## 1. 插件路由 (registerRoutes)

### 1.1 基本用法

插件可以注册自定义 API 路由，路径会自动添加 `/auth/:provider` 前缀。

```typescript
class FeishuAuthProvider implements AuthProvider {
  name = 'feishu';
  
  registerRoutes(): PluginRoute[] {
    return [
      {
        method: 'GET',
        path: '/status',
        handler: async (request, reply) => {
          return {
            status: 'active',
            users: await this.getUserCount()
          };
        },
        options: {
          description: '获取飞书认证状态'
        }
      },
      
      {
        method: 'POST',
        path: '/refresh',
        handler: async (request, reply) => {
          const { userId } = request.body as any;
          const newToken = await this.refreshUserToken(userId);
          return { token: newToken };
        },
        options: {
          description: '刷新用户令牌',
          requireAuth: true,
          schema: {
            body: {
              type: 'object',
              required: ['userId'],
              properties: {
                userId: { type: 'string' }
              }
            }
          }
        }
      },
      
      {
        method: 'GET',
        path: '/users',
        handler: async (request, reply) => {
          const users = await this.listUsers();
          return { users };
        },
        options: {
          description: '获取用户列表',
          requireAuth: true
        }
      }
    ];
  }
}
```

### 1.2 实际路由路径

插件注册的路由会被映射为：

```
插件路径: /status
实际路径: GET /auth/feishu/status

插件路径: /refresh
实际路径: POST /auth/feishu/refresh

插件路径: /users
实际路径: GET /auth/feishu/users
```

### 1.3 路由认证

设置 `requireAuth: true` 可以要求请求必须携带有效的认证令牌：

```typescript
{
  method: 'GET',
  path: '/admin/settings',
  handler: async (request, reply) => {
    // 只有管理员可以访问
    return { settings: this.getSettings() };
  },
  options: {
    requireAuth: true,
    roles: ['admin'] // 自定义选项
  }
}
```

### 1.4 请求验证 Schema

使用 Fastify 的 schema 验证请求和响应：

```typescript
{
  method: 'POST',
  path: '/sync-user',
  handler: async (request, reply) => {
    const { openId } = request.body as any;
    const user = await this.syncUserFromFeishu(openId);
    return { user };
  },
  options: {
    schema: {
      body: {
        type: 'object',
        required: ['openId'],
        properties: {
          openId: { type: 'string', minLength: 1 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                sub: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 2. 静态资源 (registerStaticAssets)

### 2.1 基本用法

插件可以提供静态文件，如图标、样式表、脚本等。

```typescript
class FeishuAuthProvider implements AuthProvider {
  registerStaticAssets(): PluginStaticAsset[] {
    return [
      {
        path: '/icon.svg',
        content: `<svg>...</svg>`,
        contentType: 'image/svg+xml'
      },
      
      {
        path: '/style.css',
        content: `
          .feishu-login-btn {
            background: #00b96b;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
          }
        `,
        contentType: 'text/css'
      },
      
      {
        path: '/login.js',
        content: `
          function initFeishuLogin() {
            console.log('Feishu login initialized');
          }
        `,
        contentType: 'application/javascript'
      }
    ];
  }
}
```

### 2.2 从文件加载

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

class FeishuAuthProvider implements AuthProvider {
  registerStaticAssets(): PluginStaticAsset[] {
    const iconPath = join(__dirname, 'assets', 'feishu-icon.svg');
    const stylePath = join(__dirname, 'assets', 'style.css');
    
    return [
      {
        path: '/icon.svg',
        content: readFileSync(iconPath),
        contentType: 'image/svg+xml'
      },
      {
        path: '/style.css',
        content: readFileSync(stylePath, 'utf-8'),
        contentType: 'text/css'
      }
    ];
  }
}
```

### 2.3 访问静态资源

```
实际路径: GET /auth/feishu/icon.svg
实际路径: GET /auth/feishu/style.css
实际路径: GET /auth/feishu/login.js
```

在登录页面中使用：

```html
<link rel="stylesheet" href="/auth/feishu/style.css">
<script src="/auth/feishu/login.js"></script>
<img src="/auth/feishu/icon.svg" alt="Feishu">
```

---

## 3. Webhook (registerWebhooks)

### 3.1 基本用法

Webhook 用于接收外部系统的回调通知。

```typescript
class FeishuAuthProvider implements AuthProvider {
  registerWebhooks(): PluginWebhook[] {
    return [
      {
        path: '/webhook',
        handler: async (request, reply) => {
          const event = request.body as any;
          
          // 处理飞书事件
          switch (event.type) {
            case 'user.created':
              await this.handleUserCreated(event.data);
              break;
            case 'user.updated':
              await this.handleUserUpdated(event.data);
              break;
            case 'user.deleted':
              await this.handleUserDeleted(event.data);
              break;
          }
          
          return { success: true };
        },
        verifySignature: async (request) => {
          // 验证飞书签名
          const signature = request.headers['x-feishu-signature'] as string;
          const timestamp = request.headers['x-feishu-timestamp'] as string;
          const body = JSON.stringify(request.body);
          
          const expectedSignature = this.calculateSignature(
            timestamp,
            body,
            this.config.appSecret
          );
          
          return signature === expectedSignature;
        }
      }
    ];
  }
  
  private calculateSignature(
    timestamp: string,
    body: string,
    secret: string
  ): string {
    const crypto = require('crypto');
    const data = `${timestamp}${body}`;
    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
  }
}
```

### 3.2 Webhook 路径

```
实际路径: POST /auth/feishu/webhook
```

### 3.3 配置飞书 Webhook

在飞书开放平台配置 Webhook URL：

```
https://your-domain.com/auth/feishu/webhook
```

---

## 4. 中间件 (registerMiddleware)

### 4.1 基本用法

插件可以注册 Fastify 中间件，在请求处理前后执行逻辑。

```typescript
class FeishuAuthProvider implements AuthProvider {
  async registerMiddleware(app: FastifyInstance): Promise<void> {
    // 添加请求日志
    app.addHook('preHandler', async (request, reply) => {
      if (request.url.startsWith('/auth/feishu')) {
        console.log(`[Feishu] ${request.method} ${request.url}`);
      }
    });
    
    // 添加响应头
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/auth/feishu')) {
        reply.header('X-Auth-Provider', 'feishu');
      }
      return payload;
    });
    
    // 错误处理
    app.setErrorHandler(async (error, request, reply) => {
      if (request.url.startsWith('/auth/feishu')) {
        console.error(`[Feishu Error]`, error);
        reply.status(500).send({
          error: 'Internal Server Error',
          provider: 'feishu'
        });
      }
    });
  }
}
```

### 4.2 速率限制

```typescript
import rateLimit from '@fastify/rate-limit';

class FeishuAuthProvider implements AuthProvider {
  async registerMiddleware(app: FastifyInstance): Promise<void> {
    await app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      allowList: (request) => {
        // 白名单
        return request.url.startsWith('/auth/feishu/webhook');
      }
    });
  }
}
```

### 4.3 CORS 配置

```typescript
class FeishuAuthProvider implements AuthProvider {
  async registerMiddleware(app: FastifyInstance): Promise<void> {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/auth/feishu')) {
        reply.header('Access-Control-Allow-Origin', 'https://feishu.cn');
        reply.header('Access-Control-Allow-Methods', 'GET, POST');
      }
    });
  }
}
```

---

## 5. 插件元数据 (getMetadata)

### 5.1 基本用法

提供插件的详细信息，用于管理界面展示。

```typescript
class FeishuAuthProvider implements AuthProvider {
  getMetadata(): PluginMetadata {
    return {
      name: 'feishu',
      displayName: '飞书登录',
      version: '1.0.0',
      description: '支持飞书 OAuth 2.0 登录，自动同步用户信息',
      author: 'Your Name',
      homepage: 'https://github.com/your/plugin',
      icon: '/auth/feishu/icon.svg',
      features: [
        'OAuth 2.0 登录',
        '用户信息同步',
        '自动创建用户',
        'Webhook 事件处理'
      ],
      status: {
        initialized: this.initialized,
        healthy: this.isHealthy(),
        message: this.getStatusMessage(),
        stats: {
          totalUsers: this.userCount,
          lastSync: this.lastSyncTime,
          apiCalls: this.apiCallCount
        }
      }
    };
  }
  
  private isHealthy(): boolean {
    // 检查插件健康状态
    return this.initialized && this.oauthClient.isConnected();
  }
  
  private getStatusMessage(): string {
    if (!this.initialized) {
      return '未初始化';
    }
    if (!this.isHealthy()) {
      return '连接失败';
    }
    return '运行正常';
  }
}
```

### 5.2 管理 API

系统会自动提供管理 API：

```
GET /admin/plugins
返回所有插件的元数据

GET /admin/plugins/:provider
返回指定插件的详细信息
```

---

## 6. 完整示例：飞书插件

```typescript
import type {
  AuthProvider,
  AuthContext,
  AuthResult,
  PluginRoute,
  PluginStaticAsset,
  PluginWebhook,
  PluginMetadata
} from '../types/auth';
import { FastifyInstance } from 'fastify';

export class FeishuAuthProvider implements AuthProvider {
  name = 'feishu';
  displayName = '飞书登录';
  
  private config: any;
  private initialized = false;
  private userCount = 0;
  
  async initialize(config: any): Promise<void> {
    this.config = config.config;
    this.initialized = true;
  }
  
  // 核心认证方法
  canHandle(context: AuthContext): boolean {
    return context.authMethod === this.name;
  }
  
  async renderLoginUI(context: AuthContext) {
    return {
      type: 'redirect' as const,
      redirectUrl: this.buildAuthUrl(context.interactionUid),
      showInUnifiedPage: true,
      button: {
        text: '使用飞书登录',
        icon: '/auth/feishu/icon.svg',
        style: 'background: #00b96b; color: white;'
      }
    };
  }
  
  async authenticate(context: AuthContext): Promise<AuthResult> {
    // 实现认证逻辑
    return { success: true, userId: 'user123' };
  }
  
  async getUserInfo(userId: string) {
    return null;
  }
  
  // 动态路由
  registerRoutes(): PluginRoute[] {
    return [
      {
        method: 'GET',
        path: '/status',
        handler: async (request, reply) => {
          return {
            status: 'active',
            users: this.userCount
          };
        }
      },
      
      {
        method: 'POST',
        path: '/sync',
        handler: async (request, reply) => {
          const { openId } = request.body as any;
          const user = await this.syncUser(openId);
          return { user };
        },
        options: {
          requireAuth: true,
          schema: {
            body: {
              type: 'object',
              required: ['openId'],
              properties: {
                openId: { type: 'string' }
              }
            }
          }
        }
      }
    ];
  }
  
  // 静态资源
  registerStaticAssets(): PluginStaticAsset[] {
    return [
      {
        path: '/icon.svg',
        content: `<svg>...</svg>`,
        contentType: 'image/svg+xml'
      }
    ];
  }
  
  // Webhook
  registerWebhooks(): PluginWebhook[] {
    return [
      {
        path: '/webhook',
        handler: async (request, reply) => {
          const event = request.body as any;
          await this.handleEvent(event);
          return { success: true };
        },
        verifySignature: async (request) => {
          return this.verifyFeishuSignature(request);
        }
      }
    ];
  }
  
  // 中间件
  async registerMiddleware(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', async (request, reply) => {
      if (request.url.startsWith('/auth/feishu')) {
        console.log(`[Feishu] ${request.method} ${request.url}`);
      }
    });
  }
  
  // 元数据
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
        initialized: this.initialized,
        healthy: true,
        stats: { users: this.userCount }
      }
    };
  }
  
  // 辅助方法
  private buildAuthUrl(state: string): string {
    return `https://open.feishu.cn/open-apis/authen/v1/authorize?...`;
  }
  
  private async syncUser(openId: string) {
    this.userCount++;
    return { sub: openId, name: 'User' };
  }
  
  private async handleEvent(event: any) {
    console.log('Feishu event:', event);
  }
  
  private verifyFeishuSignature(request: any): boolean {
    return true; // 实现签名验证
  }
}
```

---

## 7. AuthCoordinator 集成

AuthCoordinator 会自动注册插件的路由：

```typescript
class AuthCoordinator {
  async registerProvider(provider: AuthProvider): Promise<void> {
    this.providers.set(provider.name, provider);
    
    // 注册路由
    if (provider.registerRoutes) {
      const routes = provider.registerRoutes();
      routes.forEach(route => {
        const fullPath = `/auth/${provider.name}${route.path}`;
        this.app[route.method.toLowerCase()](fullPath, route.handler);
      });
    }
    
    // 注册静态资源
    if (provider.registerStaticAssets) {
      const assets = provider.registerStaticAssets();
      assets.forEach(asset => {
        const fullPath = `/auth/${provider.name}${asset.path}`;
        this.app.get(fullPath, async (request, reply) => {
          reply
            .type(asset.contentType || 'text/plain')
            .send(asset.content);
        });
      });
    }
    
    // 注册 Webhook
    if (provider.registerWebhooks) {
      const webhooks = provider.registerWebhooks();
      webhooks.forEach(webhook => {
        const fullPath = `/auth/${provider.name}${webhook.path}`;
        this.app.post(fullPath, async (request, reply) => {
          // 验证签名
          if (webhook.verifySignature) {
            const valid = await webhook.verifySignature(request);
            if (!valid) {
              return reply.code(401).send({ error: 'Invalid signature' });
            }
          }
          return webhook.handler(request, reply);
        });
      });
    }
    
    // 注册中间件
    if (provider.registerMiddleware) {
      await provider.registerMiddleware(this.app);
    }
  }
}
```

---

## 8. 使用场景

### 8.1 管理界面

```typescript
// 获取所有插件状态
GET /admin/plugins

// 获取特定插件信息
GET /admin/plugins/feishu

// 刷新插件配置
POST /admin/plugins/feishu/reload
```

### 8.2 用户同步

```typescript
// 手动同步用户
POST /auth/feishu/sync
{
  "openId": "ou_xxx"
}

// 批量同步
POST /auth/feishu/sync-all
```

### 8.3 监控和统计

```typescript
// 获取认证统计
GET /auth/feishu/stats

// 获取健康状态
GET /auth/feishu/health
```

---

## 9. 最佳实践

### 9.1 路由命名

- 使用 RESTful 风格
- 路径清晰明确
- 避免与核心路由冲突

### 9.2 错误处理

```typescript
{
  method: 'POST',
  path: '/action',
  handler: async (request, reply) => {
    try {
      const result = await this.doAction();
      return { success: true, result };
    } catch (error) {
      reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  }
}
```

### 9.3 安全性

- 验证所有输入
- 使用 schema 验证
- 实施速率限制
- 验证 Webhook 签名
- 使用 HTTPS

### 9.4 性能

- 缓存频繁访问的数据
- 使用异步操作
- 避免阻塞主线程
- 实施请求超时

---

## 10. 调试

### 10.1 查看注册的路由

```bash
# 启动服务器后，所有路由会被打印
npm run dev

# 输出示例：
# [Feishu] Registered route: GET /auth/feishu/status
# [Feishu] Registered route: POST /auth/feishu/sync
# [Feishu] Registered static: GET /auth/feishu/icon.svg
# [Feishu] Registered webhook: POST /auth/feishu/webhook
```

### 10.2 测试路由

```bash
# 测试状态接口
curl http://localhost:3000/auth/feishu/status

# 测试同步接口
curl -X POST http://localhost:3000/auth/feishu/sync \
  -H "Content-Type: application/json" \
  -d '{"openId": "ou_xxx"}'

# 获取静态资源
curl http://localhost:3000/auth/feishu/icon.svg
```

---

通过这些扩展能力，插件可以提供完整的功能，而不仅仅是认证逻辑！
