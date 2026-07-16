import type { ApplicationConnectionV1, ApplicationCredentialV1 } from "@x-oidc/contracts";
import * as client from "openid-client";
import type { OidcProtocolTokenSet } from "../domain/types.js";
import type {
  BuildAuthorizationUrlInput,
  BuildLogoutUrlInput,
  ExchangeAuthorizationCodeInput,
  OidcProtocolAdapter,
  RefreshTokensInput,
  RevokeTokenInput,
} from "../ports/oidcProtocol.js";
import {
  isOidcProtocolError,
  OidcProtocolError,
  type OidcProtocolFailureKind,
} from "../ports/oidcProtocol.js";

export interface OpenIdClientProtocolOptions {
  requestTimeoutSeconds?: number;
}

const toTokenSet = (
  response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
): OidcProtocolTokenSet => ({
  accessToken: response.access_token,
  tokenType: response.token_type,
  refreshToken: response.refresh_token,
  idToken: response.id_token,
  expiresIn: response.expires_in,
  scope: response.scope,
  claims: response.claims() as OidcProtocolTokenSet["claims"],
});

const appendResources = (parameters: URLSearchParams, resources: readonly string[]): void => {
  for (const resource of resources) {
    parameters.append("resource", resource);
  }
};

const LOOPBACK_ENDPOINT_FIELDS = [
  "authorization_endpoint",
  "token_endpoint",
  "jwks_uri",
  "userinfo_endpoint",
  "revocation_endpoint",
  "introspection_endpoint",
  "end_session_endpoint",
  "pushed_authorization_request_endpoint",
  "device_authorization_endpoint",
  "registration_endpoint",
  "backchannel_authentication_endpoint",
] as const;

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) <= 255)
  );
};

export const validateLoopbackServerMetadata = (
  issuer: URL,
  metadata: Readonly<Record<string, unknown>>,
): void => {
  if (issuer.protocol !== "http:") {
    return;
  }
  if (!isLoopbackHostname(issuer.hostname)) {
    throw new OidcProtocolError("UNSAFE_METADATA");
  }

  for (const field of LOOPBACK_ENDPOINT_FIELDS) {
    const value = metadata[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      throw new OidcProtocolError("UNSAFE_METADATA");
    }
    let endpoint: URL;
    try {
      endpoint = new URL(value);
    } catch {
      throw new OidcProtocolError("UNSAFE_METADATA");
    }
    if (
      endpoint.origin !== issuer.origin ||
      endpoint.protocol !== "http:" ||
      !isLoopbackHostname(endpoint.hostname) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash
    ) {
      throw new OidcProtocolError("UNSAFE_METADATA");
    }
  }
};

export const classifyOpenIdClientFailure = (error: unknown): OidcProtocolError => {
  if (isOidcProtocolError(error)) {
    return error;
  }
  if (error instanceof client.ResponseBodyError) {
    let kind: OidcProtocolFailureKind;
    switch (error.error) {
      case "invalid_grant":
        kind = "INVALID_GRANT";
        break;
      case "server_error":
      case "temporarily_unavailable":
        kind = "TRANSIENT";
        break;
      default:
        kind = "TERMINAL";
    }
    return new OidcProtocolError(kind);
  }
  return new OidcProtocolError("TRANSIENT");
};

const safely = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw classifyOpenIdClientFailure(error);
  }
};

/** `openid-client` v6 的薄适配层，所有协议校验和 Token 响应校验都由上游库执行。 */
export class OpenIdClientProtocolAdapter implements OidcProtocolAdapter {
  readonly #connection: ApplicationConnectionV1;
  readonly #credential: ApplicationCredentialV1;
  readonly #requestTimeoutSeconds: number;
  #configurationPromise?: Promise<client.Configuration>;

  constructor(
    connection: ApplicationConnectionV1,
    credential: ApplicationCredentialV1,
    options: OpenIdClientProtocolOptions = {},
  ) {
    this.#connection = connection;
    this.#credential = credential;
    this.#requestTimeoutSeconds = options.requestTimeoutSeconds ?? 10;
  }

  async buildAuthorizationUrl(input: BuildAuthorizationUrlInput): Promise<URL> {
    return safely(async () => {
      const configuration = await this.#configuration();
      const codeChallenge = await client.calculatePKCECodeChallenge(input.codeVerifier);
      const parameters = new URLSearchParams({
        redirect_uri: input.redirectUri,
        scope: input.scopes.join(" "),
        state: input.state,
        nonce: input.nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      appendResources(parameters, input.resources);
      return client.buildAuthorizationUrl(configuration, parameters);
    });
  }

  async exchangeAuthorizationCode(
    input: ExchangeAuthorizationCodeInput,
  ): Promise<OidcProtocolTokenSet> {
    return safely(async () => {
      const configuration = await this.#configuration();
      const tokenParameters = new URLSearchParams();
      appendResources(tokenParameters, input.resources);
      const response = await client.authorizationCodeGrant(
        configuration,
        input.callbackUrl,
        {
          expectedState: input.expectedState,
          expectedNonce: input.expectedNonce,
          pkceCodeVerifier: input.codeVerifier,
          idTokenExpected: true,
        },
        tokenParameters,
      );
      return toTokenSet(response);
    });
  }

  async refreshTokens(input: RefreshTokensInput): Promise<OidcProtocolTokenSet> {
    return safely(async () => {
      const configuration = await this.#configuration();
      const parameters = new URLSearchParams({ scope: input.scopes.join(" ") });
      appendResources(parameters, input.resources);
      return toTokenSet(
        await client.refreshTokenGrant(configuration, input.refreshToken, parameters),
      );
    });
  }

  async revokeToken(input: RevokeTokenInput): Promise<void> {
    await safely(async () => {
      const configuration = await this.#configuration();
      await client.tokenRevocation(configuration, input.token, {
        token_type_hint: input.tokenTypeHint,
      });
    });
  }

  async buildLogoutUrl(input: BuildLogoutUrlInput): Promise<URL | null> {
    return safely(async () => {
      const configuration = await this.#configuration();
      if (!configuration.serverMetadata().end_session_endpoint) {
        return null;
      }
      const parameters = new URLSearchParams();
      if (input.idTokenHint) {
        parameters.set("id_token_hint", input.idTokenHint);
      }
      if (input.postLogoutRedirectUri) {
        parameters.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
      }
      return client.buildEndSessionUrl(configuration, parameters);
    });
  }

  close(): void {
    this.#configurationPromise = undefined;
  }

  async #configuration(): Promise<client.Configuration> {
    this.#configurationPromise ??= this.#discover();
    try {
      return await this.#configurationPromise;
    } catch (error) {
      this.#configurationPromise = undefined;
      throw error;
    }
  }

  async #discover(): Promise<client.Configuration> {
    const metadata: Partial<client.ClientMetadata> = {
      redirect_uris: [...this.#connection.redirectUris],
      response_types: ["code"],
      grant_types: this.#connection.capabilities.refreshToken
        ? ["authorization_code", "refresh_token"]
        : ["authorization_code"],
      token_endpoint_auth_method: this.#connection.clientAuthMethod,
    };
    const authentication =
      this.#credential.kind === "client_secret"
        ? client.ClientSecretBasic(this.#credential.clientSecret)
        : client.None();
    const issuer = new URL(this.#connection.issuer);
    const configuration = await client.discovery(
      issuer,
      this.#connection.clientId,
      metadata,
      authentication,
      {
        timeout: this.#requestTimeoutSeconds,
        execute: issuer.protocol === "http:" ? [client.allowInsecureRequests] : undefined,
      },
    );
    validateLoopbackServerMetadata(
      issuer,
      configuration.serverMetadata() as Readonly<Record<string, unknown>>,
    );
    return configuration;
  }
}
