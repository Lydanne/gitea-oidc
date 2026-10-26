import {
  APPLICATION_CONNECTION_SCHEMA_VERSION,
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  type ApplicationConnectionV1,
} from "@x-oidc/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryAuthSessionStore,
  MemoryLoginTransactionStore,
  MemoryRefreshLock,
} from "../adapters/memoryStores.js";
import { createNodeOidcClient } from "../core/nodeOidcClient.js";
import { isNodeOidcError, NODE_OIDC_ERROR_BRAND, NodeOidcError } from "../domain/errors.js";
import type { TestingNodeOidcClientOptions } from "../domain/types.js";
import {
  type BuildAuthorizationUrlInput,
  createNodeOidcClientForTesting,
  type OidcProtocolAdapter,
  OidcProtocolError,
} from "../internal/testing.js";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const CHALLENGE = "c".repeat(43);

const connection: ApplicationConnectionV1 = {
  schemaVersion: APPLICATION_CONNECTION_SCHEMA_VERSION,
  applicationId: "app_01",
  oidcClientId: "oidc_client_01",
  issuer: "https://id.example.com",
  clientId: "client_01",
  clientType: "confidential",
  clientAuthMethod: "client_secret_basic",
  redirectUris: ["https://app.example.com/oidc/callback"],
  postLogoutRedirectUris: ["https://app.example.com/signed-out"],
  scopes: ["openid", "profile", "email", "offline_access"],
  resources: ["https://api.example.com"],
  flow: "authorization_code",
  pkce: { policy: "required", methods: ["S256"] },
  capabilities: { refreshToken: true, providerApi: false, resourceServer: true },
};

const credential = {
  schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  applicationId: connection.applicationId,
  oidcClientId: connection.oidcClientId,
  issuer: connection.issuer,
  clientId: connection.clientId,
  kind: "client_secret" as const,
  clientSecret: "one-time-secret-value",
};

const makeAuthorizationUrl = (input: BuildAuthorizationUrlInput): URL => {
  const url = new URL("https://id.example.com/authorize");
  url.searchParams.set("client_id", connection.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  for (const resource of input.resources) {
    url.searchParams.append("resource", resource);
  }
  return url;
};

const createProtocol = () =>
  ({
    buildAuthorizationUrl: vi.fn(async (input: BuildAuthorizationUrlInput) =>
      makeAuthorizationUrl(input),
    ),
    exchangeAuthorizationCode: vi.fn(async () => ({
      accessToken: "access-token-secret",
      tokenType: "Bearer",
      refreshToken: "refresh-token-secret",
      idToken: "id-token-secret",
      expiresIn: 300,
      scope: connection.scopes.join(" "),
      claims: {
        sub: "user-1",
        name: "示例用户",
        email: "user@example.com",
        email_verified: true,
        groups: ["developers"],
      },
    })),
    refreshTokens: vi.fn(async () => ({
      accessToken: "rotated-access-token",
      tokenType: "Bearer",
      refreshToken: "rotated-refresh-token",
      expiresIn: 600,
      scope: connection.scopes.join(" "),
    })),
    revokeToken: vi.fn(async () => {}),
    buildLogoutUrl: vi.fn(async ({ postLogoutRedirectUri }) => {
      const url = new URL("https://id.example.com/session/end");
      if (postLogoutRedirectUri) {
        url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
      }
      return url;
    }),
    close: vi.fn(),
  }) satisfies OidcProtocolAdapter;

const createRandom = () => {
  let counter = 0;
  return () => {
    counter += 1;
    return String(counter).padStart(43, "A");
  };
};

const createFixture = (overrides: Partial<TestingNodeOidcClientOptions> = {}) => {
  const protocolAdapter = createProtocol();
  const transactionStore = new MemoryLoginTransactionStore({ clock: () => NOW });
  const sessionStore = new MemoryAuthSessionStore({ clock: () => NOW });
  const refreshLock = new MemoryRefreshLock();
  const sessionCreate = vi.spyOn(sessionStore, "create");
  const client = createNodeOidcClientForTesting({
    connection,
    credential,
    transactionStore,
    sessionStore,
    refreshLock,
    protocolAdapter,
    clock: () => NOW,
    randomOpaqueValue: createRandom(),
    ...overrides,
  });
  return {
    client,
    protocolAdapter,
    transactionStore,
    sessionStore,
    sessionCreate,
    refreshLock,
  };
};

const getOwnerNamespace = (fixture: ReturnType<typeof createFixture>) => {
  const created = fixture.sessionCreate.mock.calls[0]?.[0];
  if (!created) {
    throw new Error("test session was not created");
  }
  return created.ownerNamespace;
};

const completeLogin = async (fixture: ReturnType<typeof createFixture>) => {
  const begun = await fixture.client.beginLogin({ returnTo: "/dashboard?tab=security" });
  const request = fixture.protocolAdapter.buildAuthorizationUrl.mock.calls[0]![0];
  const completed = await fixture.client.completeCallback({
    transactionId: begun.transactionId,
    callbackParameters: { code: "authorization-code", state: request.state },
  });
  return { begun, completed, request };
};

describe("Node OIDC client", () => {
  it("binds state to an independent transaction cookie and returns a token-free view", async () => {
    const fixture = createFixture();
    const { begun, completed, request } = await completeLogin(fixture);

    expect(begun.transactionId).not.toBe(request.state);
    expect(completed.returnTo).toBe("/dashboard?tab=security");
    expect(completed.session.user).toMatchObject({
      subject: "user-1",
      email: "user@example.com",
    });
    expect(completed.session.canRefresh).toBe(true);
    expect(JSON.stringify(completed.session)).not.toMatch(/token|sessionId/iu);
    expect(await fixture.client.getSession(completed.sessionId)).toEqual(completed.session);
    expect(fixture.protocolAdapter.exchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: connection.redirectUris[0],
        expectedState: request.state,
      }),
    );
  });

  it("rejects unknown fields returned by an external Session Store", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    const ownerNamespace = getOwnerNamespace(fixture);
    const stored = await fixture.sessionStore.get(ownerNamespace, completed.sessionId);
    if (!stored) {
      throw new Error("expected stored session");
    }
    await fixture.sessionStore.compareAndSwap(
      ownerNamespace,
      completed.sessionId,
      stored.refreshVersion,
      {
        ...stored,
        user: {
          ...stored.user,
          accessToken: "must-not-leak",
          isAdmin: true,
        } as typeof stored.user,
      },
    );

    await expect(fixture.client.getSession(completed.sessionId)).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });
  });

  it("rejects stored scopes, resources, versions and timestamps outside the connection contract", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    const ownerNamespace = getOwnerNamespace(fixture);
    const stored = await fixture.sessionStore.get(ownerNamespace, completed.sessionId);
    if (!stored) throw new Error("expected stored session");
    await fixture.sessionStore.compareAndSwap(
      ownerNamespace,
      completed.sessionId,
      stored.refreshVersion,
      {
        ...stored,
        scopes: ["admin"],
        resources: ["https://evil.example.com"],
        refreshVersion: -999,
        createdAt: 0,
      },
    );

    await expect(fixture.client.getSession(completed.sessionId)).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });
  });

  it("rejects a tampered transaction returned by an external Store", async () => {
    const backingStore = new MemoryLoginTransactionStore({ clock: () => NOW });
    const transactionStore = {
      create: backingStore.create.bind(backingStore),
      async consume(ownerNamespace: string, transactionId: string) {
        const stored = await backingStore.consume(ownerNamespace, transactionId);
        return stored ? { ...stored, scopes: ["openid", "admin"] } : null;
      },
    };
    const fixture = createFixture({ transactionStore });
    const begun = await fixture.client.beginLogin();
    const request = fixture.protocolAdapter.buildAuthorizationUrl.mock.calls[0]![0];

    await expect(
      fixture.client.completeCallback({
        transactionId: begun.transactionId,
        callbackParameters: { code: "code", state: request.state },
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    expect(fixture.protocolAdapter.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("consumes a transaction before rejecting a wrong state", async () => {
    const fixture = createFixture();
    const begun = await fixture.client.beginLogin();

    await expect(
      fixture.client.completeCallback({
        transactionId: begun.transactionId,
        callbackParameters: { code: "code", state: "x".repeat(43) },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });
    await expect(
      fixture.client.completeCallback({
        transactionId: begun.transactionId,
        callbackParameters: { code: "code", state: "x".repeat(43) },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });
    expect(fixture.protocolAdapter.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects a token response without the required Bearer token_type", async () => {
    const fixture = createFixture();
    const begun = await fixture.client.beginLogin();
    const request = fixture.protocolAdapter.buildAuthorizationUrl.mock.calls[0]![0];
    fixture.protocolAdapter.exchangeAuthorizationCode.mockResolvedValueOnce({
      accessToken: "access-token-secret",
      idToken: "id-token-secret",
      scope: connection.scopes.join(" "),
      claims: { sub: "user-1" },
    });

    await expect(
      fixture.client.completeCallback({
        transactionId: begun.transactionId,
        callbackParameters: { code: "code", state: request.state },
      }),
    ).rejects.toMatchObject({ code: "CALLBACK_FAILED" });
  });

  it.each([
    ["absolute returnTo", { returnTo: "https://evil.example.com" }, "INVALID_RETURN_TO"],
    ["protocol-relative returnTo", { returnTo: "//evil.example.com" }, "INVALID_RETURN_TO"],
    ["encoded slash returnTo", { returnTo: "/%2f%2fevil.example.com" }, "INVALID_RETURN_TO"],
    ["normalized double-slash returnTo", { returnTo: "/..//evil.example" }, "INVALID_RETURN_TO"],
    ["encoded dot-segment returnTo", { returnTo: "/%2e%2e//evil.example" }, "INVALID_RETURN_TO"],
    [
      "unregistered redirect",
      { redirectUri: "https://evil.example.com/callback" },
      "INVALID_REDIRECT_URI",
    ],
    ["unregistered scope", { scopes: ["openid", "admin"] }, "INVALID_LOGIN_REQUEST"],
  ])("rejects %s", async (_name, input, code) => {
    const fixture = createFixture();
    await expect(fixture.client.beginLogin(input)).rejects.toMatchObject({ code });
  });

  it("redacts upstream errors and never retains their cause", async () => {
    const fixture = createFixture();
    fixture.protocolAdapter.buildAuthorizationUrl.mockRejectedValueOnce(
      new Error("client_secret=must-never-leak"),
    );

    const error = await fixture.client.beginLogin().catch((caught) => caught);
    expect(error).toBeInstanceOf(NodeOidcError);
    expect(error).toMatchObject({ code: "LOGIN_FAILED", status: 502, expose: false });
    expect(JSON.stringify(error)).not.toContain("must-never-leak");
    expect(error.cause).toBeUndefined();
  });

  it("rebuilds branded errors crossing an injected lock boundary", async () => {
    const maliciousLock = {
      async runExclusive() {
        throw {
          [NODE_OIDC_ERROR_BRAND]: true,
          code: "SESSION_EXPIRED",
          message: "refresh_token=must-never-leak",
          status: 200,
          expose: true,
          retryable: true,
          cause: new Error("access_token=must-never-leak"),
        };
      },
    };
    const fixture = createFixture({ refreshLock: maliciousLock });
    const { completed } = await completeLogin(fixture);

    const error = await fixture.client
      .refreshSession(completed.sessionId)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(NodeOidcError);
    expect(error).toMatchObject({
      code: "SESSION_EXPIRED",
      message: "认证会话已过期",
      status: 401,
      expose: true,
      retryable: false,
    });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("must-never-leak");
  });

  it("rebuilds branded errors crossing an injected session Store boundary", async () => {
    const backingStore = new MemoryAuthSessionStore({ clock: () => NOW });
    const sessionStore = {
      create: backingStore.create.bind(backingStore),
      async get() {
        throw {
          [NODE_OIDC_ERROR_BRAND]: true,
          code: "SESSION_EXPIRED",
          message: "access_token=must-never-leak",
          status: 200,
          expose: true,
          retryable: true,
        };
      },
      compareAndSwap: backingStore.compareAndSwap.bind(backingStore),
      deleteIfVersion: backingStore.deleteIfVersion.bind(backingStore),
      delete: backingStore.delete.bind(backingStore),
    };
    const fixture = createFixture({ sessionStore });

    const error = await fixture.client.getSession("s".repeat(43)).catch((caught) => caught);

    expect(error).toBeInstanceOf(NodeOidcError);
    expect(error).toMatchObject({
      code: "SESSION_EXPIRED",
      message: "认证会话已过期",
      status: 401,
      expose: true,
      retryable: false,
    });
    expect(JSON.stringify(error)).not.toContain("must-never-leak");
  });

  it("deduplicates concurrent refresh and atomically rotates refresh tokens", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);

    const [first, second] = await Promise.all([
      fixture.client.refreshSession(completed.sessionId),
      fixture.client.refreshSession(completed.sessionId),
    ]);
    expect(first).toEqual(second);
    expect(fixture.protocolAdapter.refreshTokens).toHaveBeenCalledTimes(1);
    expect(fixture.protocolAdapter.refreshTokens).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "refresh-token-secret" }),
    );
    const stored = await fixture.sessionStore.get(getOwnerNamespace(fixture), completed.sessionId);
    expect(stored).toMatchObject({
      refreshVersion: 1,
      tokens: { refreshToken: "rotated-refresh-token" },
    });
  });

  it("deletes only the unchanged session after an invalid_grant", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    fixture.protocolAdapter.refreshTokens.mockRejectedValueOnce(
      new OidcProtocolError("INVALID_GRANT"),
    );

    await expect(fixture.client.refreshSession(completed.sessionId)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    await expect(fixture.client.getSession(completed.sessionId)).resolves.toBeNull();
  });

  it("keeps a concurrently rotated session when a stale refresh reports invalid_grant", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    const ownerNamespace = getOwnerNamespace(fixture);
    fixture.protocolAdapter.refreshTokens.mockImplementationOnce(async () => {
      const current = await fixture.sessionStore.get(ownerNamespace, completed.sessionId);
      if (!current) {
        throw new Error("missing test session");
      }
      await fixture.sessionStore.compareAndSwap(
        ownerNamespace,
        completed.sessionId,
        current.refreshVersion,
        {
          ...current,
          tokens: {
            ...current.tokens,
            accessToken: "other-worker-access-token",
            refreshToken: "other-worker-refresh-token",
          },
          refreshVersion: current.refreshVersion + 1,
        },
      );
      throw new OidcProtocolError("INVALID_GRANT");
    });

    const refreshed = await fixture.client.refreshSession(completed.sessionId);

    expect(refreshed.authenticated).toBe(true);
    const stored = await fixture.sessionStore.get(ownerNamespace, completed.sessionId);
    expect(stored).toMatchObject({
      refreshVersion: 1,
      tokens: { refreshToken: "other-worker-refresh-token" },
    });
  });

  it("isolates shared transaction and session stores by client owner namespace", async () => {
    const fixture = createFixture();
    const begun = await fixture.client.beginLogin();
    const request = fixture.protocolAdapter.buildAuthorizationUrl.mock.calls[0]![0];
    const otherConnection: ApplicationConnectionV1 = {
      ...connection,
      applicationId: "app_02",
      oidcClientId: "oidc_client_02",
      clientId: "client_02",
    };
    const otherClient = createNodeOidcClientForTesting({
      connection: otherConnection,
      credential: {
        ...credential,
        applicationId: otherConnection.applicationId,
        oidcClientId: otherConnection.oidcClientId,
        clientId: otherConnection.clientId,
      },
      transactionStore: fixture.transactionStore,
      sessionStore: fixture.sessionStore,
      refreshLock: fixture.refreshLock,
      protocolAdapter: createProtocol(),
      clock: () => NOW,
      randomOpaqueValue: createRandom(),
    });

    await expect(
      otherClient.completeCallback({
        transactionId: begun.transactionId,
        callbackParameters: { code: "code", state: request.state },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });

    const completed = await fixture.client.completeCallback({
      transactionId: begun.transactionId,
      callbackParameters: { code: "code", state: request.state },
    });
    await expect(otherClient.getSession(completed.sessionId)).resolves.toBeNull();
    await expect(fixture.client.getSession(completed.sessionId)).resolves.toEqual(
      completed.session,
    );
  });

  it("deletes the local session before building an allow-listed logout URL", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    const result = await fixture.client.logout({
      sessionId: completed.sessionId,
      postLogoutRedirectUri: connection.postLogoutRedirectUris[0],
    });

    expect(result.logoutUrl).toContain("https://id.example.com/session/end");
    expect(result.warnings).toEqual([]);
    expect(await fixture.client.getSession(completed.sessionId)).toBeNull();
    expect(fixture.protocolAdapter.revokeToken).toHaveBeenCalledWith({
      token: "refresh-token-secret",
      tokenTypeHint: "refresh_token",
    });
    expect(fixture.protocolAdapter.revokeToken).toHaveBeenCalledWith({
      token: "access-token-secret",
      tokenTypeHint: "access_token",
    });
    expect(fixture.protocolAdapter.revokeToken).toHaveBeenCalledTimes(2);
    expect(fixture.protocolAdapter.revokeToken.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.protocolAdapter.buildLogoutUrl.mock.invocationCallOrder[0]!,
    );
    expect(fixture.protocolAdapter.buildLogoutUrl).toHaveBeenCalledWith(
      expect.objectContaining({ idTokenHint: "id-token-secret" }),
    );
  });

  it("keeps logging out and returns redacted partial warnings when one revocation fails", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    fixture.protocolAdapter.revokeToken.mockRejectedValueOnce(
      new Error("refresh_token=must-never-leak"),
    );

    const result = await fixture.client.logout({ sessionId: completed.sessionId });
    expect(result.warnings).toEqual(["REFRESH_TOKEN_REVOCATION_FAILED"]);
    expect(JSON.stringify(result)).not.toContain("must-never-leak");
    expect(await fixture.client.getSession(completed.sessionId)).toBeNull();
    expect(fixture.protocolAdapter.revokeToken).toHaveBeenCalledWith({
      token: "access-token-secret",
      tokenTypeHint: "access_token",
    });
    expect(fixture.protocolAdapter.buildLogoutUrl).toHaveBeenCalledTimes(1);
    await expect(fixture.client.logout({ sessionId: completed.sessionId })).resolves.toEqual({
      warnings: [],
    });
  });

  it("attempts both revocations before returning a redacted OP logout failure", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    fixture.protocolAdapter.revokeToken.mockRejectedValue(new Error("token=must-never-leak"));
    fixture.protocolAdapter.buildLogoutUrl.mockRejectedValueOnce(
      new Error("id_token_hint=must-never-leak"),
    );

    const error = await fixture.client
      .logout({ sessionId: completed.sessionId })
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: "LOGOUT_FAILED", status: 502, expose: false });
    expect(JSON.stringify(error)).not.toContain("must-never-leak");
    expect(fixture.protocolAdapter.revokeToken).toHaveBeenCalledTimes(2);
    expect(fixture.protocolAdapter.buildLogoutUrl).toHaveBeenCalledTimes(1);
  });

  it("revokes the access token when the session has no refresh token", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    const ownerNamespace = getOwnerNamespace(fixture);
    const current = await fixture.sessionStore.get(ownerNamespace, completed.sessionId);
    expect(current).not.toBeNull();
    const { refreshToken: _refreshToken, ...tokens } = current!.tokens;
    await fixture.sessionStore.compareAndSwap(
      ownerNamespace,
      completed.sessionId,
      current!.refreshVersion,
      {
        ...current!,
        tokens,
      },
    );

    await fixture.client.logout({ sessionId: completed.sessionId });
    expect(fixture.protocolAdapter.revokeToken).toHaveBeenCalledWith({
      token: "access-token-secret",
      tokenTypeHint: "access_token",
    });
  });

  it("treats sessions from an older connection policy as missing", async () => {
    const fixture = createFixture();
    const { completed } = await completeLogin(fixture);
    const restrictedConnection: ApplicationConnectionV1 = {
      ...connection,
      scopes: ["openid"],
      resources: [],
      capabilities: { refreshToken: false, providerApi: false, resourceServer: false },
    };
    const restrictedClient = createNodeOidcClientForTesting({
      connection: restrictedConnection,
      credential,
      transactionStore: fixture.transactionStore,
      sessionStore: fixture.sessionStore,
      refreshLock: fixture.refreshLock,
      protocolAdapter: createProtocol(),
      clock: () => NOW,
      randomOpaqueValue: createRandom(),
    });

    await expect(restrictedClient.getSession(completed.sessionId)).resolves.toBeNull();
  });

  it("close drains an accepted beginLogin before closing owned resources", async () => {
    let releaseAuthorization!: () => void;
    let markAuthorizationStarted!: () => void;
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const fixture = createFixture({ ownsProtocolAdapterForTesting: true });
    fixture.protocolAdapter.buildAuthorizationUrl.mockImplementation(async (input) => {
      markAuthorizationStarted();
      await authorizationGate;
      return makeAuthorizationUrl(input);
    });

    const login = fixture.client.beginLogin();
    await authorizationStarted;
    const close = fixture.client.close();
    await Promise.resolve();
    expect(fixture.protocolAdapter.close).not.toHaveBeenCalled();
    await expect(fixture.client.getSession("x".repeat(43))).rejects.toMatchObject({
      code: "CLIENT_CLOSED",
    });

    releaseAuthorization();
    await expect(login).resolves.toMatchObject({ transactionId: expect.any(String) });
    await close;
    expect(fixture.protocolAdapter.close).toHaveBeenCalledOnce();
  });

  it("close waits for an accepted callback before external stores may close", async () => {
    let releaseExchange!: () => void;
    let markExchangeStarted!: () => void;
    const exchangeStarted = new Promise<void>((resolve) => {
      markExchangeStarted = resolve;
    });
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    const fixture = createFixture({ ownsProtocolAdapterForTesting: true });
    fixture.protocolAdapter.exchangeAuthorizationCode.mockImplementation(async () => {
      markExchangeStarted();
      await exchangeGate;
      return {
        accessToken: "access-token-secret",
        tokenType: "Bearer",
        refreshToken: "refresh-token-secret",
        idToken: "id-token-secret",
        expiresIn: 300,
        scope: connection.scopes.join(" "),
        claims: { sub: "user-1" },
      };
    });
    const begun = await fixture.client.beginLogin();
    const request = fixture.protocolAdapter.buildAuthorizationUrl.mock.calls[0]![0];
    const callback = fixture.client.completeCallback({
      transactionId: begun.transactionId,
      callbackParameters: { code: "authorization-code", state: request.state },
    });
    await exchangeStarted;

    const close = fixture.client.close();
    await Promise.resolve();
    expect(fixture.protocolAdapter.close).not.toHaveBeenCalled();
    releaseExchange();
    await expect(callback).resolves.toMatchObject({ session: { authenticated: true } });
    await close;
    expect(fixture.protocolAdapter.close).toHaveBeenCalledOnce();
  });

  it("does not close injected resources and rejects operations after close", async () => {
    const fixture = createFixture();
    const transactionClose = vi.spyOn(fixture.transactionStore, "close");
    const sessionClose = vi.spyOn(fixture.sessionStore, "close");
    const lockClose = vi.spyOn(fixture.refreshLock, "close");

    await fixture.client.close();
    await fixture.client.close();
    expect(transactionClose).not.toHaveBeenCalled();
    expect(sessionClose).not.toHaveBeenCalled();
    expect(lockClose).not.toHaveBeenCalled();
    expect(fixture.protocolAdapter.close).not.toHaveBeenCalled();
    await expect(fixture.client.beginLogin()).rejects.toMatchObject({ code: "CLIENT_CLOSED" });
  });

  it("shares one deferred close result across concurrent callers", async () => {
    let rejectClose!: (error: Error) => void;
    const closeGate = new Promise<void>((_resolve, reject) => {
      rejectClose = reject;
    });
    const fixture = createFixture({ ownsProtocolAdapterForTesting: true });
    fixture.protocolAdapter.close.mockImplementation(() => closeGate);

    const first = fixture.client.close();
    const second = fixture.client.close();
    const observed = Promise.allSettled([first, second]);

    expect(first).toBe(second);
    await Promise.resolve();
    expect(fixture.protocolAdapter.close).toHaveBeenCalledOnce();
    rejectClose(new Error("close secret must not leak"));
    const results = await observed;
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "STORAGE_FAILED" });
        expect(String(result.reason)).not.toContain("close secret must not leak");
      }
    }
    await expect(fixture.client.beginLogin()).rejects.toMatchObject({ code: "CLIENT_CLOSED" });
  });

  it("does not pass testing protocol or random hooks through the production factory", async () => {
    const fixture = createFixture();
    const unsafeOptions: TestingNodeOidcClientOptions = {
      connection,
      credential,
      transactionStore: fixture.transactionStore,
      sessionStore: fixture.sessionStore,
      refreshLock: fixture.refreshLock,
      protocolAdapter: fixture.protocolAdapter,
      ownsProtocolAdapterForTesting: true,
      randomOpaqueValue: () => "predictable-value".padEnd(43, "x"),
      clock: () => NOW,
    };

    const productionClient = createNodeOidcClient(unsafeOptions);
    await productionClient.close();

    expect(fixture.protocolAdapter.close).not.toHaveBeenCalled();
  });

  it("rejects mismatched credentials and fixed-query redirect configuration", () => {
    const fixture = createFixture();
    expect(() =>
      createNodeOidcClientForTesting({
        connection,
        credential: {
          schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
          applicationId: connection.applicationId,
          oidcClientId: connection.oidcClientId,
          issuer: connection.issuer,
          clientId: connection.clientId,
          kind: "none",
        },
        transactionStore: fixture.transactionStore,
        sessionStore: fixture.sessionStore,
        refreshLock: fixture.refreshLock,
        protocolAdapter: fixture.protocolAdapter,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
    expect(() =>
      createNodeOidcClientForTesting({
        connection: {
          ...connection,
          redirectUris: ["https://app.example.com/callback?tenant=one"],
        },
        credential,
        transactionStore: fixture.transactionStore,
        sessionStore: fixture.sessionStore,
        refreshLock: fixture.refreshLock,
        protocolAdapter: fixture.protocolAdapter,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
    expect(() =>
      createNodeOidcClientForTesting({
        connection,
        credential: { ...credential, issuer: "https://other.example.com" },
        transactionStore: fixture.transactionStore,
        sessionStore: fixture.sessionStore,
        refreshLock: fixture.refreshLock,
        protocolAdapter: fixture.protocolAdapter,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });
});

describe("NodeOidcError", () => {
  it("recognizes a symbol-branded error across duplicated package instances", () => {
    const crossPackageError = {
      [NODE_OIDC_ERROR_BRAND]: true,
      code: "INVALID_CALLBACK",
      message: "登录回调无效或已过期",
      status: 400,
      expose: true,
      retryable: false,
    };
    expect(isNodeOidcError(crossPackageError)).toBe(true);
    expect(isNodeOidcError({ ...crossPackageError, code: "MADE_UP" })).toBe(false);
    expect(isNodeOidcError({ ...crossPackageError, message: "token=must-never-leak" })).toBe(false);
    expect(
      isNodeOidcError({ ...crossPackageError, cause: new Error("token=must-never-leak") }),
    ).toBe(false);
  });
});
