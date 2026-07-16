import { HttpException, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import {
  connectorError,
  createConnectorRequestDrain,
  createWebConnectorCore,
  type MappedConnectorError,
  mapConnectorError,
  type WebConnectorCore,
} from "@x-oidc/connector-core";
import { type AuthSessionView, NodeOidcError } from "@x-oidc/node";
import { createNestOidcRequestAuthContext } from "./requestAuth.js";
import type { NestOidcModuleOptions } from "./types.js";

type HttpAdapter = HttpAdapterHost["httpAdapter"];

type AdapterWithOptionalCookieHeaders = HttpAdapter & {
  appendHeader?: (response: unknown, name: string, value: string) => unknown;
  getHeader?: (response: unknown, name: string) => unknown;
};

type AdapterWithFastifyLifecycle = HttpAdapter & {
  getInstance?: () => unknown;
  getType?: () => unknown;
};

interface FastifyLifecycleInstance {
  addHook(
    name: "onRequest" | "onRequestAbort" | "onResponse",
    hook: (request: object, reply: unknown) => Promise<void>,
  ): unknown;
  addHook(name: "preClose", hook: () => Promise<void>): unknown;
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readRequestHeader = (request: unknown, targetName: string): unknown => {
  if (!isRecord(request) || !isRecord(request.headers)) {
    throw connectorError("INVALID_REQUEST");
  }
  const matches = Object.entries(request.headers).filter(
    ([name]) => name.toLowerCase() === targetName,
  );
  if (matches.length > 1) {
    throw connectorError("INVALID_REQUEST");
  }
  return matches[0]?.[1];
};

const readCookieHeader = (request: unknown): string | undefined => {
  const value = readRequestHeader(request, "cookie");
  if (value === undefined || typeof value === "string") {
    return value;
  }
  throw connectorError("INVALID_REQUEST");
};

const readOriginHeader = (request: unknown): string | readonly string[] | undefined => {
  const value = readRequestHeader(request, "origin");
  if (
    value === undefined ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  ) {
    return value as string | readonly string[] | undefined;
  }
  throw connectorError("INVALID_REQUEST");
};

const normalizeSetCookieHeader = (value: unknown): readonly string[] => {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw connectorError("INVALID_CLIENT_RESPONSE");
};

@Injectable()
export class NestOidcService implements OnApplicationShutdown {
  readonly #core: WebConnectorCore;
  readonly #releaseListenersInstalled = new WeakSet<object>();
  readonly #requestDrain = createConnectorRequestDrain();
  readonly #requestAuth = createNestOidcRequestAuthContext();
  #closePromise: Promise<void> | undefined;

  constructor(
    options: NestOidcModuleOptions,
    private readonly adapterHost: HttpAdapterHost,
  ) {
    this.#core = createWebConnectorCore(options);
    this.#installFastifyRequestDrain();
  }

  async handleLogin(request: unknown, response: unknown): Promise<void> {
    await this.#runEndpoint("GET", request, response, async (adapter) => {
      const result = await this.#core.beginLogin(this.#readRequestUrl(adapter, request));
      this.#setCookies(adapter, response, [result.transactionCookie]);
      adapter.redirect(response, 303, result.redirectUrl);
    });
  }

  async handleCallback(request: unknown, response: unknown): Promise<void> {
    await this.#runEndpoint("GET", request, response, async (adapter) => {
      const transactionClear = this.#core.clearTransactionCookie();
      let result: Awaited<ReturnType<WebConnectorCore["completeCallback"]>>;
      try {
        result = await this.#core.completeCallback(
          this.#readRequestUrl(adapter, request),
          readCookieHeader(request),
        );
      } catch (error) {
        this.#setCookies(adapter, response, [transactionClear]);
        throw error;
      }
      this.#setCookies(adapter, response, [transactionClear, result.sessionCookie]);
      adapter.redirect(response, 303, result.redirectTo);
    });
  }

  async handleLogout(request: unknown, response: unknown): Promise<void> {
    await this.#runEndpoint("POST", request, response, async (adapter) => {
      this.#core.validateLogoutOrigin(readOriginHeader(request));
      this.#setCookies(adapter, response, [this.#core.clearSessionCookie()]);
      const result = await this.#core.logout(readCookieHeader(request), readOriginHeader(request));
      if (result.redirectUrl) {
        adapter.redirect(response, 303, result.redirectUrl);
        return;
      }
      adapter.reply(response, undefined, 204);
    });
  }

  async resolveAuth(request: unknown, response: unknown): Promise<AuthSessionView | null> {
    const adapter = this.#getAdapter();
    try {
      this.#assertRequestTracked(request, response);
      const cached = this.#requestAuth.read(request);
      if (cached.resolved) {
        return cached.session;
      }
      const result = await this.#core.resolveSession(readCookieHeader(request));
      if (result.clearSessionCookie) {
        this.#appendCookies(adapter, response, [result.clearSessionCookie]);
      }
      this.#requestAuth.store(request, result.session);
      return result.session;
    } catch (error) {
      const mapped = mapConnectorError(error);
      if (!mapped) {
        throw error;
      }
      this.#setNoStoreHeaders(adapter, response);
      throw new HttpException(mapped.body, mapped.status);
    }
  }

  async requireAuth(request: unknown, response: unknown): Promise<AuthSessionView> {
    const auth = await this.resolveAuth(request, response);
    if (auth) {
      return auth;
    }
    const mapped = mapConnectorError(connectorError("AUTH_REQUIRED"));
    if (!mapped) {
      throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
    }
    this.#setNoStoreHeaders(this.#getAdapter(), response);
    throw new HttpException(mapped.body, mapped.status);
  }

  getAuth(request: unknown): AuthSessionView {
    return this.#requestAuth.get(request);
  }

  getOptionalAuth(request: unknown): AuthSessionView | null {
    return this.#requestAuth.getOptional(request);
  }

  close(): Promise<void> {
    this.#closePromise ??= (async () => {
      await this.#requestDrain.beginClose();
      await this.#core.close();
    })();
    return this.#closePromise;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  #getAdapter(): HttpAdapter {
    const adapter = this.adapterHost.httpAdapter;
    if (!adapter) {
      throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
    }
    return adapter;
  }

  #installFastifyRequestDrain(): void {
    const adapter = this.adapterHost.httpAdapter as AdapterWithFastifyLifecycle | undefined;
    if (!adapter || adapter.getType?.() !== "fastify") {
      return;
    }
    const instance = adapter.getInstance?.();
    if (!isRecord(instance) || typeof instance.addHook !== "function") {
      throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
    }
    const fastify = instance as unknown as FastifyLifecycleInstance;
    fastify.addHook("onRequest", async (request, reply) => {
      this.#trackRequest(request, reply);
    });
    fastify.addHook("onResponse", async (request) => {
      this.#requestDrain.release(request);
    });
    fastify.addHook("onRequestAbort", async (request) => {
      this.#requestDrain.release(request);
    });
    fastify.addHook("preClose", async () => {
      await this.#requestDrain.beginClose();
    });
  }

  #trackRequest(request: unknown, response: unknown): boolean {
    if (!isRecord(request)) {
      throw connectorError("INVALID_REQUEST");
    }
    const accepted = this.#requestDrain.track(request);
    if (!accepted || this.#releaseListenersInstalled.has(request)) {
      return accepted;
    }
    const rawResponse = isRecord(response) && isRecord(response.raw) ? response.raw : response;
    if (!isRecord(rawResponse) || typeof rawResponse.once !== "function") {
      this.#requestDrain.release(request);
      throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
    }
    const release = (): void => {
      this.#requestDrain.release(request);
    };
    rawResponse.once("finish", release);
    rawResponse.once("close", release);
    this.#releaseListenersInstalled.add(request);
    return true;
  }

  #assertRequestTracked(request: unknown, response: unknown): void {
    if (!this.#trackRequest(request, response)) {
      throw new NodeOidcError("CLIENT_CLOSED");
    }
  }

  #readRequestUrl(adapter: HttpAdapter, request: unknown): string {
    const value = adapter.getRequestUrl(request);
    if (typeof value !== "string") {
      throw connectorError("INVALID_REQUEST");
    }
    return value;
  }

  #setNoStoreHeaders(adapter: HttpAdapter, response: unknown): void {
    adapter.setHeader(response, "Cache-Control", "no-store");
    adapter.setHeader(response, "Pragma", "no-cache");
    adapter.setHeader(response, "Referrer-Policy", "no-referrer");
  }

  #setCookies(adapter: HttpAdapter, response: unknown, cookies: readonly string[]): void {
    adapter.setHeader(response, "Set-Cookie", cookies as unknown as string);
  }

  #appendCookies(adapter: HttpAdapter, response: unknown, cookies: readonly string[]): void {
    const cookieHeaders = adapter as AdapterWithOptionalCookieHeaders;
    const appendHeader = cookieHeaders.appendHeader;
    if (typeof appendHeader === "function") {
      for (const cookie of cookies) {
        appendHeader.call(adapter, response, "Set-Cookie", cookie);
      }
      return;
    }
    const headerReader = cookieHeaders.getHeader;
    const existing =
      typeof headerReader === "function"
        ? normalizeSetCookieHeader(headerReader.call(adapter, response, "Set-Cookie"))
        : [];
    this.#setCookies(adapter, response, [...existing, ...cookies]);
  }

  #sendKnownError(adapter: HttpAdapter, response: unknown, mapped: MappedConnectorError): void {
    if (adapter.isHeadersSent(response)) {
      throw connectorError("INVALID_CLIENT_RESPONSE");
    }
    this.#setNoStoreHeaders(adapter, response);
    adapter.reply(response, mapped.body, mapped.status);
  }

  async #runEndpoint(
    expectedMethod: "GET" | "POST",
    request: unknown,
    response: unknown,
    handler: (adapter: HttpAdapter) => Promise<void>,
  ): Promise<void> {
    const adapter = this.#getAdapter();
    this.#setNoStoreHeaders(adapter, response);
    try {
      this.#assertRequestTracked(request, response);
      const method = adapter.getRequestMethod(request);
      if (method !== expectedMethod) {
        adapter.setHeader(response, "Allow", expectedMethod);
        throw connectorError("METHOD_NOT_ALLOWED");
      }
      await handler(adapter);
    } catch (error) {
      const mapped = mapConnectorError(error);
      if (!mapped) {
        throw error;
      }
      this.#sendKnownError(adapter, response, mapped);
    }
  }
}
