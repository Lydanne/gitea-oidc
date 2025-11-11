/**
 * 认证插件系统类型定义
 * 
 * 定义了认证插件系统的核心接口和类型
 */

import type { FastifyRequest, FastifyReply, FastifyInstance, RouteOptions } from 'fastify';

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

/**
 * 插件路由定义
 * 插件可以注册自定义路由
 */
export interface PluginRoute {
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  
  /** 路由路径（相对于插件根路径） */
  path: string;
  
  /** 路由处理器 */
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<any> | any;
  
  /** 路由配置（可选） */
  options?: {
    /** 路由描述 */
    description?: string;
    
    /** 是否需要认证 */
    requireAuth?: boolean;
    
    /** 请求体 schema */
    schema?: RouteOptions['schema'];
    
    /** 其他 Fastify 路由选项 */
    [key: string]: any;
  };
}

/**
 * 插件静态资源定义
 */
export interface PluginStaticAsset {
  /** 资源路径（URL 路径） */
  path: string;
  
  /** 资源内容或文件路径 */
  content: string | Buffer;
  
  /** 内容类型 */
  contentType?: string;
}

/**
 * 插件 Webhook 定义
 * 用于接收外部系统的回调
 */
export interface PluginWebhook {
  /** Webhook 路径 */
  path: string;
  
  /** Webhook 处理器 */
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<any> | any;
  
  /** 验证签名的方法（可选） */
  verifySignature?: (request: FastifyRequest) => Promise<boolean> | boolean;
}

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
 * 插件钩子处理器
 */
export type PluginHookHandler = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void> | void;

/**
 * 插件中间件上下文
 * 提供受限的钩子注册能力，只作用于插件自身路径
 */
export interface PluginMiddlewareContext {
  /**
   * 注册钩子（仅作用于插件路径）
   * @param hookName 钩子名称
   * @param handler 钩子处理器
   */
  addHook(hookName: PluginHookName, handler: PluginHookHandler): void;
  
  /**
   * 插件的基础路径
   * 例如: '/auth/feishu'
   */
  readonly basePath: string;
  
  /**
   * 插件名称
   */
  readonly pluginName: string;
}

/**
 * 认证提供者接口
 * 所有认证插件必须实现此接口
 */
export interface AuthProvider {
  /**
   * 插件唯一标识符
   * 例如: 'local', 'feishu', 'wechat-work'
   */
  readonly name: string;

  /**
   * 插件显示名称
   * 例如: '本地密码', '飞书登录', '企业微信'
   */
  readonly displayName: string;

  /**
   * 插件初始化
   * 在服务器启动时调用，用于加载配置、建立连接等
   * 
   * @param config 插件配置对象
   */
  initialize(config: AuthProviderConfig): Promise<void>;

  /**
   * 检查是否支持该认证请求
   * 根据请求参数判断是否由本插件处理
   * 
   * @param context 认证上下文
   * @returns 是否可以处理该请求
   */
  canHandle(context: AuthContext): boolean;

  /**
   * 渲染登录 UI
   * 返回 HTML 片段或重定向 URL
   * 
   * @param context 认证上下文
   * @returns 登录 UI 渲染结果
   */
  renderLoginUI(context: AuthContext): Promise<LoginUIResult>;

  /**
   * 处理认证请求
   * 验证用户凭证，返回认证结果
   * 
   * @param context 认证上下文
   * @returns 认证结果
   */
  authenticate(context: AuthContext): Promise<AuthResult>;

  /**
   * 处理 OAuth 回调（可选）
   * 用于第三方 OAuth 登录的回调处理
   * 
   * @param context 认证上下文
   * @returns 认证结果
   */
  handleCallback?(context: AuthContext): Promise<AuthResult>;

  /**
   * 获取用户信息
   * 根据用户 ID 获取完整用户信息
   * 
   * @param userId 用户 ID
   * @returns 用户信息，如果用户不存在返回 null
   */
  getUserInfo(userId: string): Promise<UserInfo | null>;

  /**
   * 注册插件路由（可选）
   * 插件可以注册自定义 API 路由
   * 
   * 示例：
   * - GET /auth/:provider/status - 获取认证状态
   * - POST /auth/:provider/refresh - 刷新令牌
   * - GET /auth/:provider/users - 获取用户列表
   * 
   * @returns 路由定义数组
   */
  registerRoutes?(): PluginRoute[];

  /**
   * 注册静态资源（可选）
   * 插件可以提供静态文件（如图标、样式表、脚本）
   * 
   * 示例：
   * - /auth/:provider/icon.svg - 插件图标
   * - /auth/:provider/style.css - 自定义样式
   * 
   * @returns 静态资源定义数组
   */
  registerStaticAssets?(): PluginStaticAsset[];

  /**
   * 注册 Webhook（可选）
   * 用于接收外部系统的回调通知
   * 
   * 示例：
   * - POST /auth/:provider/webhook - 接收第三方事件通知
   * 
   * @returns Webhook 定义数组
   */
  registerWebhooks?(): PluginWebhook[];

  /**
   * 注册中间件（可选）
   * 插件可以注册钩子，在请求处理前后执行逻辑
   * 注意：钩子只作用于插件自身的路径（/auth/:provider/*）
   * 
   * @param context 插件中间件上下文（受限权限）
   */
  registerMiddleware?(context: PluginMiddlewareContext): Promise<void>;

  /**
   * 获取插件元数据（可选）
   * 返回插件的详细信息，用于管理界面展示
   * 
   * @returns 插件元数据
   */
  getMetadata?(): PluginMetadata;

  /**
   * 插件清理（可选）
   * 在服务器关闭时调用，用于释放资源
   */
  destroy?(): Promise<void>;
}

/**
 * 插件权限枚举
 */
export enum PluginPermission {
  /** 读取用户信息 */
  READ_USER = 'read:user',
  
  /** 创建用户 */
  CREATE_USER = 'create:user',
  
  /** 更新用户 */
  UPDATE_USER = 'update:user',
  
  /** 删除用户 */
  DELETE_USER = 'delete:user',
  
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
 * 插件元数据
 * 用于管理界面展示插件信息
 */
export interface PluginMetadata {
  /** 插件名称 */
  name: string;
  
  /** 插件显示名称 */
  displayName: string;
  
  /** 插件版本 */
  version: string;
  
  /** 插件描述 */
  description?: string;
  
  /** 插件作者 */
  author?: string;
  
  /** 插件主页 */
  homepage?: string;
  
  /** 插件图标 URL */
  icon?: string;
  
  /** 插件所需权限 */
  permissions: PluginPermission[];
  
  /** 支持的功能特性 */
  features?: string[];
  
  /** 插件状态 */
  status?: {
    /** 是否已初始化 */
    initialized: boolean;
    
    /** 是否健康 */
    healthy: boolean;
    
    /** 状态消息 */
    message?: string;
    
    /** 统计信息 */
    stats?: Record<string, any>;
  };
}

/**
 * 认证提供者配置
 */
export interface AuthProviderConfig {
  /** 是否启用 */
  enabled: boolean;
  
  /** 显示名称 */
  displayName: string;
  
  /** 优先级（影响显示顺序） */
  priority?: number;
  
  /** 插件特定配置 */
  config: Record<string, any>;
}

/**
 * 认证上下文
 * 包含认证过程中需要的所有信息
 */
export interface AuthContext {
  /** OIDC 交互 UID */
  interactionUid: string;

  /** HTTP 请求对象 */
  request: FastifyRequest;

  /** HTTP 响应对象 */
  reply: FastifyReply;

  /** 认证方式标识 */
  authMethod?: string;

  /** 请求参数 */
  params: Record<string, any>;

  /** 请求体 */
  body: Record<string, any>;

  /** 查询参数 */
  query: Record<string, any>;

  /** OIDC 交互详情 */
  interaction?: any;
}

/**
 * 认证结果
 */
export interface AuthResult {
  /** 认证是否成功 */
  success: boolean;

  /** 用户 ID（认证成功时必填） */
  userId?: string;

  /** 用户信息（可选） */
  userInfo?: UserInfo;

  /** 错误信息（认证失败时） */
  error?: AuthError;

  /** 是否需要重定向 */
  redirect?: {
    url: string;
    statusCode?: number;
  };

  /** 额外的元数据 */
  metadata?: Record<string, any>;
}

/**
 * 统一用户信息结构
 * 字段命名遵循 OIDC 标准规范
 */
export interface UserInfo {
  /** 用户唯一标识符（OIDC sub claim） */
  sub: string;

  /** 用户名 */
  username: string;

  /** 显示名称（OIDC name claim） */
  name: string;

  /** 邮箱（OIDC email claim） */
  email: string;

  /** 头像 URL（OIDC picture claim） */
  picture?: string;

  /** 手机号（OIDC phone claim） */
  phone?: string;

  /** 认证来源 */
  authProvider: string;

  /** 是否已验证邮箱（OIDC email_verified claim） */
  email_verified?: boolean;

  /** 是否已验证手机（OIDC phone_verified claim） */
  phone_verified?: boolean;

  /** 用户组列表（OIDC groups claim，用于团队映射） */
  groups?: string[];

  /** 创建时间 */
  createdAt?: Date;

  /** 更新时间（OIDC updated_at claim，以秒为单位的时间戳） */
  updatedAt?: Date;

  /** 扩展属性（用于存储额外的自定义字段） */
  metadata?: Record<string, any>;
}

/**
 * 登录 UI 渲染结果
 */
export interface LoginUIResult {
  /** UI 类型 */
  type: 'html' | 'redirect';

  /** HTML 内容（type=html 时） */
  html?: string;

  /** 重定向 URL（type=redirect 时） */
  redirectUrl?: string;

  /** 是否需要显示在统一登录页 */
  showInUnifiedPage?: boolean;

  /** 登录按钮配置（统一登录页使用） */
  button?: {
    text: string;
    icon?: string;
    style?: string;
    order?: number;
  };
}

/**
 * 用户仓储接口
 * 抽象用户数据存储
 */
export interface UserRepository {
  /**
   * 根据 ID 查找用户
   */
  findById(userId: string): Promise<UserInfo | null>;

  /**
   * 根据用户名查找用户
   */
  findByUsername(username: string): Promise<UserInfo | null>;

  /**
   * 根据邮箱查找用户
   */
  findByEmail(email: string): Promise<UserInfo | null>;

  /**
   * 根据认证提供者和外部 ID 查找用户
   */
  findByProviderAndExternalId(
    provider: string,
    externalId: string
  ): Promise<UserInfo | null>;

  /**
   * 查找或创建用户（原子操作）
   * 避免并发创建时的竞态条件
   * 
   * @param criteria 查找条件
   * @param userData 用户数据（如果不存在则创建）
   * @returns 找到或创建的用户
   */
  findOrCreate(
    criteria: {
      provider: string;
      externalId: string;
    },
    userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'>
  ): Promise<UserInfo>;

  /**
   * 创建用户
   */
  create(user: Omit<UserInfo, 'sub'>): Promise<UserInfo>;

  /**
   * 更新用户
   */
  update(userId: string, updates: Partial<UserInfo>): Promise<UserInfo>;

  /**
   * 删除用户
   */
  delete(userId: string): Promise<void>;

  /**
   * 查询用户列表
   */
  list(options?: ListOptions): Promise<UserInfo[]>;

  /**
   * 清空所有用户（仅用于测试）
   */
  clear?(): Promise<void>;
}

/**
 * 查询选项
 */
export interface ListOptions {
  /** 分页：偏移量 */
  offset?: number;
  
  /** 分页：每页数量 */
  limit?: number;
  
  /** 排序字段 */
  sortBy?: string;
  
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
  
  /** 过滤条件 */
  filter?: Record<string, any>;
}

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
 * 用于存储 OAuth state 参数
 */
export interface StateStore {
  /**
   * 存储 state
   * @param state state 字符串
   * @param data state 数据
   * @param ttl 过期时间（秒）
   */
  set(state: string, data: OAuthStateData, ttl: number): Promise<void>;
  
  /**
   * 获取 state
   * @param state state 字符串
   * @returns state 数据，如果不存在或已过期返回 null
   */
  get(state: string): Promise<OAuthStateData | null>;
  
  /**
   * 删除 state（消费后）
   * @param state state 字符串
   */
  delete(state: string): Promise<void>;
  
  /**
   * 清理过期的 state
   */
  cleanup?(): Promise<void>;
}

/**
 * 认证协调器接口
 */
export interface IAuthCoordinator {
  /**
   * 注册认证插件
   */
  registerProvider(provider: AuthProvider): void;

  /**
   * 获取所有已启用的插件
   */
  getProviders(): AuthProvider[];

  /**
   * 根据名称获取插件
   */
  getProvider(name: string): AuthProvider | undefined;

  /**
   * 渲染统一登录页面
   */
  renderUnifiedLoginPage(context: AuthContext): Promise<string>;

  /**
   * 处理认证请求
   */
  handleAuthentication(context: AuthContext): Promise<AuthResult>;

  /**
   * 查找用户账户（供 OIDC Provider 调用）
   */
  findAccount(userId: string): Promise<UserInfo | null>;

  /**
   * 生成并存储 OAuth state
   * @param interactionUid OIDC 交互 UID
   * @param provider 认证提供者名称
   * @param metadata 额外元数据
   * @returns 生成的 state 字符串
   */
  generateOAuthState(
    interactionUid: string,
    provider: string,
    metadata?: Record<string, any>
  ): Promise<string>;

  /**
   * 验证并消费 OAuth state
   * @param state state 字符串
   * @returns state 数据，如果无效返回 null
   */
  verifyOAuthState(state: string): Promise<OAuthStateData | null>;

  /**
   * 完成 OIDC 交互
   * 供插件调用，用于完成用户认证后的 OIDC 交互流程
   * 
   * @param request Fastify 请求对象
   * @param reply Fastify 响应对象
   * @param interactionUid OIDC 交互 UID
   * @param userId 已认证的用户 ID
   */
  finishOidcInteraction(
    request: FastifyRequest,
    reply: FastifyReply,
    interactionUid: string,
    userId: string
  ): Promise<void>;

  /**
   * 初始化所有插件
   */
  initialize(): Promise<void>;

  /**
   * 销毁所有插件
   */
  destroy(): Promise<void>;
}

/**
 * 本地认证配置
 */
export interface LocalAuthConfig {
  /** htpasswd 文件路径 */
  passwordFile: string;
  
  /** 密码格式 */
  passwordFormat: 'bcrypt' | 'md5' | 'sha' | 'auto';
  
  /** 是否允许注册 */
  allowRegistration?: boolean;
  
  /** 密码策略 */
  passwordPolicy?: {
    minLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumber?: boolean;
    requireSpecialChar?: boolean;
  };
  
  /** 账户锁定策略 */
  lockoutPolicy?: {
    enabled: boolean;
    maxAttempts: number;
    lockoutDuration: number; // 秒
  };
}

/**
 * 飞书认证配置
 */
export interface FeishuAuthConfig {
  /** 应用 ID */
  appId: string;
  
  /** 应用密钥 */
  appSecret: string;
  
  /** 回调 URI */
  redirectUri: string;
  
  /** 权限范围 */
  scope?: string;
  
  /** 是否自动创建用户 */
  autoCreateUser?: boolean;
  
  /** 用户字段映射 */
  userMapping?: {
    username?: string;
    name?: string;
    email?: string;
    picture?: string;
  };
  
  /** 飞书 API 端点（可选，用于私有化部署） */
  apiEndpoint?: string;
}

/**
 * 哈希密码信息
 */
export interface HashedPassword {
  /** 哈希算法 */
  algorithm: 'bcrypt' | 'md5' | 'sha' | 'plain';
  
  /** 哈希值 */
  hash: string;
  
  /** 盐值（如果适用） */
  salt?: string;
}
