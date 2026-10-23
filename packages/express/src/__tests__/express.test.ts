import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthSessionView, NodeOidcClient } from "@x-oidc/node";
import express, { type ErrorRequestHandler } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExpressOidc } from "../index.js";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const TRANSACTION_ID = "t".repeat(43);
const SESSION_ID = "s".repeat(43);

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
  readonly baseUrl: string;
  readonly client: ReturnType<typeof createClient>;
  readonly close: () => Promise<void>;
}

const fixtures = new Set<Fixture>();

const createFixture = async (): Promise<Fixture> => {
  const client = createClient();
  const oidc = createExpressOidc({
    client,
    redirectUri: "https://app.example.com/oidc/callback",
    cookieNames: { session: "__Host-x_oidc_session" },
    clock: () => NOW,
  });
  const app = express();
  app.use(oidc.router);
  app.get("/required", oidc.requireAuth, (request, response) => {
    response.json({ auth: oidc.getAuth(request) });
  });
  app.get("/tamper-auth", oidc.requireAuth, (request, response) => {
    const changed = Reflect.set(request, "auth", null);
    response.json({ changed, subject: oidc.getAuth(request).user.subject });
  });
  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(599).json({ error: error instanceof Error ? error.message : "unknown" });
  };
  app.use(errorHandler);

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  let closed = false;
  const fixture: Fixture = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    client,
    async close() {
      if (closed) return;
      closed = true;
      await oidc.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  fixtures.add(fixture);
  return fixture;
};

describe("Express-specific connector behavior", () => {
  afterEach(async () => {
    await Promise.all([...fixtures].map(async (fixture) => fixture.close()));
    fixtures.clear();
  });

  it("keeps the resolved auth view immutable on the request", async () => {
    const fixture = await createFixture();
    const response = await fetch(`${fixture.baseUrl}/tamper-auth`, {
      headers: { Cookie: `__Host-x_oidc_session=${SESSION_ID}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: false, subject: "user-1" });
  });

  it("explicitly forwards asynchronous unknown errors to Express error middleware", async () => {
    const fixture = await createFixture();
    fixture.client.getSession.mockRejectedValueOnce(new Error("async storage failure"));

    const response = await fetch(`${fixture.baseUrl}/required`, {
      headers: { Cookie: `__Host-x_oidc_session=${SESSION_ID}` },
    });

    expect(response.status).toBe(599);
    expect(await response.json()).toEqual({ error: "async storage failure" });
  });
});
