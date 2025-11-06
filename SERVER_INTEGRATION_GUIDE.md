# Server.ts 集成指南

本文档说明如何将新的认证插件系统集成到现有的 `src/server.ts` 中。

## 步骤 1: 导入依赖

在 `src/server.ts` 顶部添加导入：

```typescript
// 认证系统导入
import { AuthCoordinator } from './core/AuthCoordinator.js';
import { MemoryStateStore } from './stores/MemoryStateStore.js';
import { MemoryUserRepository } from './repositories/MemoryUserRepository.js';
import { LocalAuthProvider } from './providers/LocalAuthProvider.js';
import { FeishuAuthProvider } from './providers/FeishuAuthProvider.js';
import type { AuthContext } from './types/auth.js';
import type { ExtendedGiteaOidcConfig } from './types/config.js';
```

## 步骤 2: 初始化认证系统

在创建 Fastify 实例后，OIDC Provider 之前添加：

```typescript
// 加载配置（假设已经加载为 config）
const config = loadConfig() as ExtendedGiteaOidcConfig;

// 初始化存储层
app.log.info('Initializing auth system...');

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
  app.log.info('Registered LocalAuthProvider');
}

if (config.auth.providers.feishu?.enabled) {
  const feishuProvider = new FeishuAuthProvider(userRepository, authCoordinator);
  authCoordinator.registerProvider(feishuProvider);
  app.log.info('Registered FeishuAuthProvider');
}

// 初始化所有插件
await authCoordinator.initialize();
app.log.info('Auth system initialized successfully');
```

## 步骤 3: 修改 OIDC Provider 配置

修改 `findAccount` 方法以使用新的用户仓储：

```typescript
const oidc = new Provider(config.server.url, {
  // ... 其他配置 ...
  
  async findAccount(ctx, id) {
    // 使用 AuthCoordinator 查找用户
    const user = await authCoordinator.findAccount(id);
    
    if (!user) {
      return undefined;
    }
    
    return {
      accountId: user.sub,
      async claims(use, scope, claims, rejected) {
        return {
          sub: user.sub,
          name: user.name,
          email: user.email,
          email_verified: user.emailVerified || false,
          picture: user.avatar,
          phone: user.phone,
          phone_verified: user.phoneVerified || false,
          updated_at: user.updatedAt ? Math.floor(user.updatedAt.getTime() / 1000) : undefined,
        };
      },
    };
  },
  
  // ... 其他配置 ...
});
```

## 步骤 4: 修改交互路由

### 4.1 登录页面路由

替换现有的 `GET /interaction/:uid` 路由：

```typescript
app.get('/interaction/:uid', async (request, reply) => {
  try {
    const details = await oidc.interactionDetails(request.raw, reply.raw);
    
    // 创建认证上下文
    const context: AuthContext = {
      interactionUid: request.params.uid,
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
    app.log.error({ err }, 'Failed to render login page');
    return reply.code(500).send('Internal Server Error');
  }
});
```

### 4.2 登录处理路由

替换现有的 `POST /interaction/:uid/login` 路由：

```typescript
app.post('/interaction/:uid/login', async (request, reply) => {
  try {
    const body = request.body as Record<string, any>;
    
    // 创建认证上下文
    const context: AuthContext = {
      interactionUid: request.params.uid,
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
      // 认证成功，完成 OIDC 交互
      await oidc.interactionFinished(
        request.raw,
        reply.raw,
        {
          login: {
            accountId: result.userId,
          },
        },
        { mergeWithLastSubmission: false }
      );
    } else {
      // 认证失败，重定向回登录页面并显示错误
      const errorMessage = encodeURIComponent(result.error || '认证失败');
      return reply.redirect(`/interaction/${request.params.uid}?error=${errorMessage}`);
    }
  } catch (err) {
    app.log.error({ err }, 'Authentication error');
    return reply.redirect(`/interaction/${request.params.uid}?error=${encodeURIComponent('系统错误，请稍后重试')}`);
  }
});
```

### 4.3 添加飞书回调成功处理路由

添加新路由处理飞书登录成功后的跳转：

```typescript
app.get('/interaction/:uid/feishu-success', async (request, reply) => {
  try {
    const { userId } = request.query as { userId: string };
    
    if (!userId) {
      return reply.redirect(`/interaction/${request.params.uid}?error=${encodeURIComponent('用户ID缺失')}`);
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
  } catch (err) {
    app.log.error({ err }, 'Failed to complete Feishu login');
    return reply.redirect(`/interaction/${request.params.uid}?error=${encodeURIComponent('登录失败')}`);
  }
});
```

## 步骤 5: 添加优雅关闭

在服务器关闭时清理资源：

```typescript
// 在 server 启动代码之后添加
const shutdown = async () => {
  app.log.info('Shutting down...');
  
  // 销毁认证系统
  await authCoordinator.destroy();
  stateStore.destroy();
  
  // 关闭 Fastify
  await app.close();
  
  app.log.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## 步骤 6: 更新 package.json 脚本

添加测试脚本：

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
    "test:watch": "node --experimental-vm-modules node_modules/jest/bin/jest.js --watch",
    "test:coverage": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage"
  }
}
```

## 步骤 7: 创建 .htpasswd 文件

使用 `htpasswd` 工具或在线生成器创建密码文件：

```bash
# 使用 htpasswd 工具（需要安装 apache2-utils）
htpasswd -nbB admin password123 > .htpasswd

# 或使用 Node.js 脚本
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync('password123', 10));" > .htpasswd
```

示例 `.htpasswd` 内容：

```
admin:$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
user1:$2b$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQ
```

## 步骤 8: 运行测试

```bash
# 运行所有测试
pnpm test

# 运行测试并查看覆盖率
pnpm test:coverage

# 监听模式
pnpm test:watch
```

## 步骤 9: 启动服务器

```bash
# 开发模式
pnpm dev

# 生产模式
pnpm build
pnpm start
```

## 完整的 server.ts 示例

参考 `src/server-with-auth.ts.example` 查看完整的集成示例。

## 配置文件

使用新的配置文件 `gitea-oidc-auth.config.json`：

```bash
cp gitea-oidc-auth.config.json gitea-oidc.config.json
```

然后根据需要修改配置：

1. **本地密码认证**：
   - 设置 `auth.providers.local.enabled = true`
   - 创建 `.htpasswd` 文件
   - 配置密码策略（可选）

2. **飞书认证**：
   - 设置 `auth.providers.feishu.enabled = true`
   - 填写飞书应用的 `appId` 和 `appSecret`
   - 配置正确的 `redirectUri`

## 验证集成

1. 启动服务器
2. 访问 `http://localhost:3000/interaction/test`（需要先触发 OIDC 流程）
3. 应该看到统一登录页面，包含：
   - 本地密码登录表单（如果启用）
   - 飞书登录按钮（如果启用）

## 故障排查

### 问题：插件未注册

**症状**：登录页面为空或显示错误

**解决**：
1. 检查配置文件中 `auth.providers` 是否正确
2. 查看日志确认插件是否成功注册
3. 确认 `enabled: true`

### 问题：本地密码认证失败

**症状**：提示"用户名或密码错误"

**解决**：
1. 检查 `.htpasswd` 文件是否存在
2. 确认密码哈希格式正确
3. 查看日志了解详细错误

### 问题：飞书登录失败

**症状**：回调后显示错误

**解决**：
1. 检查飞书应用配置
2. 确认 `redirectUri` 与飞书后台配置一致
3. 检查 `appId` 和 `appSecret` 是否正确
4. 查看网络请求确认 API 调用是否成功

## 下一步

- [ ] 实现数据库用户仓储
- [ ] 实现 Redis State Store
- [ ] 添加更多认证插件
- [ ] 添加管理界面
- [ ] 配置生产环境部署

## 相关文档

- [认证插件设计文档](./AUTH_PLUGIN_DESIGN.md)
- [插件开发指南](./PLUGIN_ROUTES_GUIDE.md)
- [P0 改进说明](./P0_IMPROVEMENTS.md)
- [实施总结](./IMPLEMENTATION_SUMMARY.md)
