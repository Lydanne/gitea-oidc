import { connectorError, mapConnectorError } from "@gitea-oidc/connector-core";
import type { AuthSessionView } from "@gitea-oidc/node";
import { HttpException } from "@nestjs/common";

type OidcRequestState = Record<PropertyKey, unknown>;

const ACTIVE_AUTH_RESOLVED = new WeakSet<object>();
const ACTIVE_REQUEST_AUTH = new WeakMap<object, AuthSessionView | null>();

const asRequestState = (request: unknown): OidcRequestState => {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw connectorError("INVALID_REQUEST");
  }
  return request as OidcRequestState;
};

interface ResolvedNestOidcAuth {
  readonly resolved: boolean;
  readonly session: AuthSessionView | null;
}

export interface NestOidcRequestAuthContext {
  read(request: unknown): ResolvedNestOidcAuth;
  store(request: unknown, session: AuthSessionView | null): void;
  get(request: unknown): AuthSessionView;
  getOptional(request: unknown): AuthSessionView | null;
}

const authRequiredException = (): HttpException => {
  const mapped = mapConnectorError(connectorError("AUTH_REQUIRED"));
  if (!mapped) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }
  return new HttpException(mapped.body, mapped.status);
};

/** 必须先运行 optional/required guard，避免装饰器静默绕过认证解析。 */
export const getOptionalNestOidcAuth = (request: unknown): AuthSessionView | null => {
  const state = asRequestState(request);
  if (!ACTIVE_AUTH_RESOLVED.has(state)) {
    throw authRequiredException();
  }
  return ACTIVE_REQUEST_AUTH.get(state) ?? null;
};

export const getNestOidcAuth = (request: unknown): AuthSessionView => {
  const auth = getOptionalNestOidcAuth(request);
  if (!auth) {
    throw authRequiredException();
  }
  return auth;
};

/** 每个 NestOidcService 都必须持有独立 context，禁止跨模块复用认证缓存。 */
export const createNestOidcRequestAuthContext = (): NestOidcRequestAuthContext => {
  const authResolved = Symbol("@gitea-oidc/nestjs/auth-resolved");
  const authSession = Symbol("@gitea-oidc/nestjs/auth-session");

  const read = (request: unknown): ResolvedNestOidcAuth => {
    const state = asRequestState(request);
    if (state[authResolved] !== true) {
      return Object.freeze({ resolved: false, session: null });
    }
    return Object.freeze({
      resolved: true,
      session: (state[authSession] as AuthSessionView | null | undefined) ?? null,
    });
  };

  const store = (request: unknown, session: AuthSessionView | null): void => {
    const state = asRequestState(request);
    if (state[authResolved] === true) {
      throw connectorError("INVALID_REQUEST");
    }
    try {
      Object.defineProperties(state, {
        [authResolved]: {
          configurable: false,
          enumerable: false,
          value: true,
          writable: false,
        },
        [authSession]: {
          configurable: false,
          enumerable: false,
          value: session,
          writable: false,
        },
      });
    } catch {
      throw connectorError("INVALID_REQUEST");
    }
    ACTIVE_AUTH_RESOLVED.add(state);
    ACTIVE_REQUEST_AUTH.set(state, session);
  };

  const getOptional = (request: unknown): AuthSessionView | null => {
    const auth = read(request);
    if (!auth.resolved) {
      throw authRequiredException();
    }
    return auth.session;
  };

  const get = (request: unknown): AuthSessionView => {
    const auth = getOptional(request);
    if (!auth) {
      throw authRequiredException();
    }
    return auth;
  };

  return Object.freeze({ read, store, get, getOptional });
};
