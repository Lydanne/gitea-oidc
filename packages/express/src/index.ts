import {
  connectorError,
  createWebConnectorCore,
  mapConnectorError,
  OIDC_CALLBACK_PATH,
  OIDC_LOGIN_PATH,
  OIDC_LOGOUT_PATH,
  type WebConnectorCoreOptions,
} from "@x-oidc/connector-core";
import type { AuthSessionView } from "@x-oidc/node";
import {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from "express";

declare global {
  namespace Express {
    interface Request {
      /** 仅由 optionalAuth/requireAuth 写入，不包含 Session ID 或任何 Token。 */
      readonly auth?: AuthSessionView | null;
    }
  }
}

export type ExpressOidcOptions = WebConnectorCoreOptions;

export interface ExpressOidc {
  readonly router: Router;
  readonly optionalAuth: RequestHandler;
  readonly requireAuth: RequestHandler;
  getAuth(request: Request): AuthSessionView;
  close(): Promise<void>;
}

const ACTIVE_REQUEST_AUTH = new WeakMap<Request, AuthSessionView | null>();
const AUTH_GETTER_INSTALLED = new WeakSet<Request>();

const exposeRequestAuth = (request: Request, auth: AuthSessionView | null): void => {
  if (!AUTH_GETTER_INSTALLED.has(request)) {
    if (Object.hasOwn(request, "auth")) {
      throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
    }
    Object.defineProperty(request, "auth", {
      configurable: false,
      enumerable: true,
      get: () => ACTIVE_REQUEST_AUTH.get(request) ?? null,
    });
    AUTH_GETTER_INSTALLED.add(request);
  }
  ACTIVE_REQUEST_AUTH.set(request, auth);
};

const setNoStoreHeaders = (response: Response): void => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
};

const appendCookie = (response: Response, cookie: string): void => {
  response.append("Set-Cookie", cookie);
};

const sendKnownError = (error: unknown, response: Response): boolean => {
  const mapped = mapConnectorError(error);
  if (!mapped || response.headersSent) {
    return false;
  }
  setNoStoreHeaders(response);
  response.status(mapped.status).json(mapped.body);
  return true;
};

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<void>;

/** Express 4 不会自动转发 rejected Promise，因此所有异步入口都显式 catch(next)。 */
const wrapAsync =
  (handler: AsyncHandler): RequestHandler =>
  (request, response, next) => {
    handler(request, response, next).catch((error: unknown) => {
      if (!sendKnownError(error, response)) {
        next(error);
      }
    });
  };

const enforceMethod =
  (method: "GET" | "POST"): RequestHandler =>
  (request, response, next) => {
    if (request.method === method) {
      next();
      return;
    }
    response.setHeader("Allow", method);
    sendKnownError(connectorError("METHOD_NOT_ALLOWED"), response);
  };

export function createExpressOidc(options: ExpressOidcOptions): ExpressOidc {
  const core = createWebConnectorCore(options);
  const router = Router({ caseSensitive: true, strict: true });
  const authResolved = Symbol("@x-oidc/express/auth-resolved");
  const authSession = Symbol("@x-oidc/express/auth-session");
  type AuthenticatedRequestState = Request & Record<PropertyKey, unknown>;

  router.all(OIDC_LOGIN_PATH, enforceMethod("GET"));
  router.get(
    OIDC_LOGIN_PATH,
    wrapAsync(async (request, response) => {
      setNoStoreHeaders(response);
      const result = await core.beginLogin(request.originalUrl);
      appendCookie(response, result.transactionCookie);
      response.redirect(303, result.redirectUrl);
    }),
  );

  router.all(OIDC_CALLBACK_PATH, enforceMethod("GET"));
  router.get(
    OIDC_CALLBACK_PATH,
    wrapAsync(async (request, response) => {
      setNoStoreHeaders(response);
      appendCookie(response, core.clearTransactionCookie());
      const result = await core.completeCallback(request.originalUrl, request.headers.cookie);
      appendCookie(response, result.sessionCookie);
      response.redirect(303, result.redirectTo);
    }),
  );

  router.all(OIDC_LOGOUT_PATH, enforceMethod("POST"));
  router.post(
    OIDC_LOGOUT_PATH,
    wrapAsync(async (request, response) => {
      setNoStoreHeaders(response);
      core.validateLogoutOrigin(request.headers.origin);
      appendCookie(response, core.clearSessionCookie());
      const result = await core.logout(request.headers.cookie, request.headers.origin);
      if (result.redirectUrl) {
        response.redirect(303, result.redirectUrl);
        return;
      }
      response.status(204).end();
    }),
  );

  const resolveRequestAuth = async (
    request: Request,
    response: Response,
  ): Promise<AuthSessionView | null> => {
    const state = request as AuthenticatedRequestState;
    if (state[authResolved] === true) {
      return (state[authSession] as AuthSessionView | null | undefined) ?? null;
    }
    const result = await core.resolveSession(request.headers.cookie);
    if (result.clearSessionCookie) {
      appendCookie(response, result.clearSessionCookie);
    }
    Object.defineProperty(state, authSession, {
      configurable: false,
      enumerable: false,
      value: result.session,
      writable: false,
    });
    exposeRequestAuth(request, result.session);
    Object.defineProperty(state, authResolved, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
    return result.session;
  };

  const optionalAuth = wrapAsync(async (request, response, next) => {
    await resolveRequestAuth(request, response);
    next();
  });

  const requireAuth = wrapAsync(async (request, response, next) => {
    const auth = await resolveRequestAuth(request, response);
    if (!auth) {
      throw connectorError("AUTH_REQUIRED");
    }
    next();
  });

  const getAuth = (request: Request): AuthSessionView => {
    const state = request as AuthenticatedRequestState;
    const auth = state[authSession] as AuthSessionView | null | undefined;
    if (state[authResolved] !== true || !auth) {
      throw connectorError("AUTH_REQUIRED");
    }
    return auth;
  };

  return Object.freeze({
    router,
    optionalAuth,
    requireAuth,
    getAuth,
    close: () => core.close(),
  });
}

export type { WebConnectorCoreOptions } from "@x-oidc/connector-core";
export type { AuthSessionView } from "@x-oidc/node";
