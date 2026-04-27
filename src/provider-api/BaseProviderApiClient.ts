/**
 * Provider API 客户端基类
 */

import type {
  ProviderApiActor,
  ProviderApiRequest,
  ProviderApiResponse,
  ProviderTokenRecord,
  ProviderTokenRepository,
} from "../types/providerApi";

/**
 * Provider API 客户端基类配置
 */
export interface BaseProviderApiClientOptions {
  /** Provider 名称 */
  provider: string;

  /** Provider API 基础 URL */
  baseUrl: string;

  /** token 仓储 */
  tokenRepository: ProviderTokenRepository;

  /** 过期前多少秒刷新 */
  refreshSkewSeconds: number;

  /** SDK 代理允许的操作 */
  allowedOperations?: string[];

  /** 默认应用 token 所属 ID */
  defaultAppOwnerId?: string;
}

/**
 * Provider API 客户端基类
 */
export abstract class BaseProviderApiClient {
  readonly provider: string;
  readonly baseUrl: string;

  protected tokenRepository: ProviderTokenRepository;
  protected refreshSkewSeconds: number;
  protected allowedOperations = new Set<string>();
  protected defaultAppOwnerId: string;

  constructor(options: BaseProviderApiClientOptions) {
    this.provider = options.provider;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokenRepository = options.tokenRepository;
    this.refreshSkewSeconds = options.refreshSkewSeconds;
    this.defaultAppOwnerId = options.defaultAppOwnerId ?? "default";

    for (const operation of options.allowedOperations ?? []) {
      this.allowedOperations.add(operation);
    }
  }

  /**
   * 发送统一 Provider API 请求
   * @param request 请求描述
   * @param actor 当前调用者
   */
  async request<T = unknown>(
    request: ProviderApiRequest,
    actor: ProviderApiActor,
  ): Promise<ProviderApiResponse<T>> {
    this.assertAllowedOperation(request.operation);
    const token =
      request.tokenKind === "app"
        ? await this.getAppToken(request.ownerId)
        : await this.getUserToken(request.ownerId ?? actor.userId);

    if (!token) {
      throw new Error(`Provider token not found: ${this.provider}/${request.tokenKind}`);
    }

    const headers: Record<string, string> = { ...(request.headers ?? {}) };
    delete headers.Authorization;
    delete headers.authorization;
    headers.Authorization = `Bearer ${token.accessToken}`;

    return this.send<T>({
      method: request.method,
      path: request.path,
      query: request.query,
      headers,
      body: request.body,
    });
  }

  /**
   * 获取用户 token，必要时懒刷新
   * @param userId 用户 ID
   */
  async getUserToken(userId: string): Promise<ProviderTokenRecord | null> {
    const token = await this.tokenRepository.find(this.provider, "user", userId);
    if (!token) {
      return null;
    }

    if (this.shouldRefresh(token)) {
      return this.refreshUserToken(userId);
    }

    return token;
  }

  /**
   * 获取应用 token
   * @param ownerId 应用 token 所属 ID
   */
  abstract getAppToken(ownerId?: string): Promise<ProviderTokenRecord | null>;

  /**
   * 刷新用户 token
   * @param userId 用户 ID
   */
  abstract refreshUserToken(userId: string): Promise<ProviderTokenRecord>;

  /**
   * 探测 token 健康状态
   * @param record token 记录
   */
  abstract probeToken(record: ProviderTokenRecord): Promise<ProviderTokenRecord["status"]>;

  /**
   * 判断 token 是否需要刷新
   * @param token token 记录
   * @returns 是否需要刷新
   */
  protected shouldRefresh(token: ProviderTokenRecord): boolean {
    if (!token.expiresAt) {
      return false;
    }

    return token.expiresAt.getTime() - Date.now() <= this.refreshSkewSeconds * 1000;
  }

  /**
   * 发送底层 HTTP 请求
   * @param request 请求描述
   */
  protected async send<T>(request: {
    method: ProviderApiRequest["method"];
    path: string;
    query?: ProviderApiRequest["query"];
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<ProviderApiResponse<T>> {
    const url = this.buildUrl(request.path, request.query);
    const response = await fetch(url, {
      method: request.method,
      headers: {
        ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(request.headers ?? {}),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    if (!response.ok) {
      throw new Error(`Provider API request failed: ${response.status}`);
    }

    return {
      status: response.status,
      headers,
      data: data as T,
    };
  }

  private buildUrl(path: string, query?: ProviderApiRequest["query"]): string {
    if (/^https?:\/\//i.test(path) || path.startsWith("//")) {
      throw new Error("Provider API path must be relative");
    }

    const base = new URL(`${this.baseUrl}/`);
    const relativePath = path.replace(/^\/+/, "");
    const url = new URL(relativePath, base);

    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error("Provider API path must stay under provider base URL");
    }

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private assertAllowedOperation(operation?: string): void {
    if (this.allowedOperations.size === 0) {
      return;
    }

    if (!operation || !this.allowedOperations.has(operation)) {
      throw new Error(`Provider API operation is not allowed: ${operation ?? "unknown"}`);
    }
  }
}
