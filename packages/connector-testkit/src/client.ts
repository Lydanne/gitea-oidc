import {
  type AuthSessionView,
  type BeginLoginInput,
  type CompleteCallbackInput,
  type LogoutInput,
  MemoryAuthSessionStore,
  MemoryLoginTransactionStore,
  MemoryRefreshLock,
  type NodeOidcClient,
  type NodeOidcClientOptions,
} from "@gitea-oidc/node";
import type { ConnectorConformanceConfiguration } from "./types.js";

export const CONFORMANCE_NOW = Date.parse("2026-07-10T08:00:00.000Z");
export const CONFORMANCE_TRANSACTION_ID = "t".repeat(43);
export const CONFORMANCE_SESSION_ID = "s".repeat(43);

export const CONFORMANCE_CONFIGURATION: ConnectorConformanceConfiguration = Object.freeze({
  redirectUri: "https://app.example.com/oidc/callback",
  postLogoutRedirectUri: "https://app.example.com/signed-out",
  clock: () => CONFORMANCE_NOW,
});

export const CONFORMANCE_SESSION: AuthSessionView = Object.freeze({
  authenticated: true,
  user: Object.freeze({ subject: "user-1", name: "示例用户" }),
  scopes: Object.freeze(["openid", "profile"]),
  canRefresh: false,
  createdAt: "2026-07-10T08:00:00.000Z",
  expiresAt: "2026-07-10T09:00:00.000Z",
});

export interface ConformanceClientCalls {
  readonly beginLogin: BeginLoginInput[];
  readonly completeCallback: CompleteCallbackInput[];
  readonly getSession: string[];
  readonly logout: LogoutInput[];
  close: number;
}

export interface ConformanceClientController {
  readonly client: NodeOidcClient;
  readonly calls: ConformanceClientCalls;
  failNextCallback(error: unknown): void;
  failNextLogout(error: unknown): void;
  setSessionResponse(value: unknown): void;
}

export const createConformanceClient = (): ConformanceClientController => {
  const calls: ConformanceClientCalls = {
    beginLogin: [],
    completeCallback: [],
    getSession: [],
    logout: [],
    close: 0,
  };
  let callbackError: unknown;
  let logoutError: unknown;
  let sessionResponse: unknown = CONFORMANCE_SESSION;

  const client: NodeOidcClient = {
    async beginLogin(input = {}) {
      calls.beginLogin.push(input);
      return {
        authorizationUrl: "https://id.example.com/authorize?state=server-state",
        transactionId: CONFORMANCE_TRANSACTION_ID,
        expiresAt: "2026-07-10T08:10:00.000Z",
      };
    },
    async completeCallback(input) {
      calls.completeCallback.push(input);
      if (callbackError !== undefined) {
        const error = callbackError;
        callbackError = undefined;
        throw error;
      }
      return {
        sessionId: CONFORMANCE_SESSION_ID,
        session: CONFORMANCE_SESSION,
        returnTo: "/dashboard",
      };
    },
    async getSession(sessionId) {
      calls.getSession.push(sessionId);
      return sessionResponse as AuthSessionView | null;
    },
    async refreshSession() {
      return CONFORMANCE_SESSION;
    },
    async logout(input) {
      calls.logout.push(input);
      if (logoutError !== undefined) {
        const error = logoutError;
        logoutError = undefined;
        throw error;
      }
      return {
        logoutUrl: "https://id.example.com/session/end",
        warnings: [],
      };
    },
    async close() {
      calls.close += 1;
    },
  };

  return {
    client,
    calls,
    failNextCallback(error) {
      callbackError = error;
    },
    failNextLogout(error) {
      logoutError = error;
    },
    setSessionResponse(value) {
      sessionResponse = value;
    },
  };
};

export const createOwnedConformanceClientOptions = (): NodeOidcClientOptions => {
  const connection: NodeOidcClientOptions["connection"] = {
    schemaVersion: 1,
    applicationId: "app-1",
    oidcClientId: "oidc-client-1",
    issuer: "https://id.example.com",
    clientId: "client-1",
    clientType: "confidential",
    clientAuthMethod: "client_secret_basic",
    redirectUris: [CONFORMANCE_CONFIGURATION.redirectUri],
    postLogoutRedirectUris: [CONFORMANCE_CONFIGURATION.postLogoutRedirectUri],
    scopes: ["openid", "profile"],
    resources: [],
    flow: "authorization_code",
    pkce: { policy: "required", methods: ["S256"] },
    capabilities: { refreshToken: false, providerApi: false, resourceServer: false },
  };
  return {
    connection,
    credential: {
      schemaVersion: 1,
      applicationId: connection.applicationId,
      oidcClientId: connection.oidcClientId,
      issuer: connection.issuer,
      clientId: connection.clientId,
      kind: "client_secret",
      clientSecret: "one-time-secret-value",
    },
    transactionStore: new MemoryLoginTransactionStore(),
    sessionStore: new MemoryAuthSessionStore(),
    refreshLock: new MemoryRefreshLock(),
  };
};
