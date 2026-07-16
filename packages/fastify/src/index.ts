import {
  connectorError,
  createConnectorRequestDrain,
  createWebConnectorCore,
  mapConnectorError,
  OIDC_CALLBACK_PATH,
  OIDC_LOGIN_PATH,
  OIDC_LOGOUT_PATH,
  type WebConnectorCoreOptions,
} from "@x-oidc/connector-core";
import { type AuthSessionView, NodeOidcError } from "@x-oidc/node";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
  preHandlerAsyncHookHandler,
} from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** 仅由 optionalAuth/requireAuth 解析，不包含 Session ID 或任何 Token。 */
    readonly auth: AuthSessionView | null;
  }
}

export type FastifyOidcOptions = WebConnectorCoreOptions;

export type FastifyOidcPlugin = FastifyPluginAsync & {
  readonly optionalAuth: preHandlerAsyncHookHandler;
  readonly requireAuth: preHandlerAsyncHookHandler;
  getAuth(request: FastifyRequest): AuthSessionView;
  close(): Promise<void>;
};

const ACTIVE_REQUEST_AUTH = new WeakMap<FastifyRequest, AuthSessionView | null>();
const AUTH_GETTER_INSTALLED = new WeakSet<FastifyRequest>();

const exposeRequestAuth = (request: FastifyRequest, auth: AuthSessionView | null): void => {
  if (!AUTH_GETTER_INSTALLED.has(request)) {
    const existing = Object.getOwnPropertyDescriptor(request, "auth");
    if (existing && (existing.configurable !== true || existing.value !== null)) {
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

const NON_GET_METHODS: HTTPMethods[] = [
  "DELETE",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
];

const NON_POST_METHODS: HTTPMethods[] = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "PUT",
  "TRACE",
];

const setNoStoreHeaders = (reply: FastifyReply): void => {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
  reply.header("Referrer-Policy", "no-referrer");
};

const appendCookie = (reply: FastifyReply, cookie: string): void => {
  // Fastify 对 Set-Cookie 执行追加语义；重复传入数组会反而复制已有 Cookie。
  reply.header("Set-Cookie", cookie);
};

const sendKnownError = (error: unknown, reply: FastifyReply): boolean => {
  const mapped = mapConnectorError(error);
  if (!mapped || reply.sent) {
    return false;
  }
  setNoStoreHeaders(reply);
  reply.code(mapped.status).send(mapped.body);
  return true;
};

const rethrowUnknownError = (error: unknown, reply: FastifyReply): void => {
  if (!sendKnownError(error, reply)) {
    throw error;
  }
};

const rejectMethod = (reply: FastifyReply, allowedMethod: "GET" | "POST"): void => {
  reply.header("Allow", allowedMethod);
  sendKnownError(connectorError("METHOD_NOT_ALLOWED"), reply);
};

const markAsPublicFastifyPlugin = (plugin: FastifyPluginAsync): void => {
  // Fastify 公开插件约定使用这些全局 Symbol 关闭 encapsulation 并声明兼容版本。
  Object.defineProperties(plugin, {
    [Symbol.for("skip-override")]: { value: true },
    [Symbol.for("fastify.display-name")]: { value: "@x-oidc/fastify" },
    [Symbol.for("plugin-meta")]: {
      value: { fastify: "5.x", name: "@x-oidc/fastify" },
    },
  });
};

export function createFastifyOidc(options: FastifyOidcOptions): FastifyOidcPlugin {
  const core = createWebConnectorCore(options);
  const requestDrain = createConnectorRequestDrain();
  const releaseListenersInstalled = new WeakSet<FastifyRequest>();
  const authResolved = Symbol("@x-oidc/fastify/auth-resolved");
  const authSession = Symbol("@x-oidc/fastify/auth-session");
  type AuthenticatedRequestState = FastifyRequest & Record<PropertyKey, unknown>;

  const trackRequest = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const accepted = requestDrain.track(request);
    if (!accepted || releaseListenersInstalled.has(request)) {
      return accepted;
    }
    const release = (): void => {
      requestDrain.release(request);
    };
    reply.raw.once("finish", release);
    reply.raw.once("close", release);
    releaseListenersInstalled.add(request);
    return true;
  };

  const assertRequestTracked = (request: FastifyRequest, reply: FastifyReply): void => {
    if (!trackRequest(request, reply)) {
      throw new NodeOidcError("CLIENT_CLOSED");
    }
  };

  const resolveRequestAuth = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthSessionView | null> => {
    const state = request as AuthenticatedRequestState;
    if (state[authResolved] === true) {
      return (state[authSession] as AuthSessionView | null | undefined) ?? null;
    }
    const result = await core.resolveSession(request.headers.cookie);
    if (result.clearSessionCookie) {
      appendCookie(reply, result.clearSessionCookie);
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

  const optionalAuth: preHandlerAsyncHookHandler = async (request, reply) => {
    try {
      assertRequestTracked(request, reply);
      await resolveRequestAuth(request, reply);
    } catch (error) {
      rethrowUnknownError(error, reply);
    }
  };

  const requireAuth: preHandlerAsyncHookHandler = async (request, reply) => {
    try {
      assertRequestTracked(request, reply);
      const auth = await resolveRequestAuth(request, reply);
      if (!auth) {
        throw connectorError("AUTH_REQUIRED");
      }
    } catch (error) {
      rethrowUnknownError(error, reply);
    }
  };

  const getAuth = (request: FastifyRequest): AuthSessionView => {
    const state = request as AuthenticatedRequestState;
    const auth = state[authSession] as AuthSessionView | null | undefined;
    if (state[authResolved] !== true || !auth) {
      throw connectorError("AUTH_REQUIRED");
    }
    return auth;
  };

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      await requestDrain.beginClose();
      await core.close();
    })();
    return closePromise;
  };

  let registered = false;
  const plugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
    if (registered) {
      throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
    }
    registered = true;
    try {
      if (fastify.hasRequestDecorator("auth")) {
        throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
      }
      fastify.decorateRequest("auth", null);
      fastify.addHook("onRequest", async (request, reply) => {
        trackRequest(request, reply);
      });
      fastify.addHook("onResponse", async (request) => {
        requestDrain.release(request);
      });
      fastify.addHook("onRequestAbort", async (request) => {
        requestDrain.release(request);
      });
      fastify.addHook("preClose", async () => {
        await requestDrain.beginClose();
      });
      fastify.addHook("onClose", async () => {
        await close();
      });

      fastify.route({
        method: "GET",
        url: OIDC_LOGIN_PATH,
        exposeHeadRoute: false,
        async handler(request, reply) {
          setNoStoreHeaders(reply);
          try {
            assertRequestTracked(request, reply);
            const result = await core.beginLogin(request.url);
            appendCookie(reply, result.transactionCookie);
            reply.redirect(result.redirectUrl, 303);
          } catch (error) {
            rethrowUnknownError(error, reply);
          }
        },
      });
      fastify.route({
        method: NON_GET_METHODS,
        url: OIDC_LOGIN_PATH,
        handler(_request, reply) {
          rejectMethod(reply, "GET");
        },
      });

      fastify.route({
        method: "GET",
        url: OIDC_CALLBACK_PATH,
        exposeHeadRoute: false,
        async handler(request, reply) {
          setNoStoreHeaders(reply);
          try {
            assertRequestTracked(request, reply);
            appendCookie(reply, core.clearTransactionCookie());
            const result = await core.completeCallback(request.url, request.headers.cookie);
            appendCookie(reply, result.sessionCookie);
            reply.redirect(result.redirectTo, 303);
          } catch (error) {
            rethrowUnknownError(error, reply);
          }
        },
      });
      fastify.route({
        method: NON_GET_METHODS,
        url: OIDC_CALLBACK_PATH,
        handler(_request, reply) {
          rejectMethod(reply, "GET");
        },
      });

      fastify.route({
        method: "POST",
        url: OIDC_LOGOUT_PATH,
        async handler(request, reply) {
          setNoStoreHeaders(reply);
          try {
            assertRequestTracked(request, reply);
            core.validateLogoutOrigin(request.headers.origin);
            appendCookie(reply, core.clearSessionCookie());
            const result = await core.logout(request.headers.cookie, request.headers.origin);
            if (result.redirectUrl) {
              reply.redirect(result.redirectUrl, 303);
              return;
            }
            reply.code(204).send();
          } catch (error) {
            rethrowUnknownError(error, reply);
          }
        },
      });
      fastify.route({
        method: NON_POST_METHODS,
        url: OIDC_LOGOUT_PATH,
        exposeHeadRoute: false,
        handler(_request, reply) {
          rejectMethod(reply, "POST");
        },
      });
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
  };

  markAsPublicFastifyPlugin(plugin);
  return Object.freeze(
    Object.assign(plugin, {
      optionalAuth,
      requireAuth,
      getAuth,
      close,
    }),
  );
}

export type { WebConnectorCoreOptions } from "@x-oidc/connector-core";
export type { AuthSessionView } from "@x-oidc/node";
