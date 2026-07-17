import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import {
  type ApplicationConnectionV1,
  type ApplicationCredentialV1,
  parseApplicationConnectionV1,
  parseApplicationCredentialV1,
} from "@x-oidc/contracts";
import {
  MemoryAuthSessionStore,
  MemoryLoginTransactionStore,
  MemoryRefreshLock,
} from "../adapters/memoryStores.js";
import { OpenIdClientProtocolAdapter } from "../adapters/openidClientProtocol.js";
import { canonicalizeNodeOidcError, oidcError } from "../domain/errors.js";
import type {
  AuthSessionView,
  BeginLoginInput,
  BeginLoginResult,
  CompleteCallbackInput,
  CompleteCallbackResult,
  InMemoryNodeOidcClientOptions,
  LoginTransaction,
  LogoutInput,
  LogoutResult,
  LogoutWarning,
  NodeOidcClient,
  NodeOidcClientOptions,
  OidcProtocolTokenSet,
  SensitiveAuthSessionRecord,
  TestingNodeOidcClientOptions,
} from "../domain/types.js";
import {
  buildAndValidateCallbackUrl,
  isValidOpaqueValue,
  type NormalizedProtocolTokens,
  normalizeProtocolTokens,
  parseStoredAuthSession,
  parseStoredLoginTransaction,
  selectRedirectUri,
  selectResources,
  selectScopes,
  toAuthUserProfile,
  validateAuthorizationUrl,
  validatePostLogoutRedirectUri,
  validateReturnTo,
} from "../domain/validation.js";
import { isOidcProtocolError, type OidcProtocolAdapter } from "../ports/oidcProtocol.js";
import type { RefreshLock } from "../ports/refreshLock.js";
import type { AuthSessionStore } from "../ports/sessionStore.js";
import type { LoginTransactionStore } from "../ports/transactionStore.js";

const DEFAULT_TRANSACTION_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const MAX_GENERATION_ATTEMPTS = 4;

interface OwnedResources {
  transactionStore: boolean;
  sessionStore: boolean;
  refreshLock: boolean;
  protocolAdapter: boolean;
}

interface ValidatedOptions {
  ownerNamespace: string;
  connection: ApplicationConnectionV1;
  credential: ApplicationCredentialV1;
  transactionStore: LoginTransactionStore;
  sessionStore: AuthSessionStore;
  refreshLock: RefreshLock;
  protocolAdapter: OidcProtocolAdapter;
  transactionTtlMs: number;
  sessionTtlMs: number;
  clock: () => number;
  randomOpaqueValue: () => string;
}

const validateDuration = (value: number, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw oidcError("INVALID_CONFIGURATION");
  }
  return value;
};

const createOwnerNamespace = (connection: ApplicationConnectionV1): string =>
  `owner-v1:${createHash("sha256")
    .update(
      JSON.stringify([
        "connection-policy-v2",
        connection.issuer,
        connection.applicationId,
        connection.oidcClientId,
        connection.clientId,
        connection.clientType,
        connection.clientAuthMethod,
        [...connection.redirectUris].sort(),
        [...connection.postLogoutRedirectUris].sort(),
        [...connection.scopes].sort(),
        [...connection.resources].sort(),
        connection.flow,
        connection.pkce.policy,
        [...connection.pkce.methods].sort(),
        connection.capabilities.refreshToken,
        connection.capabilities.providerApi,
        connection.capabilities.resourceServer,
      ]),
    )
    .digest("base64url")}`;

const throwStorageBoundaryError = (error: unknown): never => {
  const canonicalError = canonicalizeNodeOidcError(error);
  throw canonicalError ?? oidcError("STORAGE_FAILED");
};

const parseConfiguration = (
  options: TestingNodeOidcClientOptions,
): Omit<ValidatedOptions, "protocolAdapter"> => {
  try {
    const connection = parseApplicationConnectionV1(options.connection);
    const credential = parseApplicationCredentialV1(options.credential);
    if (
      (connection.clientType === "confidential" && credential.kind !== "client_secret") ||
      (connection.clientType === "public" && credential.kind !== "none") ||
      credential.applicationId !== connection.applicationId ||
      credential.oidcClientId !== connection.oidcClientId ||
      credential.issuer !== connection.issuer ||
      credential.clientId !== connection.clientId ||
      typeof options.transactionStore?.create !== "function" ||
      typeof options.transactionStore?.consume !== "function" ||
      typeof options.sessionStore?.create !== "function" ||
      typeof options.sessionStore?.get !== "function" ||
      typeof options.sessionStore?.compareAndSwap !== "function" ||
      typeof options.sessionStore?.deleteIfVersion !== "function" ||
      typeof options.sessionStore?.delete !== "function" ||
      typeof options.refreshLock?.runExclusive !== "function" ||
      (options.protocolAdapter !== undefined &&
        (typeof options.protocolAdapter.buildAuthorizationUrl !== "function" ||
          typeof options.protocolAdapter.exchangeAuthorizationCode !== "function" ||
          typeof options.protocolAdapter.refreshTokens !== "function" ||
          typeof options.protocolAdapter.revokeToken !== "function" ||
          typeof options.protocolAdapter.buildLogoutUrl !== "function")) ||
      (options.clock !== undefined && typeof options.clock !== "function") ||
      (options.randomOpaqueValue !== undefined && typeof options.randomOpaqueValue !== "function")
    ) {
      throw oidcError("INVALID_CONFIGURATION");
    }

    const requestTimeoutSeconds = options.requestTimeoutSeconds ?? 10;
    validateDuration(requestTimeoutSeconds, 1, 120);
    return {
      ownerNamespace: createOwnerNamespace(connection),
      connection,
      credential,
      transactionStore: options.transactionStore,
      sessionStore: options.sessionStore,
      refreshLock: options.refreshLock,
      transactionTtlMs: validateDuration(
        options.transactionTtlMs ?? DEFAULT_TRANSACTION_TTL_MS,
        60_000,
        15 * 60_000,
      ),
      sessionTtlMs: validateDuration(
        options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
        60_000,
        30 * 24 * 60 * 60_000,
      ),
      clock: options.clock ?? Date.now,
      randomOpaqueValue: options.randomOpaqueValue ?? (() => randomBytes(32).toString("base64url")),
    };
  } catch (error) {
    const canonicalError = canonicalizeNodeOidcError(error);
    if (canonicalError) {
      throw canonicalError;
    }
    throw oidcError("INVALID_CONFIGURATION");
  }
};

const createValidatedOptions = (options: TestingNodeOidcClientOptions): ValidatedOptions => {
  const validated = parseConfiguration(options);
  return {
    ...validated,
    protocolAdapter:
      options.protocolAdapter ??
      new OpenIdClientProtocolAdapter(validated.connection, validated.credential, {
        requestTimeoutSeconds: options.requestTimeoutSeconds,
      }),
  };
};

class NodeOidcClientImpl implements NodeOidcClient {
  readonly #ownerNamespace: string;
  readonly #connection: ApplicationConnectionV1;
  readonly #credential: ApplicationCredentialV1;
  readonly #transactionStore: LoginTransactionStore;
  readonly #sessionStore: AuthSessionStore;
  readonly #refreshLock: RefreshLock;
  readonly #protocol: OidcProtocolAdapter;
  readonly #transactionTtlMs: number;
  readonly #sessionTtlMs: number;
  readonly #clock: () => number;
  readonly #randomOpaqueValue: () => string;
  readonly #ownedResources: OwnedResources;
  readonly #operationContext = new AsyncLocalStorage<symbol>();
  readonly #activeOperationTokens = new Set<symbol>();
  readonly #inFlightOperations = new Set<Promise<unknown>>();
  #closing = false;
  #closePromise: Promise<void> | undefined;

  constructor(options: TestingNodeOidcClientOptions, ownedResources: OwnedResources) {
    const validated = createValidatedOptions(options);
    this.#ownerNamespace = validated.ownerNamespace;
    this.#connection = validated.connection;
    this.#credential = validated.credential;
    this.#transactionStore = validated.transactionStore;
    this.#sessionStore = validated.sessionStore;
    this.#refreshLock = validated.refreshLock;
    this.#protocol = validated.protocolAdapter;
    this.#transactionTtlMs = validated.transactionTtlMs;
    this.#sessionTtlMs = validated.sessionTtlMs;
    this.#clock = validated.clock;
    this.#randomOpaqueValue = validated.randomOpaqueValue;
    this.#ownedResources = ownedResources;
  }

  beginLogin(input: BeginLoginInput = {}): Promise<BeginLoginResult> {
    return this.#runOperation(() => this.#beginLogin(input));
  }

  async #beginLogin(input: BeginLoginInput): Promise<BeginLoginResult> {
    this.#assertOpen();
    this.#assertCredentialActive();
    const redirectUri = selectRedirectUri(this.#connection, input.redirectUri);
    const returnTo = validateReturnTo(input.returnTo ?? "/");
    const scopes = selectScopes(input.scopes, this.#connection.scopes);
    const resources = selectResources(input.resources, this.#connection.resources);
    const now = this.#now();

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const [transactionId, state, nonce, codeVerifier] = [
        this.#newOpaqueValue(),
        this.#newOpaqueValue(),
        this.#newOpaqueValue(),
        this.#newOpaqueValue(),
      ];
      if (new Set([transactionId, state, nonce, codeVerifier]).size !== 4) {
        continue;
      }
      const transaction: LoginTransaction = {
        ownerNamespace: this.#ownerNamespace,
        transactionId,
        state,
        nonce,
        codeVerifier,
        redirectUri,
        returnTo,
        scopes,
        resources,
        createdAt: now,
        expiresAt: now + this.#transactionTtlMs,
      };

      if (!(await this.#createTransaction(transaction))) {
        continue;
      }

      try {
        const authorizationUrl = validateAuthorizationUrl(
          await this.#protocol.buildAuthorizationUrl({
            redirectUri,
            scopes,
            resources,
            state,
            nonce,
            codeVerifier,
          }),
          {
            clientId: this.#connection.clientId,
            redirectUri,
            scopes,
            resources,
            state,
            nonce,
          },
        );
        return {
          authorizationUrl,
          transactionId,
          expiresAt: new Date(transaction.expiresAt).toISOString(),
        };
      } catch {
        await this.#discardTransaction(transactionId);
        throw oidcError("LOGIN_FAILED");
      }
    }
    throw oidcError("STORAGE_FAILED");
  }

  completeCallback(input: CompleteCallbackInput): Promise<CompleteCallbackResult> {
    return this.#runOperation(() => this.#completeCallback(input));
  }

  async #completeCallback(input: CompleteCallbackInput): Promise<CompleteCallbackResult> {
    this.#assertOpen();
    if (!isValidOpaqueValue(input.transactionId)) {
      throw oidcError("INVALID_CALLBACK");
    }
    const transaction = await this.#consumeTransaction(input.transactionId);
    if (!transaction || transaction.expiresAt <= this.#now()) {
      throw oidcError("INVALID_CALLBACK");
    }
    this.#assertCredentialActive();
    selectRedirectUri(this.#connection, transaction.redirectUri);
    const callbackUrl = buildAndValidateCallbackUrl(
      input.callbackParameters,
      transaction.redirectUri,
      transaction.state,
    );

    let rawTokens: OidcProtocolTokenSet;
    try {
      rawTokens = await this.#protocol.exchangeAuthorizationCode({
        callbackUrl,
        redirectUri: transaction.redirectUri,
        resources: transaction.resources,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier,
      });
    } catch {
      throw oidcError("CALLBACK_FAILED");
    }

    const now = this.#now();
    let normalized: NormalizedProtocolTokens;
    try {
      normalized = normalizeProtocolTokens(rawTokens, {
        now,
        requestedScopes: transaction.scopes,
        claimsRequired: true,
      });
    } catch {
      throw oidcError("CALLBACK_FAILED");
    }
    if (!normalized.subject || !normalized.user) {
      throw oidcError("CALLBACK_FAILED");
    }

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const sessionId = this.#newOpaqueValue();
      const session: SensitiveAuthSessionRecord = {
        ownerNamespace: this.#ownerNamespace,
        sessionId,
        subject: normalized.subject,
        user: normalized.user,
        scopes: normalized.scopes,
        resources: transaction.resources,
        tokens: normalized.tokens,
        refreshVersion: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + this.#sessionTtlMs,
      };
      if (await this.#createSession(session)) {
        return {
          sessionId,
          session: this.#toSessionView(session),
          returnTo: transaction.returnTo,
        };
      }
    }
    throw oidcError("STORAGE_FAILED");
  }

  getSession(sessionId: string): Promise<AuthSessionView | null> {
    return this.#runOperation(() => this.#getSessionView(sessionId));
  }

  async #getSessionView(sessionId: string): Promise<AuthSessionView | null> {
    this.#assertOpen();
    if (!isValidOpaqueValue(sessionId)) {
      return null;
    }
    const session = await this.#getSession(sessionId);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= this.#now()) {
      await this.#deleteSession(sessionId);
      return null;
    }
    return this.#toSessionView(session);
  }

  refreshSession(sessionId: string): Promise<AuthSessionView> {
    return this.#runOperation(() => this.#refreshSession(sessionId));
  }

  async #refreshSession(sessionId: string): Promise<AuthSessionView> {
    this.#assertOpen();
    if (!isValidOpaqueValue(sessionId)) {
      throw oidcError("SESSION_NOT_FOUND");
    }
    const observed = await this.#getSession(sessionId);
    if (!observed) {
      throw oidcError("SESSION_NOT_FOUND");
    }

    return this.#withRefreshLock(sessionId, async () => {
      const current = await this.#getSession(sessionId);
      if (!current) {
        throw oidcError("SESSION_NOT_FOUND");
      }
      if (current.expiresAt <= this.#now()) {
        await this.#deleteSession(sessionId);
        throw oidcError("SESSION_EXPIRED");
      }
      if (current.refreshVersion !== observed.refreshVersion) {
        return this.#toSessionView(current);
      }
      if (!current.tokens.refreshToken || !this.#connection.capabilities.refreshToken) {
        throw oidcError("REFRESH_NOT_AVAILABLE");
      }
      this.#assertCredentialActive();

      let rawTokens: OidcProtocolTokenSet;
      try {
        rawTokens = await this.#protocol.refreshTokens({
          refreshToken: current.tokens.refreshToken,
          scopes: current.scopes,
          resources: current.resources,
        });
      } catch (error) {
        if (isOidcProtocolError(error) && error.kind === "INVALID_GRANT") {
          return this.#handleInvalidGrant(sessionId, current);
        }
        throw oidcError("REFRESH_FAILED");
      }

      const now = this.#now();
      let normalized: NormalizedProtocolTokens;
      try {
        normalized = normalizeProtocolTokens(rawTokens, {
          now,
          requestedScopes: current.scopes,
          claimsRequired: false,
          expectedSubject: current.subject,
        });
      } catch {
        throw oidcError("REFRESH_FAILED");
      }
      const next: SensitiveAuthSessionRecord = {
        ...current,
        subject: normalized.subject ?? current.subject,
        user: normalized.user ?? current.user,
        scopes: normalized.scopes,
        tokens: {
          ...normalized.tokens,
          refreshToken: normalized.tokens.refreshToken ?? current.tokens.refreshToken,
          idToken: normalized.tokens.idToken ?? current.tokens.idToken,
        },
        refreshVersion: current.refreshVersion + 1,
        updatedAt: now,
      };
      if (await this.#compareAndSwapSession(sessionId, current.refreshVersion, next)) {
        return this.#toSessionView(next);
      }

      const latest = await this.#getSession(sessionId);
      if (latest && latest.refreshVersion > current.refreshVersion) {
        return this.#toSessionView(latest);
      }
      throw oidcError("SESSION_NOT_FOUND");
    });
  }

  logout(input: LogoutInput): Promise<LogoutResult> {
    return this.#runOperation(() => this.#logout(input));
  }

  async #logout(input: LogoutInput): Promise<LogoutResult> {
    this.#assertOpen();
    const postLogoutRedirectUri = validatePostLogoutRedirectUri(
      this.#connection,
      input.postLogoutRedirectUri,
    );
    if (!isValidOpaqueValue(input.sessionId)) {
      return { warnings: [] };
    }

    const session = await this.#withRefreshLock(input.sessionId, async () => {
      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
        const current = await this.#getSession(input.sessionId);
        if (!current) {
          return null;
        }
        if (await this.#deleteSessionIfVersion(input.sessionId, current.refreshVersion)) {
          return current;
        }
      }
      throw oidcError("STORAGE_FAILED");
    });
    if (!session) {
      return { warnings: [] };
    }

    const warnings: LogoutWarning[] = [];
    if (session.tokens.refreshToken) {
      try {
        await this.#protocol.revokeToken({
          token: session.tokens.refreshToken,
          tokenTypeHint: "refresh_token",
        });
      } catch {
        warnings.push("REFRESH_TOKEN_REVOCATION_FAILED");
      }
    }
    try {
      await this.#protocol.revokeToken({
        token: session.tokens.accessToken,
        tokenTypeHint: "access_token",
      });
    } catch {
      warnings.push("ACCESS_TOKEN_REVOCATION_FAILED");
    }

    try {
      const logoutUrl = await this.#protocol.buildLogoutUrl({
        idTokenHint: session.tokens.idToken,
        postLogoutRedirectUri,
      });
      return Object.freeze({
        ...(logoutUrl ? { logoutUrl: validateAuthorizationUrl(logoutUrl) } : {}),
        warnings: Object.freeze(warnings),
      });
    } catch {
      throw oidcError("LOGOUT_FAILED");
    }
  }

  close(): Promise<void> {
    const activeToken = this.#operationContext.getStore();
    if (activeToken !== undefined && this.#activeOperationTokens.has(activeToken)) {
      return Promise.reject(oidcError("CLIENT_CLOSED"));
    }
    if (!this.#closePromise) {
      this.#closing = true;
      this.#closePromise = this.#closeOwnedResources();
    }
    return this.#closePromise;
  }

  async #closeOwnedResources(): Promise<void> {
    await Promise.allSettled([...this.#inFlightOperations]);
    const resources = [
      this.#ownedResources.protocolAdapter ? this.#protocol : undefined,
      this.#ownedResources.transactionStore ? this.#transactionStore : undefined,
      this.#ownedResources.sessionStore ? this.#sessionStore : undefined,
      this.#ownedResources.refreshLock ? this.#refreshLock : undefined,
    ].filter((resource) => resource !== undefined);
    let failed = false;
    for (const resource of new Set(resources)) {
      try {
        await resource.close?.();
      } catch {
        failed = true;
      }
    }
    if (failed) {
      throw oidcError("STORAGE_FAILED");
    }
  }

  #assertOpen(): void {
    if (this.#closing || this.#closePromise) {
      throw oidcError("CLIENT_CLOSED");
    }
  }

  async #runOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    const token = Symbol("node-oidc-client-operation");
    this.#activeOperationTokens.add(token);
    const running = this.#operationContext.run(token, operation);
    this.#inFlightOperations.add(running);
    try {
      return await running;
    } finally {
      this.#activeOperationTokens.delete(token);
      this.#inFlightOperations.delete(running);
    }
  }

  #assertCredentialActive(): void {
    if (
      this.#credential.kind === "client_secret" &&
      this.#credential.expiresAt !== undefined &&
      Date.parse(this.#credential.expiresAt) <= this.#now()
    ) {
      throw oidcError("INVALID_CONFIGURATION");
    }
  }

  #now(): number {
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw oidcError("INVALID_CONFIGURATION");
    }
    return now;
  }

  #newOpaqueValue(): string {
    let value: string;
    try {
      value = this.#randomOpaqueValue();
    } catch {
      throw oidcError("INVALID_CONFIGURATION");
    }
    if (!isValidOpaqueValue(value)) {
      throw oidcError("INVALID_CONFIGURATION");
    }
    return value;
  }

  #toSessionView(session: SensitiveAuthSessionRecord): AuthSessionView {
    if (session.user.subject !== session.subject) {
      throw oidcError("STORAGE_FAILED");
    }
    let projectedUser: ReturnType<typeof toAuthUserProfile>;
    try {
      projectedUser = toAuthUserProfile({
        sub: session.user.subject,
        name: session.user.name,
        preferred_username: session.user.preferredUsername,
        email: session.user.email,
        email_verified: session.user.emailVerified,
        picture: session.user.picture,
        groups: session.user.groups,
      });
    } catch {
      throw oidcError("STORAGE_FAILED");
    }
    const user = Object.freeze({
      subject: projectedUser.subject,
      name: projectedUser.name,
      preferredUsername: projectedUser.preferredUsername,
      email: projectedUser.email,
      emailVerified: projectedUser.emailVerified,
      picture: projectedUser.picture,
      groups: projectedUser.groups ? Object.freeze([...projectedUser.groups]) : undefined,
    });
    return Object.freeze({
      authenticated: true as const,
      user,
      scopes: Object.freeze([...session.scopes]),
      canRefresh:
        this.#connection.capabilities.refreshToken && Boolean(session.tokens.refreshToken),
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  }

  async #handleInvalidGrant(
    sessionId: string,
    failedSession: SensitiveAuthSessionRecord,
  ): Promise<AuthSessionView> {
    const latest = await this.#getSession(sessionId);
    if (!latest) {
      throw oidcError("SESSION_NOT_FOUND");
    }
    if (
      latest.refreshVersion !== failedSession.refreshVersion ||
      latest.tokens.refreshToken !== failedSession.tokens.refreshToken
    ) {
      return this.#toSessionView(latest);
    }
    if (await this.#deleteSessionIfVersion(sessionId, failedSession.refreshVersion)) {
      throw oidcError("SESSION_EXPIRED");
    }

    const afterDeleteRace = await this.#getSession(sessionId);
    if (!afterDeleteRace) {
      throw oidcError("SESSION_EXPIRED");
    }
    if (
      afterDeleteRace.refreshVersion !== failedSession.refreshVersion ||
      afterDeleteRace.tokens.refreshToken !== failedSession.tokens.refreshToken
    ) {
      return this.#toSessionView(afterDeleteRace);
    }
    throw oidcError("STORAGE_FAILED");
  }

  async #createTransaction(transaction: LoginTransaction): Promise<boolean> {
    try {
      return await this.#transactionStore.create(
        parseStoredLoginTransaction(
          transaction,
          this.#connection,
          this.#ownerNamespace,
          transaction.transactionId,
          this.#now(),
        ),
      );
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }

  async #consumeTransaction(transactionId: string): Promise<LoginTransaction | null> {
    try {
      const transaction = await this.#transactionStore.consume(this.#ownerNamespace, transactionId);
      if (!transaction) {
        return null;
      }
      const parsed = parseStoredLoginTransaction(
        transaction,
        this.#connection,
        this.#ownerNamespace,
        transactionId,
        this.#now(),
      );
      return parsed.expiresAt <= this.#now() ? null : parsed;
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }

  async #discardTransaction(transactionId: string): Promise<void> {
    try {
      await this.#transactionStore.consume(this.#ownerNamespace, transactionId);
    } catch {
      // URL 未返回给调用方时事务只会等待 TTL 清理，不能让清理错误覆盖脱敏的协议错误。
    }
  }

  async #createSession(session: SensitiveAuthSessionRecord): Promise<boolean> {
    try {
      return await this.#sessionStore.create(
        parseStoredAuthSession(
          session,
          this.#connection,
          this.#ownerNamespace,
          session.sessionId,
          this.#now(),
        ),
      );
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }

  async #getSession(sessionId: string): Promise<SensitiveAuthSessionRecord | null> {
    try {
      const session = await this.#sessionStore.get(this.#ownerNamespace, sessionId);
      if (!session) {
        return null;
      }
      const parsed = parseStoredAuthSession(
        session,
        this.#connection,
        this.#ownerNamespace,
        sessionId,
        this.#now(),
      );
      if (parsed.expiresAt <= this.#now()) {
        await this.#sessionStore.delete(this.#ownerNamespace, sessionId);
        return null;
      }
      return parsed;
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }

  async #compareAndSwapSession(
    sessionId: string,
    expectedRefreshVersion: number,
    next: SensitiveAuthSessionRecord,
  ): Promise<boolean> {
    try {
      if (next.refreshVersion !== expectedRefreshVersion + 1) {
        throw oidcError("STORAGE_FAILED");
      }
      const parsed = parseStoredAuthSession(
        next,
        this.#connection,
        this.#ownerNamespace,
        sessionId,
        this.#now(),
      );
      return await this.#sessionStore.compareAndSwap(
        this.#ownerNamespace,
        sessionId,
        expectedRefreshVersion,
        parsed,
      );
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }

  async #deleteSession(sessionId: string): Promise<void> {
    try {
      await this.#sessionStore.delete(this.#ownerNamespace, sessionId);
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }

  async #deleteSessionIfVersion(
    sessionId: string,
    expectedRefreshVersion: number,
  ): Promise<boolean> {
    try {
      return await this.#sessionStore.deleteIfVersion(
        this.#ownerNamespace,
        sessionId,
        expectedRefreshVersion,
      );
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }

  async #withRefreshLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await this.#refreshLock.runExclusive(this.#ownerNamespace, sessionId, operation);
    } catch (error) {
      return throwStorageBoundaryError(error);
    }
  }
}

/** 生产工厂：持久化与分布式互斥必须由调用方显式提供。注入资源归调用方所有。 */
export const createNodeOidcClient = (options: NodeOidcClientOptions): NodeOidcClient =>
  new NodeOidcClientImpl(
    {
      connection: options.connection,
      credential: options.credential,
      transactionStore: options.transactionStore,
      sessionStore: options.sessionStore,
      refreshLock: options.refreshLock,
      transactionTtlMs: options.transactionTtlMs,
      sessionTtlMs: options.sessionTtlMs,
      requestTimeoutSeconds: options.requestTimeoutSeconds,
    },
    {
      transactionStore: false,
      sessionStore: false,
      refreshLock: false,
      protocolAdapter: true,
    },
  );

/** 仅适合单进程开发、测试和短生命周期工具；关闭客户端时会清理其内存状态。 */
export const createInMemoryNodeOidcClient = (
  options: InMemoryNodeOidcClientOptions,
): NodeOidcClient => {
  const transactionStore = new MemoryLoginTransactionStore();
  const sessionStore = new MemoryAuthSessionStore();
  const refreshLock = new MemoryRefreshLock();
  return new NodeOidcClientImpl(
    {
      connection: options.connection,
      credential: options.credential,
      transactionStore,
      sessionStore,
      refreshLock,
      transactionTtlMs: options.transactionTtlMs,
      sessionTtlMs: options.sessionTtlMs,
      requestTimeoutSeconds: options.requestTimeoutSeconds,
    },
    {
      transactionStore: true,
      sessionStore: true,
      refreshLock: true,
      protocolAdapter: true,
    },
  );
};

/** 仅由 `@x-oidc/node/internal/testing` 导出，生产代码不得使用。 */
export const createNodeOidcClientForTesting = (
  options: TestingNodeOidcClientOptions,
): NodeOidcClient =>
  new NodeOidcClientImpl(options, {
    transactionStore: false,
    sessionStore: false,
    refreshLock: false,
    protocolAdapter: options.ownsProtocolAdapterForTesting ?? options.protocolAdapter === undefined,
  });
