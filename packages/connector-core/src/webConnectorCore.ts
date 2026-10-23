import { createHash } from "node:crypto";
import {
  createNodeOidcClient,
  type LogoutWarning,
  type NodeOidcClient,
  NodeOidcError,
} from "@x-oidc/node";
import {
  createCookieConfiguration,
  readUniqueOpaqueCookie,
  secondsUntil,
  serializeOpaqueCookie,
} from "./cookies.js";
import { connectorError } from "./errors.js";
import {
  extractRequestQuery,
  parseLoginReturnTo,
  validateExternalRedirect,
  validateLocalReturnTo,
  validateRequestOrigin,
} from "./requestValidation.js";
import { projectAuthSessionView } from "./sessionView.js";
import {
  OIDC_CALLBACK_PATH,
  OIDC_LOGIN_PATH,
  type WebConnectorCore,
  type WebConnectorCoreOptions,
} from "./types.js";

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

const parseRedirectUri = (value: string): URL => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8_192 ||
    value.trim() !== value ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    })
  ) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }
  if (
    url.pathname !== OIDC_CALLBACK_PATH ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))
  ) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }
  return url;
};

const readClock = (clock: () => number): number => {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }
  return now;
};

const LOGOUT_WARNING_CODES = new Set<LogoutWarning>([
  "REFRESH_TOKEN_REVOCATION_FAILED",
  "ACCESS_TOKEN_REVOCATION_FAILED",
]);

const projectLogoutWarnings = (value: unknown): readonly LogoutWarning[] => {
  if (
    !Array.isArray(value) ||
    value.length > LOGOUT_WARNING_CODES.size ||
    new Set(value).size !== value.length ||
    !value.every(
      (warning): warning is LogoutWarning =>
        typeof warning === "string" && LOGOUT_WARNING_CODES.has(warning as LogoutWarning),
    )
  ) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  return Object.freeze([...value]);
};

export function createWebConnectorCore(options: WebConnectorCoreOptions): WebConnectorCore {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }
  const redirectUri = parseRedirectUri(options.redirectUri);
  if (
    (options.client === undefined) === (options.clientOptions === undefined) ||
    (options.clock !== undefined && typeof options.clock !== "function") ||
    (options.onLogoutWarning !== undefined && typeof options.onLogoutWarning !== "function") ||
    (options.postLogoutRedirectUri !== undefined &&
      typeof options.postLogoutRedirectUri !== "string")
  ) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }

  const providedClient = options.client;
  if (
    providedClient !== undefined &&
    (!providedClient ||
      typeof providedClient !== "object" ||
      typeof providedClient.beginLogin !== "function" ||
      typeof providedClient.completeCallback !== "function" ||
      typeof providedClient.getSession !== "function" ||
      typeof providedClient.refreshSession !== "function" ||
      typeof providedClient.logout !== "function" ||
      typeof providedClient.close !== "function")
  ) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }

  if (
    options.clientOptions !== undefined &&
    (!options.clientOptions ||
      typeof options.clientOptions !== "object" ||
      Array.isArray(options.clientOptions))
  ) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }

  const client: NodeOidcClient =
    providedClient ??
    createNodeOidcClient(options.clientOptions as NonNullable<typeof options.clientOptions>);
  const ownsClient = providedClient === undefined;
  const clock = options.clock ?? Date.now;
  const postLogoutRedirectUri = options.postLogoutRedirectUri;
  const cookieNamespace = createHash("sha256")
    .update(redirectUri.origin)
    .digest("base64url")
    .slice(0, 16);
  const cookies = createCookieConfiguration(
    redirectUri.protocol === "https:",
    options.cookieNames,
    cookieNamespace,
  );
  let closePromise: Promise<void> | undefined;

  const assertOpen = (): void => {
    if (closePromise) {
      throw new NodeOidcError("CLIENT_CLOSED");
    }
  };

  const clearTransactionCookie = (): string => {
    assertOpen();
    return serializeOpaqueCookie({
      name: cookies.transaction.name,
      value: "",
      path: cookies.transaction.path,
      secure: cookies.secure,
      maxAgeSeconds: 0,
    });
  };

  const clearSessionCookie = (): string => {
    assertOpen();
    return serializeOpaqueCookie({
      name: cookies.session.name,
      value: "",
      path: cookies.session.path,
      secure: cookies.secure,
      maxAgeSeconds: 0,
    });
  };

  const beginLogin = async (requestUrl: string) => {
    assertOpen();
    const returnTo = parseLoginReturnTo(requestUrl, OIDC_LOGIN_PATH);
    const result = await client.beginLogin({
      redirectUri: redirectUri.href,
      returnTo,
    });
    return Object.freeze({
      redirectUrl: validateExternalRedirect(result.authorizationUrl),
      transactionCookie: serializeOpaqueCookie({
        name: cookies.transaction.name,
        value: result.transactionId,
        path: cookies.transaction.path,
        secure: cookies.secure,
        maxAgeSeconds: secondsUntil(result.expiresAt, readClock(clock)),
      }),
    });
  };

  const completeCallback = async (requestUrl: string, cookieHeader: string | undefined) => {
    assertOpen();
    const transaction = readUniqueOpaqueCookie(cookieHeader, cookies.transaction.name);
    if (transaction.kind !== "value") {
      throw connectorError("INVALID_REQUEST");
    }
    const callbackParameters = extractRequestQuery(requestUrl, OIDC_CALLBACK_PATH);
    const result = await client.completeCallback({
      callbackParameters,
      transactionId: transaction.value,
    });
    const session = projectAuthSessionView(result.session);
    return Object.freeze({
      redirectTo: validateLocalReturnTo(result.returnTo),
      session,
      sessionCookie: serializeOpaqueCookie({
        name: cookies.session.name,
        value: result.sessionId,
        path: cookies.session.path,
        secure: cookies.secure,
        maxAgeSeconds: secondsUntil(session.expiresAt, readClock(clock)),
      }),
    });
  };

  const resolveSession = async (cookieHeader: string | undefined) => {
    assertOpen();
    const sessionCookie = readUniqueOpaqueCookie(cookieHeader, cookies.session.name);
    if (sessionCookie.kind === "missing") {
      return Object.freeze({ session: null });
    }
    if (sessionCookie.kind === "invalid") {
      return Object.freeze({ session: null, clearSessionCookie: clearSessionCookie() });
    }
    const session = await client.getSession(sessionCookie.value);
    if (!session) {
      return Object.freeze({ session: null, clearSessionCookie: clearSessionCookie() });
    }
    const projected = projectAuthSessionView(session);
    if (Date.parse(projected.expiresAt) <= readClock(clock)) {
      return Object.freeze({ session: null, clearSessionCookie: clearSessionCookie() });
    }
    return Object.freeze({ session: projected });
  };

  const validateLogoutOrigin = (originHeader: string | readonly string[] | undefined): void => {
    assertOpen();
    validateRequestOrigin(originHeader, redirectUri.origin);
  };

  const logout = async (
    cookieHeader: string | undefined,
    originHeader: string | readonly string[] | undefined,
  ) => {
    validateLogoutOrigin(originHeader);
    const sessionCookie = readUniqueOpaqueCookie(cookieHeader, cookies.session.name);
    if (sessionCookie.kind !== "value") {
      return Object.freeze({ warnings: Object.freeze([]) });
    }
    const result = await client.logout({
      sessionId: sessionCookie.value,
      postLogoutRedirectUri,
    });
    const warnings = projectLogoutWarnings(result.warnings);
    for (const warning of warnings) {
      try {
        options.onLogoutWarning?.(warning);
      } catch {
        // 可观测性 hook 不能阻断已经完成的本地退出和 Cookie 清理。
      }
    }
    return Object.freeze({
      ...(result.logoutUrl ? { redirectUrl: validateExternalRedirect(result.logoutUrl) } : {}),
      warnings,
    });
  };

  const close = (): Promise<void> => {
    if (!closePromise) {
      closePromise = (async () => {
        if (ownsClient) {
          await client.close();
        }
      })();
    }
    return closePromise;
  };

  return Object.freeze({
    expectedOrigin: redirectUri.origin,
    cookies,
    beginLogin,
    completeCallback,
    resolveSession,
    validateLogoutOrigin,
    logout,
    clearTransactionCookie,
    clearSessionCookie,
    close,
  });
}
