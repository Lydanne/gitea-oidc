# P0 级别改进说明

本文档说明了针对设计审查中发现的 P0 级别问题的修复方案。

## 问题 1: 插件隔离性不足 ✅

### 问题描述

原设计中 `registerMiddleware()` 直接暴露 Fastify 实例，插件可以：

- 注册全局钩子监听所有请求
- 修改全局配置影响其他插件
- 造成插件间相互干扰

### 解决方案

引入 `PluginMiddlewareContext` 受限上下文，替代直接访问 Fastify 实例。

#### 类型定义

```typescript
// src/types/auth.ts

/**
 * 插件钩子类型
 * 限制插件只能注册作用于自身路径的钩子
 */
export type PluginHookName = 
  | 'onRequest'      // 请求开始时
  | 'preParsing'     // 解析请求体之前
  | 'preValidation'  // 验证之前
  | 'preHandler'     // 处理器之前
  | 'preSerialization' // 序列化之前
  | 'onSend'         // 发送响应之前
  | 'onResponse'     // 响应完成后
  | 'onError';       // 错误处理

/**
 * 插件中间件上下文
 * 提供受限的钩子注册能力，只作用于插件自身路径
 */
export interface PluginMiddlewareContext {
  /**
   * 注册钩子（仅作用于插件路径）
   */
  addHook(hookName: PluginHookName, handler: PluginHookHandler): void;
  
  /** 插件的基础路径，例如: '/auth/feishu' */
  readonly basePath: string;
  
  /** 插件名称 */
  readonly pluginName: string;
}

// AuthProvider 接口修改
export interface AuthProvider {
  // ... 其他方法 ...
  
  /**
   * 注册中间件（可选）
   * 注意：钩子只作用于插件自身的路径（/auth/:provider/*）
   */
  registerMiddleware?(context: PluginMiddlewareContext): Promise<void>;
}
```

#### 使用示例

```typescript
// 插件实现
class FeishuAuthProvider implements AuthProvider {
  async registerMiddleware(context: PluginMiddlewareContext): Promise<void> {
    // ✅ 只能注册作用于 /auth/feishu/* 的钩子
    context.addHook('preHandler', async (request, reply) => {
      console.log(`[${context.pluginName}] ${request.method} ${request.url}`);
    });

    context.addHook('onError', async (request, reply) => {
      console.error(`[${context.pluginName}] Error:`, reply);
    });

    // ❌ 无法访问全局 Fastify 实例
    // ❌ 无法注册全局钩子
    // ❌ 无法影响其他插件
  }
}
```

#### AuthCoordinator 实现示例

```typescript
class AuthCoordinator implements IAuthCoordinator {
  async registerProvider(provider: AuthProvider): Promise<void> {
    // 注册插件路由
    if (provider.registerRoutes) {
      const routes = provider.registerRoutes();
      routes.forEach(route => {
        const fullPath = `/auth/${provider.name}${route.path}`;
        this.app.route({
          method: route.method,
          url: fullPath,
          handler: route.handler,
          ...route.options,
        });
      });
    }

    // 注册插件中间件（受限）
    if (provider.registerMiddleware) {
      const basePath = `/auth/${provider.name}`;
      
      // 创建受限上下文
      const context: PluginMiddlewareContext = {
        basePath,
        pluginName: provider.name,
        addHook: (hookName, handler) => {
          // 只为插件路径注册钩子
          this.app.addHook(hookName, async (request, reply) => {
            // 只在请求匹配插件路径时执行
            if (request.url.startsWith(basePath)) {
              await handler(request, reply);
            }
          });
        },
      };

      await provider.registerMiddleware(context);
    }
  }
}
```

---

## 问题 2: OAuth State 管理缺失 ✅

### 问题描述

设计文档提到"验证 state 参数"，但缺少：

- State 生成和存储机制
- State 过期管理
- State 与 OIDC interaction UID 的关联

### 解决方案

引入 `StateStore` 接口和 `OAuthStateData` 类型，在 `IAuthCoordinator` 中添加 state 管理方法。

#### 类型定义

```typescript
// src/types/auth.ts

/**
 * OAuth State 数据
 */
export interface OAuthStateData {
  /** OIDC 交互 UID */
  interactionUid: string;
  
  /** 认证提供者名称 */
  provider: string;
  
  /** 创建时间戳 */
  createdAt: number;
  
  /** 额外元数据 */
  metadata?: Record<string, any>;
}

/**
 * State 存储接口
 */
export interface StateStore {
  set(state: string, data: OAuthStateData, ttl: number): Promise<void>;
  get(state: string): Promise<OAuthStateData | null>;
  delete(state: string): Promise<void>;
  cleanup?(): Promise<void>;
}

// IAuthCoordinator 新增方法
export interface IAuthCoordinator {
  // ... 其他方法 ...
  
  /**
   * 生成并存储 OAuth state
   */
  generateOAuthState(
    interactionUid: string,
    provider: string,
    metadata?: Record<string, any>
  ): Promise<string>;

  /**
   * 验证并消费 OAuth state
   */
  verifyOAuthState(state: string): Promise<OAuthStateData | null>;
}
```

#### 内存存储实现

```typescript
// src/stores/MemoryStateStore.ts

import type { StateStore, OAuthStateData } from '../types/auth.js';

interface StateEntry {
  data: OAuthStateData;
  expiresAt: number;
}

export class MemoryStateStore implements StateStore {
  private states = new Map<string, StateEntry>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(cleanupIntervalMs = 60000) {
    // 定期清理过期的 state
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async set(state: string, data: OAuthStateData, ttl: number): Promise<void> {
    const expiresAt = Date.now() + ttl * 1000;
    this.states.set(state, { data, expiresAt });
  }

  async get(state: string): Promise<OAuthStateData | null> {
    const entry = this.states.get(state);
    
    if (!entry || Date.now() > entry.expiresAt) {
      this.states.delete(state);
      return null;
    }

    return entry.data;
  }

  async delete(state: string): Promise<void> {
    this.states.delete(state);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [state, entry] of this.states.entries()) {
      if (now > entry.expiresAt) {
        this.states.delete(state);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.states.clear();
  }
}
```

#### AuthCoordinator 实现示例

```typescript
import { randomBytes } from 'crypto';

class AuthCoordinator implements IAuthCoordinator {
  private stateStore: StateStore;

  constructor(stateStore: StateStore) {
    this.stateStore = stateStore;
  }

  async generateOAuthState(
    interactionUid: string,
    provider: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    // 生成随机 state（32 字节 = 64 个十六进制字符）
    const state = randomBytes(32).toString('hex');
    
    const data: OAuthStateData = {
      interactionUid,
      provider,
      createdAt: Date.now(),
      metadata,
    };

    // 存储 state，10 分钟过期
    await this.stateStore.set(state, data, 600);

    return state;
  }

  async verifyOAuthState(state: string): Promise<OAuthStateData | null> {
    // 获取 state 数据
    const data = await this.stateStore.get(state);
    
    if (!data) {
      return null;
    }

    // 验证 state 未过期（额外检查）
    const age = Date.now() - data.createdAt;
    if (age > 600000) { // 10 分钟
      await this.stateStore.delete(state);
      return null;
    }

    // 消费 state（一次性使用）
    await this.stateStore.delete(state);

    return data;
  }
}
```

#### 插件使用示例

```typescript
class FeishuAuthProvider implements AuthProvider {
  private coordinator: IAuthCoordinator;

  async renderLoginUI(context: AuthContext): Promise<LoginUIResult> {
    // 生成 state
    const state = await this.coordinator.generateOAuthState(
      context.interactionUid,
      this.name,
      { userAgent: context.request.headers['user-agent'] }
    );

    // 构建飞书授权 URL
    const authUrl = new URL('https://open.feishu.cn/open-apis/authen/v1/authorize');
    authUrl.searchParams.set('app_id', this.config.appId);
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authUrl.searchParams.set('state', state);

    return {
      type: 'redirect',
      redirectUrl: authUrl.toString(),
    };
  }

  async handleCallback(context: AuthContext): Promise<AuthResult> {
    const { code, state } = context.query;

    // 验证 state
    const stateData = await this.coordinator.verifyOAuthState(state);
    
    if (!stateData) {
      return {
        success: false,
        error: 'Invalid or expired state parameter',
        errorCode: 'INVALID_STATE',
      };
    }

    // 验证 provider 匹配
    if (stateData.provider !== this.name) {
      return {
        success: false,
        error: 'State provider mismatch',
        errorCode: 'STATE_PROVIDER_MISMATCH',
      };
    }

    // 用 code 换取 access_token
    // ... OAuth 流程 ...

    return {
      success: true,
      userId: user.sub,
      userInfo: user,
    };
  }
}
```

---

## 问题 3: UserRepository 缺少事务支持 ✅

### 问题描述

在 OAuth 回调中需要"查找或创建"用户，但接口不支持原子操作，存在竞态条件：

```typescript
// ❌ 有竞态条件
let user = await repository.findByProviderAndExternalId('feishu', openId);
if (!user) {
  user = await repository.create(userInfo); // 可能重复创建
}
```

### 解决方案

为 `UserRepository` 添加 `findOrCreate()` 方法，提供原子操作。

#### 类型定义

```typescript
// src/types/auth.ts

export interface UserRepository {
  // ... 其他方法 ...

  /**
   * 查找或创建用户（原子操作）
   * 避免并发创建时的竞态条件
   */
  findOrCreate(
    criteria: {
      provider: string;
      externalId: string;
    },
    userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'>
  ): Promise<UserInfo>;
}
```

#### 内存存储实现

```typescript
// src/repositories/MemoryUserRepository.ts

export class MemoryUserRepository implements UserRepository {
  private users = new Map<string, UserInfo>();
  private providerIndex = new Map<string, string>(); // `${provider}:${externalId}` -> userId

  async findOrCreate(
    criteria: { provider: string; externalId: string },
    userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'>
  ): Promise<UserInfo> {
    const key = `${criteria.provider}:${criteria.externalId}`;
    
    // 先尝试查找
    const existingUserId = this.providerIndex.get(key);
    if (existingUserId) {
      const existingUser = this.users.get(existingUserId);
      if (existingUser) {
        return existingUser;
      }
    }

    // 不存在则创建
    const now = new Date();
    const user: UserInfo = {
      ...userData,
      sub: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.sub, user);
    this.providerIndex.set(key, user.sub);

    return user;
  }
}
```

#### 数据库实现示例（PostgreSQL）

```typescript
// src/repositories/PostgresUserRepository.ts

export class PostgresUserRepository implements UserRepository {
  async findOrCreate(
    criteria: { provider: string; externalId: string },
    userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'>
  ): Promise<UserInfo> {
    // 使用 PostgreSQL 的 INSERT ... ON CONFLICT 实现原子操作
    const result = await this.db.query(`
      INSERT INTO users (
        username, name, email, avatar, phone,
        auth_provider, email_verified, phone_verified, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (auth_provider, (metadata->>'externalId'))
      DO UPDATE SET updated_at = NOW()
      RETURNING *
    `, [
      userData.username,
      userData.name,
      userData.email,
      userData.avatar,
      userData.phone,
      userData.authProvider,
      userData.emailVerified,
      userData.phoneVerified,
      JSON.stringify({ ...userData.metadata, externalId: criteria.externalId }),
    ]);

    return this.mapRowToUserInfo(result.rows[0]);
  }
}
```

#### 插件使用示例

```typescript
class FeishuAuthProvider implements AuthProvider {
  private userRepository: UserRepository;

  async handleCallback(context: AuthContext): Promise<AuthResult> {
    // ... 验证 state 和获取 access_token ...

    // 获取飞书用户信息
    const feishuUser = await this.getFeishuUserInfo(accessToken);

    // ✅ 使用 findOrCreate 避免竞态条件
    const user = await this.userRepository.findOrCreate(
      {
        provider: this.name,
        externalId: feishuUser.open_id,
      },
      {
        username: feishuUser.open_id,
        name: feishuUser.name,
        email: feishuUser.email,
        avatar: feishuUser.avatar_url,
        authProvider: this.name,
        emailVerified: true,
        metadata: {
          externalId: feishuUser.open_id,
          unionId: feishuUser.union_id,
        },
      }
    );

    return {
      success: true,
      userId: user.sub,
      userInfo: user,
    };
  }
}
```

---

## 改进总结

### 1. 插件隔离性 ✅

- **改进前**: 插件可以访问全局 Fastify 实例，造成安全隐患
- **改进后**: 通过 `PluginMiddlewareContext` 限制插件只能注册作用于自身路径的钩子
- **影响**: 提高了插件系统的安全性和稳定性

### 2. OAuth State 管理 ✅

- **改进前**: 缺少 state 生成、存储和验证机制
- **改进后**:
  - 新增 `StateStore` 接口和 `MemoryStateStore` 实现
  - 在 `IAuthCoordinator` 中添加 `generateOAuthState()` 和 `verifyOAuthState()` 方法
  - 支持 state 过期和一次性消费
- **影响**: 完善了 OAuth 安全机制，防止 CSRF 攻击

### 3. UserRepository 原子操作 ✅

- **改进前**: 查找和创建用户是两个独立操作，存在竞态条件
- **改进后**: 新增 `findOrCreate()` 方法提供原子操作
- **影响**: 避免了并发场景下的重复用户创建问题

---

## 使用建议

### 开发环境

```typescript
import { MemoryStateStore } from './stores/MemoryStateStore.js';
import { MemoryUserRepository } from './repositories/MemoryUserRepository.js';

const stateStore = new MemoryStateStore();
const userRepository = new MemoryUserRepository();
const coordinator = new AuthCoordinator(stateStore, userRepository);
```

### 生产环境

建议使用 Redis 或数据库实现：

```typescript
import { RedisStateStore } from './stores/RedisStateStore.js';
import { PostgresUserRepository } from './repositories/PostgresUserRepository.js';

const stateStore = new RedisStateStore(redisClient);
const userRepository = new PostgresUserRepository(pgPool);
const coordinator = new AuthCoordinator(stateStore, userRepository);
```

---

## 后续工作

P0 问题已修复，建议继续处理 P1 级别问题：

1. **插件权限控制**: 添加权限声明和验证机制
2. **错误处理统一**: 改进 `AuthResult` 错误结构
3. **配置验证**: 添加配置 schema 和验证

详见设计审查报告的 P1 部分。
