/**
 * 危险的测试入口：允许替换 OIDC 协议、时钟和随机数，不得由生产连接器导入或透传。
 */
export {
  classifyOpenIdClientFailure,
  OpenIdClientProtocolAdapter,
  type OpenIdClientProtocolOptions,
  validateLoopbackServerMetadata,
} from "../adapters/openidClientProtocol.js";
export { createNodeOidcClientForTesting } from "../core/nodeOidcClient.js";
export type { TestingNodeOidcClientOptions } from "../domain/types.js";
export {
  type BuildAuthorizationUrlInput,
  type BuildLogoutUrlInput,
  type ExchangeAuthorizationCodeInput,
  isOidcProtocolError,
  type OidcProtocolAdapter,
  OidcProtocolError,
  type OidcProtocolFailureKind,
  type RefreshTokensInput,
  type RevokeTokenInput,
} from "../ports/oidcProtocol.js";
