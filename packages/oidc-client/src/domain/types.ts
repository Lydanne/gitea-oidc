import type { ApplicationConnectionV1, ApplicationCredentialV1 } from "@x-oidc/contracts";

export interface AuthUserProfile {
  subject: string;
  name?: string;
  preferredUsername?: string;
  email?: string;
  emailVerified?: boolean;
  picture?: string;
  groups?: readonly string[];
}

/** 可暴露给应用层的认证会话视图。该结构永远不包含 Token 或内部 Session ID。 */
export interface AuthSessionView {
  authenticated: true;
  user: Readonly<AuthUserProfile>;
  scopes: readonly string[];
  canRefresh: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface LoginTransaction {
  ownerNamespace: string;
  transactionId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  scopes: readonly string[];
  resources: readonly string[];
  createdAt: number;
  expiresAt: number;
}

export interface SensitiveTokenSet {
  accessToken: string;
  tokenType: "Bearer";
  refreshToken?: string;
  idToken?: string;
  accessTokenExpiresAt?: number;
}

/**
 * Session Store 的持久化记录。该结构包含明文 Token，外部实现必须加密静态数据，且不得记录日志。
 */
export interface SensitiveAuthSessionRecord {
  ownerNamespace: string;
  sessionId: string;
  subject: string;
  user: AuthUserProfile;
  scopes: readonly string[];
  resources: readonly string[];
  tokens: SensitiveTokenSet;
  refreshVersion: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface OidcIdentityClaims {
  sub: string;
  name?: unknown;
  preferred_username?: unknown;
  email?: unknown;
  email_verified?: unknown;
  picture?: unknown;
  groups?: unknown;
  [claim: string]: unknown;
}

export interface OidcProtocolTokenSet {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  scope?: string;
  claims?: OidcIdentityClaims;
}

export interface BeginLoginInput {
  redirectUri?: string;
  returnTo?: string;
  scopes?: readonly string[];
  resources?: readonly string[];
}

export interface BeginLoginResult {
  authorizationUrl: string;
  /** 仅供连接器写入短期 HttpOnly Cookie，不得放入 URL、日志或前端存储。 */
  transactionId: string;
  expiresAt: string;
}

export interface CompleteCallbackInput {
  /**
   * 只接收 OAuth 回调参数。SDK 会使用服务端保存的 redirectUri 构造 current URL，
   * 因而不会信任代理头或请求 Host。
   */
  callbackParameters:
    | string
    | URLSearchParams
    | Readonly<Record<string, string | readonly string[] | undefined>>;
  /** 来自 beginLogin 响应并由连接器保存在短期 Cookie 中的事务标识。 */
  transactionId: string;
}

export interface CompleteCallbackResult {
  /** 连接器必须在认证成功后轮换并写入安全的会话 Cookie。 */
  sessionId: string;
  session: AuthSessionView;
  returnTo: string;
}

export interface LogoutInput {
  sessionId: string;
  postLogoutRedirectUri?: string;
}

export interface LogoutResult {
  logoutUrl?: string;
  warnings: readonly LogoutWarning[];
}

export type LogoutWarning = "REFRESH_TOKEN_REVOCATION_FAILED" | "ACCESS_TOKEN_REVOCATION_FAILED";

export interface NodeOidcClientOptions {
  connection: ApplicationConnectionV1;
  credential: ApplicationCredentialV1;
  transactionStore: import("../ports/transactionStore.js").LoginTransactionStore;
  sessionStore: import("../ports/sessionStore.js").AuthSessionStore;
  refreshLock: import("../ports/refreshLock.js").RefreshLock;
  transactionTtlMs?: number;
  sessionTtlMs?: number;
  requestTimeoutSeconds?: number;
}

export type InMemoryNodeOidcClientOptions = Omit<
  NodeOidcClientOptions,
  "transactionStore" | "sessionStore" | "refreshLock"
>;

/** 仅供内部测试入口使用；生产工厂不会接受协议替身、时钟或随机数替身。 */
export interface TestingNodeOidcClientOptions extends NodeOidcClientOptions {
  protocolAdapter?: import("../ports/oidcProtocol.js").OidcProtocolAdapter;
  clock?: () => number;
  randomOpaqueValue?: () => string;
  /** 仅用于验证 owned resource 的关闭竞态；生产工厂会丢弃该字段。 */
  ownsProtocolAdapterForTesting?: boolean;
}

export interface NodeOidcClient {
  beginLogin(input?: BeginLoginInput): Promise<BeginLoginResult>;
  completeCallback(input: CompleteCallbackInput): Promise<CompleteCallbackResult>;
  getSession(sessionId: string): Promise<AuthSessionView | null>;
  refreshSession(sessionId: string): Promise<AuthSessionView>;
  logout(input: LogoutInput): Promise<LogoutResult>;
  close(): Promise<void>;
}
