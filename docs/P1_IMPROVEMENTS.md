# P1 级别改进计划

本文档规划 P1 级别的改进任务，这些改进将进一步提升系统的健壮性、可维护性和用户体验。

---

## 问题 1: 错误处理统一 🔧

### 当前问题

`AuthResult` 接口的错误处理过于简单：

```typescript
export interface AuthResult {
  success: boolean;
  userId?: string;
  error?: string;  // ❌ 只是简单的字符串
  redirectUrl?: string;
}
```

**存在的问题**：

- ❌ 错误信息不够结构化
- ❌ 缺少错误码，难以国际化
- ❌ 缺少错误详情和上下文
- ❌ 前端难以根据错误类型做不同处理

### 解决方案

#### 1. 定义错误码枚举

```typescript
// src/types/auth.ts

/**
 * 认证错误码
 */
export enum AuthErrorCode {
  // 通用错误 (1xxx)
  UNKNOWN_ERROR = 'AUTH_1000',
  INVALID_REQUEST = 'AUTH_1001',
  MISSING_PARAMETER = 'AUTH_1002',
  
  // 认证失败 (2xxx)
  INVALID_CREDENTIALS = 'AUTH_2001',
  USER_NOT_FOUND = 'AUTH_2002',
  PASSWORD_INCORRECT = 'AUTH_2003',
  ACCOUNT_LOCKED = 'AUTH_2004',
  ACCOUNT_DISABLED = 'AUTH_2005',
  
  // OAuth 错误 (3xxx)
  INVALID_STATE = 'AUTH_3001',
  STATE_EXPIRED = 'AUTH_3002',
  OAUTH_CALLBACK_FAILED = 'AUTH_3003',
  TOKEN_EXCHANGE_FAILED = 'AUTH_3004',
  USERINFO_FETCH_FAILED = 'AUTH_3005',
  
  // 配置错误 (4xxx)
  PROVIDER_NOT_FOUND = 'AUTH_4001',
  PROVIDER_DISABLED = 'AUTH_4002',
  INVALID_CONFIGURATION = 'AUTH_4003',
  
  // 系统错误 (5xxx)
  INTERNAL_ERROR = 'AUTH_5001',
  DATABASE_ERROR = 'AUTH_5002',
  NETWORK_ERROR = 'AUTH_5003',
}
```

#### 2. 定义错误详情接口

```typescript
/**
 * 认证错误详情
 */
export interface AuthError {
  /** 错误码 */
  code: AuthErrorCode;
  
  /** 错误消息（英文，用于日志） */
  message: string;
  
  /** 用户友好的错误消息（可本地化） */
  userMessage?: string;
  
  /** 错误详情和上下文 */
  details?: Record<string, any>;
  
  /** 原始错误（用于调试） */
  cause?: Error;
  
  /** 是否可重试 */
  retryable?: boolean;
  
  /** 建议的操作 */
  suggestedAction?: string;
}
```

#### 3. 改进 AuthResult 接口

```typescript
/**
 * 认证结果
 */
export interface AuthResult {
  /** 是否成功 */
  success: boolean;
  
  /** 用户 ID（成功时） */
  userId?: string;
  
  /** 用户信息（成功时，可选） */
  userInfo?: UserInfo;
  
  /** 错误信息（失败时） */
  error?: AuthError;
  
  /** 重定向 URL（可选） */
  redirectUrl?: string;
  
  /** 额外元数据 */
  metadata?: Record<string, any>;
}
```

#### 4. 创建错误工厂函数

```typescript
// src/utils/authErrors.ts

/**
 * 创建认证错误
 */
export function createAuthError(
  code: AuthErrorCode,
  message: string,
  options?: {
    userMessage?: string;
    details?: Record<string, any>;
    cause?: Error;
    retryable?: boolean;
    suggestedAction?: string;
  }
): AuthError {
  return {
    code,
    message,
    userMessage: options?.userMessage || getDefaultUserMessage(code),
    details: options?.details,
    cause: options?.cause,
    retryable: options?.retryable ?? false,
    suggestedAction: options?.suggestedAction,
  };
}

/**
 * 获取默认的用户友好消息
 */
function getDefaultUserMessage(code: AuthErrorCode): string {
  const messages: Record<AuthErrorCode, string> = {
    [AuthErrorCode.INVALID_CREDENTIALS]: '用户名或密码错误',
    [AuthErrorCode.USER_NOT_FOUND]: '用户不存在',
    [AuthErrorCode.PASSWORD_INCORRECT]: '密码错误',
    [AuthErrorCode.ACCOUNT_LOCKED]: '账户已被锁定，请联系管理员',
    [AuthErrorCode.ACCOUNT_DISABLED]: '账户已被禁用',
    [AuthErrorCode.INVALID_STATE]: '无效的认证状态',
    [AuthErrorCode.STATE_EXPIRED]: '认证已过期，请重新登录',
    [AuthErrorCode.OAUTH_CALLBACK_FAILED]: 'OAuth 认证失败',
    [AuthErrorCode.PROVIDER_NOT_FOUND]: '认证方式不存在',
    [AuthErrorCode.PROVIDER_DISABLED]: '该认证方式已被禁用',
    [AuthErrorCode.INTERNAL_ERROR]: '系统错误，请稍后重试',
    // ... 其他错误码
  };
  
  return messages[code] || '认证失败';
}

/**
 * 常用错误创建函数
 */
export const AuthErrors = {
  invalidCredentials: (details?: Record<string, any>) =>
    createAuthError(AuthErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', {
      details,
      retryable: true,
      suggestedAction: '请检查用户名和密码是否正确',
    }),
    
  userNotFound: (username: string) =>
    createAuthError(AuthErrorCode.USER_NOT_FOUND, `User not found: ${username}`, {
      details: { username },
      suggestedAction: '请检查用户名是否正确',
    }),
    
  invalidState: (state: string) =>
    createAuthError(AuthErrorCode.INVALID_STATE, 'Invalid OAuth state', {
      details: { state: state.substring(0, 8) + '...' },
      suggestedAction: '请重新开始登录流程',
    }),
    
  stateExpired: () =>
    createAuthError(AuthErrorCode.STATE_EXPIRED, 'OAuth state expired', {
      retryable: true,
      suggestedAction: '请重新登录',
    }),
    
  providerNotFound: (provider: string) =>
    createAuthError(AuthErrorCode.PROVIDER_NOT_FOUND, `Provider not found: ${provider}`, {
      details: { provider },
    }),
    
  internalError: (cause: Error) =>
    createAuthError(AuthErrorCode.INTERNAL_ERROR, 'Internal error', {
      cause,
      retryable: true,
      suggestedAction: '请稍后重试，如果问题持续请联系管理员',
    }),
};
```

#### 5. 使用示例

```typescript
// LocalAuthProvider.ts
async authenticate(context: AuthContext): Promise<AuthResult> {
  const { username, password } = context.body;
  
  if (!username || !password) {
    return {
      success: false,
      error: createAuthError(
        AuthErrorCode.MISSING_PARAMETER,
        'Missing username or password',
        {
          details: { 
            missingFields: [!username && 'username', !password && 'password'].filter(Boolean)
          },
          userMessage: '请输入用户名和密码',
        }
      ),
    };
  }
  
  const user = await this.verifyPassword(username, password);
  
  if (!user) {
    return {
      success: false,
      error: AuthErrors.invalidCredentials({ username }),
    };
  }
  
  return {
    success: true,
    userId: user.sub,
    userInfo: user,
  };
}
```

### 优先级：P1 - 高

### 预计工作量：4-6 小时

### 影响范围

- `src/types/auth.ts` - 类型定义
- `src/utils/authErrors.ts` - 错误工厂（新建）
- `src/providers/LocalAuthProvider.ts` - 更新错误处理
- `src/providers/FeishuAuthProvider.ts` - 更新错误处理
- `src/core/AuthCoordinator.ts` - 更新错误处理
- `src/server.ts` - 更新错误显示

---

## 问题 2: 配置验证 🔧

### 当前问题

配置加载缺少验证机制：

- ❌ 无法检测配置错误
- ❌ 错误的配置可能导致运行时崩溃
- ❌ 缺少配置提示和默认值说明

### 解决方案

#### 1. 安装验证库

```bash
pnpm add zod
pnpm add -D @types/node
```

#### 2. 定义配置 Schema

```typescript
// src/schemas/configSchema.ts

import { z } from 'zod';

/**
 * 服务器配置 Schema
 */
const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(3000),
  url: z.string().url(),
});

/**
 * 日志配置 Schema
 */
const LoggingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * OIDC 配置 Schema
 */
const OidcConfigSchema = z.object({
  issuer: z.string().url(),
  cookieKeys: z.array(z.string().min(32)).min(1),
  ttl: z.object({
    AccessToken: z.number().int().positive().default(3600),
    AuthorizationCode: z.number().int().positive().default(600),
    IdToken: z.number().int().positive().default(3600),
    RefreshToken: z.number().int().positive().default(86400),
  }),
  claims: z.record(z.array(z.string())),
  features: z.object({
    devInteractions: z.object({ enabled: z.boolean() }),
    registration: z.object({ enabled: z.boolean() }),
    revocation: z.object({ enabled: z.boolean() }),
  }),
});

/**
 * 客户端配置 Schema
 */
const ClientConfigSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(8),
  redirect_uris: z.array(z.string().url()).min(1),
  response_types: z.array(z.string()),
  grant_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
});

/**
 * 认证提供者配置 Schema
 */
const AuthProviderConfigSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string(),
  priority: z.number().int().optional(),
  config: z.record(z.any()),
});

/**
 * 用户仓储配置 Schema
 */
const UserRepositoryConfigSchema = z.object({
  type: z.enum(['memory', 'database', 'config']),
  config: z.record(z.any()),
});

/**
 * 认证配置 Schema
 */
const AuthConfigSchema = z.object({
  userRepository: UserRepositoryConfigSchema,
  providers: z.record(AuthProviderConfigSchema),
});

/**
 * 完整配置 Schema
 */
export const GiteaOidcConfigSchema = z.object({
  server: ServerConfigSchema,
  logging: LoggingConfigSchema,
  oidc: OidcConfigSchema,
  clients: z.array(ClientConfigSchema).min(1),
  auth: AuthConfigSchema,
});

export type ValidatedGiteaOidcConfig = z.infer<typeof GiteaOidcConfigSchema>;
```

#### 3. 创建配置验证函数

```typescript
// src/utils/configValidator.ts

import { GiteaOidcConfigSchema } from '../schemas/configSchema';
import type { GiteaOidcConfig } from '../config';

export interface ConfigValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: string[];
  config?: GiteaOidcConfig;
}

/**
 * 验证配置
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result = GiteaOidcConfigSchema.safeParse(config);
  
  if (result.success) {
    const warnings = checkConfigWarnings(result.data);
    return {
      valid: true,
      errors: [],
      warnings,
      config: result.data as GiteaOidcConfig,
    };
  }
  
  const errors: ConfigValidationError[] = result.error.errors.map(err => ({
    path: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
  
  return {
    valid: false,
    errors,
    warnings: [],
  };
}

/**
 * 检查配置警告
 */
function checkConfigWarnings(config: any): string[] {
  const warnings: string[] = [];
  
  // 检查 Cookie 密钥强度
  if (config.oidc.cookieKeys.some((key: string) => key.length < 32)) {
    warnings.push('Cookie keys should be at least 32 characters long');
  }
  
  // 检查是否使用默认密钥
  if (config.oidc.cookieKeys.includes('change-this-to-a-random-string-in-production')) {
    warnings.push('Using default cookie key in production is not secure');
  }
  
  // 检查客户端密钥强度
  config.clients.forEach((client: any, index: number) => {
    if (client.client_secret.length < 16) {
      warnings.push(`Client ${index} secret is too short (< 16 characters)`);
    }
  });
  
  // 检查是否启用了任何认证提供者
  const enabledProviders = Object.values(config.auth.providers)
    .filter((p: any) => p.enabled);
  
  if (enabledProviders.length === 0) {
    warnings.push('No authentication providers are enabled');
  }
  
  // 检查本地认证配置
  if (config.auth.providers.local?.enabled) {
    const localConfig = config.auth.providers.local.config;
    if (!localConfig.passwordFile) {
      warnings.push('Local auth is enabled but passwordFile is not configured');
    }
  }
  
  return warnings;
}

/**
 * 格式化验证错误
 */
export function formatValidationErrors(errors: ConfigValidationError[]): string {
  return errors
    .map(err => `  - ${err.path}: ${err.message}`)
    .join('\n');
}
```

#### 4. 集成到配置加载

```typescript
// src/config.ts

import { validateConfig, formatValidationErrors } from './utils/configValidator';

export async function loadConfig(): Promise<GiteaOidcConfig> {
  // ... 现有的配置加载逻辑 ...
  
  const rawConfig = { ...defaultConfig, ...userConfig };
  
  // 验证配置
  const validation = validateConfig(rawConfig);
  
  if (!validation.valid) {
    console.error('❌ Configuration validation failed:');
    console.error(formatValidationErrors(validation.errors));
    process.exit(1);
  }
  
  // 显示警告
  if (validation.warnings.length > 0) {
    console.warn('⚠️  Configuration warnings:');
    validation.warnings.forEach(warning => {
      console.warn(`  - ${warning}`);
    });
  }
  
  console.log('✅ Configuration validated successfully');
  
  return validation.config!;
}
```

### 优先级：P1 - 高

### 预计工作量：3-4 小时

### 影响范围

- `package.json` - 添加 zod 依赖
- `src/schemas/configSchema.ts` - Schema 定义（新建）
- `src/utils/configValidator.ts` - 验证逻辑（新建）
- `src/config.ts` - 集成验证

---

## 问题 3: 插件权限控制 🔧

### 当前问题

插件缺少权限声明和验证：

- ❌ 无法限制插件可以访问的资源
- ❌ 无法控制插件的能力范围
- ❌ 缺少安全审计

### 解决方案

#### 1. 定义权限枚举

```typescript
// src/types/auth.ts

/**
 * 插件权限
 */
export enum PluginPermission {
  /** 读取用户信息 */
  READ_USER = 'read:user',
  
  /** 创建用户 */
  CREATE_USER = 'create:user',
  
  /** 更新用户 */
  UPDATE_USER = 'update:user',
  
  /** 读取配置 */
  READ_CONFIG = 'read:config',
  
  /** 访问 State Store */
  ACCESS_STATE_STORE = 'access:state_store',
  
  /** 注册路由 */
  REGISTER_ROUTES = 'register:routes',
  
  /** 注册静态资源 */
  REGISTER_STATIC = 'register:static',
  
  /** 注册 Webhook */
  REGISTER_WEBHOOK = 'register:webhook',
  
  /** 注册中间件 */
  REGISTER_MIDDLEWARE = 'register:middleware',
  
  /** 发送 HTTP 请求（外部 API） */
  HTTP_REQUEST = 'http:request',
}

/**
 * 插件元数据（扩展）
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  
  /** 插件所需权限 */
  permissions: PluginPermission[];
  
  /** 插件依赖 */
  dependencies?: string[];
}
```

#### 2. 权限检查器

```typescript
// src/core/PermissionChecker.ts

export class PermissionChecker {
  private pluginPermissions = new Map<string, Set<PluginPermission>>();
  
  /**
   * 注册插件权限
   */
  registerPlugin(pluginName: string, permissions: PluginPermission[]): void {
    this.pluginPermissions.set(pluginName, new Set(permissions));
  }
  
  /**
   * 检查权限
   */
  hasPermission(pluginName: string, permission: PluginPermission): boolean {
    const permissions = this.pluginPermissions.get(pluginName);
    return permissions?.has(permission) ?? false;
  }
  
  /**
   * 要求权限（如果没有则抛出错误）
   */
  requirePermission(pluginName: string, permission: PluginPermission): void {
    if (!this.hasPermission(pluginName, permission)) {
      throw new Error(
        `Plugin "${pluginName}" does not have permission: ${permission}`
      );
    }
  }
  
  /**
   * 检查多个权限
   */
  hasAllPermissions(pluginName: string, permissions: PluginPermission[]): boolean {
    return permissions.every(p => this.hasPermission(pluginName, p));
  }
}
```

#### 3. 集成到 AuthCoordinator

```typescript
// src/core/AuthCoordinator.ts

export class AuthCoordinator implements IAuthCoordinator {
  private permissionChecker = new PermissionChecker();
  
  registerProvider(provider: AuthProvider): void {
    const metadata = provider.getMetadata();
    
    // 注册权限
    this.permissionChecker.registerPlugin(
      metadata.name,
      metadata.permissions
    );
    
    // 检查并注册路由
    if (provider.registerRoutes) {
      this.permissionChecker.requirePermission(
        metadata.name,
        PluginPermission.REGISTER_ROUTES
      );
      this.registerProviderRoutes(provider);
    }
    
    // 检查并注册静态资源
    if (provider.registerStaticAssets) {
      this.permissionChecker.requirePermission(
        metadata.name,
        PluginPermission.REGISTER_STATIC
      );
      this.registerProviderStaticAssets(provider);
    }
    
    // ... 其他注册逻辑 ...
  }
}
```

#### 4. 更新插件实现

```typescript
// src/providers/LocalAuthProvider.ts

export class LocalAuthProvider implements AuthProvider {
  getMetadata(): PluginMetadata {
    return {
      name: 'local',
      version: '1.0.0',
      description: 'Local password authentication using htpasswd',
      author: 'Gitea OIDC Team',
      permissions: [
        PluginPermission.READ_USER,
        PluginPermission.CREATE_USER,
        PluginPermission.REGISTER_ROUTES,
      ],
    };
  }
  
  // ... 其他方法 ...
}
```

### 优先级：P1 - 中

### 预计工作量：4-5 小时

### 影响范围

- `src/types/auth.ts` - 权限定义
- `src/core/PermissionChecker.ts` - 权限检查器（新建）
- `src/core/AuthCoordinator.ts` - 集成权限检查
- `src/providers/*.ts` - 更新元数据

---

## 实施计划

### 第一阶段：错误处理统一（优先）

- [ ] 定义错误码枚举
- [ ] 创建 AuthError 接口
- [ ] 实现错误工厂函数
- [ ] 更新 AuthResult 接口
- [ ] 更新所有插件的错误处理
- [ ] 更新 server.ts 的错误显示
- [ ] 添加测试

### 第二阶段：配置验证

- [ ] 安装 zod 依赖
- [ ] 定义配置 Schema
- [ ] 实现验证函数
- [ ] 集成到配置加载
- [ ] 添加警告检查
- [ ] 添加测试

### 第三阶段：插件权限控制

- [ ] 定义权限枚举
- [ ] 实现权限检查器
- [ ] 集成到 AuthCoordinator
- [ ] 更新插件元数据
- [ ] 添加权限审计日志
- [ ] 添加测试

---

## 预期收益

### 错误处理统一

- ✅ 更好的用户体验
- ✅ 更容易调试和排查问题
- ✅ 支持国际化
- ✅ 前端可以根据错误码做精确处理

### 配置验证

- ✅ 启动时发现配置错误
- ✅ 避免运行时崩溃
- ✅ 更好的配置提示
- ✅ 提高系统稳定性

### 插件权限控制

- ✅ 提高安全性
- ✅ 限制插件能力
- ✅ 支持安全审计
- ✅ 更好的插件隔离

---

## 总结

P1 改进将显著提升系统的：

- **健壮性** - 通过配置验证和错误处理
- **安全性** - 通过权限控制
- **可维护性** - 通过结构化错误和清晰的权限模型
- **用户体验** - 通过友好的错误提示

建议按照优先级顺序实施，每个阶段完成后进行测试和验证。
