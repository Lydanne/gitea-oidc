import type { OidcProtocolTokenSet } from "../domain/types.js";

export type OidcProtocolFailureKind =
  | "INVALID_GRANT"
  | "TERMINAL"
  | "TRANSIENT"
  | "UNSAFE_METADATA";

const PROTOCOL_FAILURE_MESSAGES: Record<OidcProtocolFailureKind, string> = {
  INVALID_GRANT: "OIDC grant 已失效",
  TERMINAL: "OIDC 协议请求被拒绝",
  TRANSIENT: "OIDC 协议请求暂时失败",
  UNSAFE_METADATA: "OIDC metadata 包含不安全端点",
};

/** 只保留固定分类，不携带上游响应、Token、Secret 或 cause。 */
export class OidcProtocolError extends Error {
  readonly kind: OidcProtocolFailureKind;

  constructor(kind: OidcProtocolFailureKind) {
    super(PROTOCOL_FAILURE_MESSAGES[kind]);
    this.name = "OidcProtocolError";
    this.kind = kind;
  }
}

export const isOidcProtocolError = (error: unknown): error is OidcProtocolError =>
  error instanceof OidcProtocolError &&
  PROTOCOL_FAILURE_MESSAGES[error.kind] === error.message &&
  error.cause === undefined;

export interface BuildAuthorizationUrlInput {
  redirectUri: string;
  scopes: readonly string[];
  resources: readonly string[];
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface ExchangeAuthorizationCodeInput {
  callbackUrl: URL;
  redirectUri: string;
  resources: readonly string[];
  expectedState: string;
  expectedNonce: string;
  codeVerifier: string;
}

export interface RefreshTokensInput {
  refreshToken: string;
  scopes: readonly string[];
  resources: readonly string[];
}

export interface BuildLogoutUrlInput {
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
}

export interface RevokeTokenInput {
  token: string;
  tokenTypeHint: "refresh_token" | "access_token";
}

export interface OidcProtocolAdapter {
  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): Promise<URL>;
  exchangeAuthorizationCode(input: ExchangeAuthorizationCodeInput): Promise<OidcProtocolTokenSet>;
  refreshTokens(input: RefreshTokensInput): Promise<OidcProtocolTokenSet>;
  revokeToken(input: RevokeTokenInput): Promise<void>;
  buildLogoutUrl(input: BuildLogoutUrlInput): Promise<URL | null>;
  close?(): Promise<void> | void;
}
