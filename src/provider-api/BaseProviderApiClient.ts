/**
 * Provider API 客户端基类
 */

import type {
  ProviderApiActor,
  ProviderApiOperationDefinition,
  ProviderApiRequest,
  ProviderApiResponse,
  ProviderTokenRecord,
  ProviderTokenRepository,
} from "../types/providerApi";

const DISALLOWED_CALLER_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "te",
  "trailer",
  "proxy-connection",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-prefix",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "fastly-client-ip",
  "x-http-method-override",
  "x-method-override",
  "x-original-method",
  "x-original-url",
  "x-rewrite-url",
  "x-envoy-original-path",
  "x-original-forwarded-for",
  "x-request-start",
  "x-accel-redirect",
]);
const SAFE_PROVIDER_RESPONSE_HEADER_NAMES = new Set(["content-type", "content-language"]);
const DEFAULT_PROVIDER_API_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_PROVIDER_API_RESPONSE_BODY_LIMIT_BYTES = 1024 * 1024;
const PROVIDER_API_RESPONSE_BODY_TOO_LARGE_MESSAGE = "Provider API response body is too large";

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

  /** Provider API 出站请求超时时间（毫秒） */
  requestTimeoutMs?: number;

  /** Provider API 响应体读取上限（字节） */
  responseBodyLimitBytes?: number;

  /** SDK 代理允许的操作 */
  allowedOperations?: string[];

  /** 服务端维护的操作定义 */
  operationDefinitions?: ProviderApiOperationDefinition[];

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
  protected requestTimeoutMs: number;
  protected responseBodyLimitBytes: number;
  protected allowedOperations = new Set<string>();
  protected operationDefinitions = new Map<string, ProviderApiOperationDefinition>();
  protected defaultAppOwnerId: string;
  private readonly userRefreshFlights = new Map<string, Promise<ProviderTokenRecord>>();

  constructor(options: BaseProviderApiClientOptions) {
    this.provider = options.provider;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokenRepository = options.tokenRepository;
    this.refreshSkewSeconds = options.refreshSkewSeconds;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_PROVIDER_API_REQUEST_TIMEOUT_MS;
    this.responseBodyLimitBytes =
      options.responseBodyLimitBytes ?? DEFAULT_PROVIDER_API_RESPONSE_BODY_LIMIT_BYTES;
    this.defaultAppOwnerId = options.defaultAppOwnerId ?? "default";

    for (const definition of options.operationDefinitions ?? []) {
      this.operationDefinitions.set(definition.operation, definition);
    }

    for (const operation of options.allowedOperations ?? []) {
      if (!this.operationDefinitions.has(operation)) {
        throw new Error(`Unknown Provider API operation configured: ${operation}`);
      }
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
    const operation = this.resolveOperation(request);
    const token =
      request.tokenKind === "app"
        ? await this.getAppToken(request.ownerId)
        : await this.getUserToken(request.ownerId ?? actor.userId);

    if (!token) {
      throw new Error(`Provider token not found: ${this.provider}/${request.tokenKind}`);
    }
    if (!isUsableProviderToken(token)) {
      throw new Error(`Provider token not found: ${this.provider}/${request.tokenKind}`);
    }

    const headers: Record<string, string> = { ...(operation.headers ?? {}) };
    headers.Authorization = `Bearer ${token.accessToken}`;

    return this.send<T>({
      method: operation.method,
      path: operation.path,
      query: operation.query,
      headers,
      body: operation.body,
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

    if (token.status === "revoked" || token.status === "refresh_failed") {
      return null;
    }

    if (this.shouldRefresh(token)) {
      return this.refreshUserToken(userId);
    }

    return isUsableProviderToken(token) ? token : null;
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
   * 同一 provider/user 同时到达的请求共用一次刷新，避免两个旧 refresh token 竞态：
   * 一个刷新成功后，另一个失败再把新记录误标为 refresh_failed。
   */
  protected refreshUserTokenSingleFlight(
    userId: string,
    refresh: () => Promise<ProviderTokenRecord>,
  ): Promise<ProviderTokenRecord> {
    const key = `${this.provider}:${userId}`;
    const active = this.userRefreshFlights.get(key);
    if (active) {
      return active;
    }

    const flight = refresh().finally(() => {
      this.userRefreshFlights.delete(key);
    });
    this.userRefreshFlights.set(key, flight);
    return flight;
  }

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
    method: ProviderApiOperationDefinition["method"];
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
      signal: this.createRequestSignal(),
    });

    const data = await this.readResponseData<T>(response);

    const headers = pickSafeProviderResponseHeaders(response.headers);

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

  protected createRequestSignal(): AbortSignal {
    return createProviderApiRequestSignal(this.requestTimeoutMs);
  }

  protected async readResponseJson<T = unknown>(response: Response): Promise<T> {
    const text = await readProviderResponseText(response, this.responseBodyLimitBytes);
    return JSON.parse(text) as T;
  }

  protected async readResponseData<T = unknown>(response: Response): Promise<T | string> {
    const contentType = getProviderResponseHeader(response.headers, "content-type") ?? "";
    const text = await readProviderResponseText(response, this.responseBodyLimitBytes);
    return contentType.toLowerCase().includes("application/json") ? (JSON.parse(text) as T) : text;
  }

  private resolveOperation(request: ProviderApiRequest): {
    method: ProviderApiOperationDefinition["method"];
    path: string;
    query?: ProviderApiRequest["query"];
    headers?: Record<string, string>;
    body?: unknown;
  } {
    if (this.allowedOperations.size === 0) {
      throw new Error(`No Provider API operations are configured for provider: ${this.provider}`);
    }

    if (!request.operation || !this.allowedOperations.has(request.operation)) {
      throw new Error(`Provider API operation is not allowed: ${request.operation ?? "unknown"}`);
    }

    const definition = this.operationDefinitions.get(request.operation);
    if (!definition) {
      throw new Error(`Provider API operation is not registered: ${request.operation}`);
    }
    const allowedTokenKinds = new Set(definition.allowedTokenKinds ?? ["user"]);
    if (!allowedTokenKinds.has(request.tokenKind)) {
      throw new Error(
        `Provider API operation ${request.operation} does not allow ${request.tokenKind} token`,
      );
    }

    const renderedPath = renderOperationPath(definition.path, request.pathParams);
    if (request.method && request.method !== definition.method) {
      throw new Error(
        `Provider API method does not match operation ${request.operation}: ${request.method}`,
      );
    }

    if (request.path && request.path !== definition.path && request.path !== renderedPath) {
      throw new Error(`Provider API path does not match operation ${request.operation}`);
    }

    const query = validateOperationQuery(definition, request.query);
    const headers = validateOperationHeaders(definition, request.headers);

    if (request.body !== undefined && !definition.allowBody) {
      throw new Error(`Provider API operation does not allow request body: ${request.operation}`);
    }

    return {
      method: definition.method,
      path: renderedPath,
      query,
      headers,
      body: request.body,
    };
  }
}

function validateOperationQuery(
  definition: ProviderApiOperationDefinition,
  query: ProviderApiRequest["query"],
): ProviderApiRequest["query"] {
  if (!query) {
    return undefined;
  }

  const allowed = new Set(definition.allowedQueryParams ?? []);
  const sanitized: NonNullable<ProviderApiRequest["query"]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (!allowed.has(key)) {
      throw new Error(
        `Provider API operation does not allow query parameter ${key}: ${definition.operation}`,
      );
    }
    if (!isProviderApiScalar(value)) {
      throw new Error(`Provider API query parameter must be a scalar value: ${key}`);
    }
    sanitized[key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function validateOperationHeaders(
  definition: ProviderApiOperationDefinition,
  headers: ProviderApiRequest["headers"],
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const allowed = new Set((definition.allowedHeaders ?? []).map((header) => header.toLowerCase()));
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!isValidHttpHeaderName(key)) {
      throw new Error(`Provider API request header name is invalid: ${key}`);
    }

    const normalizedKey = key.toLowerCase();
    if (isDisallowedCallerHeaderName(normalizedKey)) {
      throw new Error(`Provider API request header is reserved: ${key}`);
    }

    if (!allowed.has(normalizedKey)) {
      throw new Error(
        `Provider API operation does not allow request header ${key}: ${definition.operation}`,
      );
    }
    if (typeof value !== "string") {
      throw new Error(`Provider API request header must be a string: ${key}`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`Provider API request header value is invalid: ${key}`);
    }
    sanitized[key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function renderOperationPath(
  template: string,
  params: ProviderApiRequest["pathParams"] = {},
): string {
  return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (placeholder, key) => {
    const value = params[key];
    if (value === undefined || value === "") {
      throw new Error(`Provider API operation path parameter is required: ${key}`);
    }
    if (!isProviderApiScalar(value)) {
      throw new Error(`Provider API operation path parameter must be a scalar value: ${key}`);
    }

    const pathSegment = String(value);
    if (!isSafeProviderApiPathSegment(pathSegment)) {
      throw new Error(`Provider API operation path parameter must be a safe path segment: ${key}`);
    }

    return encodeURIComponent(pathSegment);
  });
}

function isProviderApiScalar(value: unknown): value is string | number | boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "string" || typeof value === "boolean";
}

function isSafeProviderApiPathSegment(value: string): boolean {
  return value !== "." && value !== ".." && /^[A-Za-z0-9._~-]+$/.test(value);
}

function isValidHttpHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function isDisallowedCallerHeaderName(normalizedKey: string): boolean {
  return (
    DISALLOWED_CALLER_HEADER_NAMES.has(normalizedKey) || normalizedKey.startsWith("x-forwarded-")
  );
}

function pickSafeProviderResponseHeaders(
  headers: Headers | Map<string, string>,
): Record<string, string> {
  const safeHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (SAFE_PROVIDER_RESPONSE_HEADER_NAMES.has(normalizedKey)) {
      safeHeaders[normalizedKey] = value;
    }
  });
  return safeHeaders;
}

async function readProviderResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = getProviderResponseHeader(response.headers, "content-length");
  if (contentLength !== null) {
    const parsedContentLength = Number(contentLength);
    if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBytes) {
      throw new Error(PROVIDER_API_RESPONSE_BODY_TOO_LARGE_MESSAGE);
    }
  }

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = normalizeProviderResponseChunk(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel(PROVIDER_API_RESPONSE_BODY_TOO_LARGE_MESSAGE);
          } catch {
            // Best-effort cleanup; keep the security error stable for callers.
          }
          throw new Error(PROVIDER_API_RESPONSE_BODY_TOO_LARGE_MESSAGE);
        }
        chunks.push(chunk);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Some mocked readers or canceled streams may not allow releasing here.
      }
    }

    return decodeProviderResponseChunks(chunks, totalBytes);
  }

  if (typeof response.text === "function") {
    const text = await response.text();
    assertProviderResponseTextWithinLimit(text, maxBytes);
    return text;
  }

  if (typeof response.json === "function") {
    const data = await response.json();
    const text = JSON.stringify(data);
    assertProviderResponseTextWithinLimit(text, maxBytes);
    return text;
  }

  return "";
}

function getProviderResponseHeader(
  headers: Headers | Map<string, string> | undefined,
  name: string,
): string | null {
  if (!headers) {
    return null;
  }

  const directValue = headers.get(name);
  if (typeof directValue === "string") {
    return directValue;
  }

  const normalizedName = name.toLowerCase();
  let matchedValue: string | null = null;
  headers.forEach((value, key) => {
    if (key.toLowerCase() === normalizedName) {
      matchedValue = value;
    }
  });

  return matchedValue;
}

function normalizeProviderResponseChunk(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  return Buffer.from(String(value), "utf8");
}

function decodeProviderResponseChunks(chunks: Uint8Array[], totalBytes: number): string {
  if (chunks.length === 0) {
    return "";
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    totalBytes,
  ).toString("utf8");
}

function assertProviderResponseTextWithinLimit(text: string, maxBytes: number): void {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error(PROVIDER_API_RESPONSE_BODY_TOO_LARGE_MESSAGE);
  }
}

function isUsableProviderToken(token: ProviderTokenRecord): boolean {
  return token.status === "valid";
}

function createProviderApiRequestSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof (timeout as any).unref === "function") {
    (timeout as any).unref();
  }
  return controller.signal;
}
