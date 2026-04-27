/**
 * 统一 Provider API 调用类型
 *
 * 这些类型描述飞书、钉钉等外部平台的 token 存储、刷新、探活和代理调用契约。
 */

/**
 * Provider token 所属主体类型
 */
export type ProviderTokenOwnerType = "user" | "app";

/**
 * Provider token 健康状态
 */
export type ProviderTokenStatus = "valid" | "expired" | "refresh_failed" | "revoked" | "unknown";

/**
 * Provider token 记录
 */
export interface ProviderTokenRecord {
  /** 记录唯一 ID，默认由 provider、ownerType、ownerId 组成 */
  id?: string;

  /** Provider 名称，例如 feishu、dingtalk */
  provider: string;

  /** token 所属主体类型 */
  ownerType: ProviderTokenOwnerType;

  /** token 所属主体 ID，用户 token 为用户 sub，应用 token 为租户或 default */
  ownerId: string;

  /** access token 明文；仓储落库前必须加密 */
  accessToken: string;

  /** refresh token 明文；仓储落库前必须加密 */
  refreshToken?: string;

  /** token 类型，例如 Bearer */
  tokenType?: string;

  /** 授权范围 */
  scope?: string;

  /** access token 过期时间 */
  expiresAt?: Date;

  /** refresh token 过期时间 */
  refreshExpiresAt?: Date;

  /** 当前健康状态 */
  status: ProviderTokenStatus;

  /** 上次探活时间 */
  lastProbedAt?: Date;

  /** 上次刷新时间 */
  lastRefreshAt?: Date;

  /** 最近一次错误摘要，禁止写入原始 token */
  lastError?: string;

  /** Provider 特定元数据 */
  metadata?: Record<string, any>;

  /** 创建时间 */
  createdAt?: Date;

  /** 更新时间 */
  updatedAt?: Date;
}

/**
 * Provider token 查询选项
 */
export interface ProviderTokenListOptions {
  /** Provider 名称 */
  provider?: string;

  /** token 所属主体类型 */
  ownerType?: ProviderTokenOwnerType;

  /** token 所属主体 ID */
  ownerId?: string;

  /** 健康状态 */
  status?: ProviderTokenStatus;

  /** 分页偏移 */
  offset?: number;

  /** 分页数量 */
  limit?: number;
}

/**
 * Provider token 仓储接口
 */
export interface ProviderTokenRepository {
  /**
   * 创建或更新 token 记录
   * @param record token 记录
   * @returns 保存后的 token 记录
   */
  upsert(record: ProviderTokenRecord): Promise<ProviderTokenRecord>;

  /**
   * 查找指定主体的 token
   * @param provider Provider 名称
   * @param ownerType token 所属主体类型
   * @param ownerId token 所属主体 ID
   * @returns token 记录，不存在时返回 null
   */
  find(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
  ): Promise<ProviderTokenRecord | null>;

  /**
   * 查询 token 列表
   * @param options 查询选项
   * @returns token 记录列表
   */
  list(options?: ProviderTokenListOptions): Promise<ProviderTokenRecord[]>;

  /**
   * 更新 token 健康状态
   * @param provider Provider 名称
   * @param ownerType token 所属主体类型
   * @param ownerId token 所属主体 ID
   * @param status 健康状态
   * @param lastError 最近错误摘要
   */
  updateStatus(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
    status: ProviderTokenStatus,
    lastError?: string,
  ): Promise<void>;

  /**
   * 删除 token 记录
   * @param provider Provider 名称
   * @param ownerType token 所属主体类型
   * @param ownerId token 所属主体 ID
   */
  delete(provider: string, ownerType: ProviderTokenOwnerType, ownerId: string): Promise<void>;

  /**
   * 清空仓储，仅用于测试或开发环境
   */
  clear?(): Promise<void>;

  /**
   * 关闭底层连接
   */
  close?(): Promise<void>;
}

/**
 * Provider API 请求
 */
export interface ProviderApiRequest {
  /** HTTP 方法 */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

  /** Provider baseUrl 下的相对路径，禁止传入绝对 URL */
  path: string;

  /** 操作标识，用于白名单和审计 */
  operation?: string;

  /** 使用用户 token 还是应用 token */
  tokenKind: ProviderTokenOwnerType;

  /** token 所属主体 ID；用户 token 默认使用当前登录用户 */
  ownerId?: string;

  /** 查询参数 */
  query?: Record<string, string | number | boolean | undefined>;

  /** 请求头，Authorization 会由系统覆盖 */
  headers?: Record<string, string>;

  /** 请求体 */
  body?: unknown;
}

/**
 * Provider API 响应
 */
export interface ProviderApiResponse<T = unknown> {
  /** HTTP 状态码 */
  status: number;

  /** 响应头 */
  headers: Record<string, string>;

  /** 解析后的响应体 */
  data: T;
}

/**
 * Provider API 调用者
 */
export interface ProviderApiActor {
  /** 当前用户 ID */
  userId: string;

  /** 当前用户组 */
  groups?: string[];

  /** 当前角色 */
  roles?: string[];
}

/**
 * Provider API 客户端契约
 */
export interface ProviderApiClient {
  /** Provider 名称 */
  readonly provider: string;

  /** Provider API 基础 URL */
  readonly baseUrl: string;

  /**
   * 发送统一 API 请求
   * @param request 请求描述
   * @param actor 当前调用者
   */
  request<T = unknown>(
    request: ProviderApiRequest,
    actor: ProviderApiActor,
  ): Promise<ProviderApiResponse<T>>;

  /**
   * 获取用户 token，必要时懒刷新
   * @param userId 用户 ID
   */
  getUserToken(userId: string): Promise<ProviderTokenRecord | null>;

  /**
   * 获取应用 token，必要时懒刷新
   * @param ownerId 应用 token 所属 ID
   */
  getAppToken(ownerId?: string): Promise<ProviderTokenRecord | null>;

  /**
   * 刷新用户 token
   * @param userId 用户 ID
   */
  refreshUserToken(userId: string): Promise<ProviderTokenRecord>;

  /**
   * 探测 token 是否可用
   * @param record token 记录
   */
  probeToken(record: ProviderTokenRecord): Promise<ProviderTokenStatus>;
}

/**
 * Provider API 配置
 */
export interface ProviderApiRuntimeConfig {
  /** 是否启用统一 Provider API */
  enabled: boolean;

  /** token 加密密钥，生产环境必须替换 */
  tokenEncryptionKey: string;

  /** 过期前多少秒触发懒刷新 */
  refreshSkewSeconds: number;

  /** 后台探活间隔秒数 */
  probeIntervalSeconds: number;

  /** 是否开放 SDK 代理路由 */
  sdkProxy: boolean;

  /** Provider 级配置 */
  providers: Record<string, ProviderApiProviderConfig>;
}

/**
 * 单个 Provider API 配置
 */
export interface ProviderApiProviderConfig {
  /** 是否启用 */
  enabled: boolean;

  /** Provider API 基础 URL */
  baseUrl?: string;

  /** 允许通过 SDK 代理调用的操作标识 */
  allowedOperations?: string[];

  /** 应用 token 所属默认 ID */
  defaultAppOwnerId?: string;

  /** Provider 特定配置 */
  config?: Record<string, any>;
}
