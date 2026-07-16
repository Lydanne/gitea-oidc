import type { AddressInfo } from "node:net";
import type { AuthSessionView, NodeOidcClient } from "@x-oidc/node";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFastifyOidc } from "../index.js";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const TRANSACTION_ID = "t".repeat(43);
const SESSION_ID = "s".repeat(43);
const TRANSACTION_COOKIE_NAME = "__Host-x_oidc_transaction";
const SESSION_COOKIE_NAME = "__Host-x_oidc_session";

const session: AuthSessionView = Object.freeze({
  authenticated: true,
  user: Object.freeze({ subject: "user-1", name: "示例用户" }),
  scopes: Object.freeze(["openid", "profile"]),
  canRefresh: false,
  createdAt: "2026-07-10T08:00:00.000Z",
  expiresAt: "2026-07-10T09:00:00.000Z",
});

const createClient = () =>
  ({
    beginLogin: vi.fn(async () => ({
      authorizationUrl: "https://id.example.com/authorize?state=server-state",
      transactionId: TRANSACTION_ID,
      expiresAt: "2026-07-10T08:10:00.000Z",
    })),
    completeCallback: vi.fn(async () => ({
      sessionId: SESSION_ID,
      session,
      returnTo: "/dashboard",
    })),
    getSession: vi.fn(async () => session),
    refreshSession: vi.fn(async () => session),
    logout: vi.fn(async () => ({ warnings: [] as const })),
    close: vi.fn(async () => {}),
  }) satisfies NodeOidcClient;

interface Fixture {
  readonly app: FastifyInstance;
  readonly client: ReturnType<typeof createClient>;
}

const apps = new Set<FastifyInstance>();

const createFixture = async (): Promise<Fixture> => {
  const app = Fastify();
  apps.add(app);
  const client = createClient();
  const oidc = createFastifyOidc({
    client,
    redirectUri: "https://app.example.com/oidc/callback",
    cookieNames: { transaction: TRANSACTION_COOKIE_NAME, session: SESSION_COOKIE_NAME },
    clock: () => NOW,
  });
  app.register(oidc);
  app.get("/required", { preHandler: oidc.requireAuth }, async (request) => ({
    auth: oidc.getAuth(request),
  }));
  app.setErrorHandler((error, _request, reply) => {
    reply.code(599).send({ error: error.message });
  });
  await app.ready();
  return { app, client };
};

describe("Fastify-specific connector behavior", () => {
  afterEach(async () => {
    await Promise.all([...apps].map(async (app) => app.close()));
    apps.clear();
  });

  it("publishes a non-encapsulated request auth decoration", async () => {
    const fixture = await createFixture();

    expect(fixture.app.hasRequestDecorator("auth")).toBe(true);
  });

  it("delegates unknown async failures to the Fastify error handler", async () => {
    const fixture = await createFixture();
    fixture.client.getSession.mockRejectedValueOnce(new Error("storage failure"));

    const response = await fixture.app.inject({
      method: "GET",
      url: "/required",
      headers: { cookie: `__Host-x_oidc_session=${SESSION_ID}` },
    });

    expect(response.statusCode).toBe(599);
    expect(response.json()).toEqual({ error: "storage failure" });
  });

  it("drains an accepted callback response before Fastify closes its socket", async () => {
    const fixture = await createFixture();
    let markCallbackStarted!: () => void;
    let releaseCallback!: () => void;
    const callbackStarted = new Promise<void>((resolve) => {
      markCallbackStarted = resolve;
    });
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    fixture.client.completeCallback.mockImplementationOnce(async () => {
      markCallbackStarted();
      await callbackGate;
      return { sessionId: SESSION_ID, session, returnTo: "/dashboard" };
    });
    await fixture.app.listen({ host: "127.0.0.1", port: 0 });
    const address = fixture.app.server.address() as AddressInfo;
    const responsePromise = fetch(
      `http://127.0.0.1:${address.port}/oidc/callback?code=authorization-code&state=state`,
      {
        headers: { Cookie: `${TRANSACTION_COOKIE_NAME}=${TRANSACTION_ID}` },
        redirect: "manual",
      },
    );
    await callbackStarted;

    let closeResolved = false;
    const closing = fixture.app.close().then(() => {
      closeResolved = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeResolved).toBe(false);

      releaseCallback();
      const response = await responsePromise;
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/dashboard");
      expect(response.headers.get("set-cookie")).toContain(`${TRANSACTION_COOKIE_NAME}=;`);
      expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=${SESSION_ID}`);
      await closing;
      expect(closeResolved).toBe(true);
    } finally {
      releaseCallback();
      await Promise.allSettled([closing, responsePromise]);
      apps.delete(fixture.app);
    }
  });

  it("drains auth preHandlers on user routes registered beside the plugin", async () => {
    const fixture = await createFixture();
    let markSessionLookupStarted!: () => void;
    let releaseSessionLookup!: () => void;
    const sessionLookupStarted = new Promise<void>((resolve) => {
      markSessionLookupStarted = resolve;
    });
    const sessionLookupGate = new Promise<void>((resolve) => {
      releaseSessionLookup = resolve;
    });
    fixture.client.getSession.mockImplementationOnce(async () => {
      markSessionLookupStarted();
      await sessionLookupGate;
      return session;
    });
    await fixture.app.listen({ host: "127.0.0.1", port: 0 });
    const address = fixture.app.server.address() as AddressInfo;
    const responsePromise = fetch(`http://127.0.0.1:${address.port}/required`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    });
    await sessionLookupStarted;

    let closeResolved = false;
    const closing = fixture.app.close().then(() => {
      closeResolved = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeResolved).toBe(false);

      releaseSessionLookup();
      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ auth: { user: { subject: "user-1" } } });
      await closing;
    } finally {
      releaseSessionLookup();
      await Promise.allSettled([closing, responsePromise]);
      apps.delete(fixture.app);
    }
  });

  it("lets accepted callbacks finish during explicit close and rejects late OIDC work", async () => {
    const app = Fastify();
    apps.add(app);
    const client = createClient();
    let markCallbackPreHandlerStarted!: () => void;
    let releaseCallbackPreHandler!: () => void;
    const callbackPreHandlerStarted = new Promise<void>((resolve) => {
      markCallbackPreHandlerStarted = resolve;
    });
    const callbackPreHandlerGate = new Promise<void>((resolve) => {
      releaseCallbackPreHandler = resolve;
    });
    let blockCallback = true;
    app.addHook("preHandler", async (request) => {
      if (blockCallback && request.url.startsWith("/oidc/callback?")) {
        blockCallback = false;
        markCallbackPreHandlerStarted();
        await callbackPreHandlerGate;
      }
    });
    const oidc = createFastifyOidc({
      client,
      redirectUri: "https://app.example.com/oidc/callback",
      cookieNames: { transaction: TRANSACTION_COOKIE_NAME, session: SESSION_COOKIE_NAME },
      clock: () => NOW,
    });
    app.register(oidc);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const callbackResponse = fetch(`${baseUrl}/oidc/callback?code=authorization-code&state=state`, {
      headers: { Cookie: `${TRANSACTION_COOKIE_NAME}=${TRANSACTION_ID}` },
      redirect: "manual",
    });
    await callbackPreHandlerStarted;

    let closeResolved = false;
    const closing = oidc.close().then(() => {
      closeResolved = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeResolved).toBe(false);

      const lateLogin = await fetch(`${baseUrl}/oidc/login`, { redirect: "manual" });
      expect(lateLogin.status).toBe(503);
      expect(await lateLogin.json()).toMatchObject({ error: { code: "CLIENT_CLOSED" } });
      expect(client.beginLogin).not.toHaveBeenCalled();

      releaseCallbackPreHandler();
      const response = await callbackResponse;
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/dashboard");
      expect(response.headers.get("set-cookie")).toContain(`${TRANSACTION_COOKIE_NAME}=;`);
      expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=${SESSION_ID}`);
      await closing;
      expect(client.completeCallback).toHaveBeenCalledOnce();
    } finally {
      releaseCallbackPreHandler();
      await Promise.allSettled([closing, callbackResponse]);
      await app.close();
      apps.delete(app);
    }
  });
});
