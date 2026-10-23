import type { AuthSessionView, NodeOidcClient } from "@x-oidc/node";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createFastifyOidc } from "../index.js";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const SESSION_ID = "s".repeat(43);
const session: AuthSessionView = Object.freeze({
  authenticated: true,
  user: Object.freeze({ subject: "user-a" }),
  scopes: Object.freeze(["openid"]),
  canRefresh: false,
  createdAt: "2026-07-10T08:00:00.000Z",
  expiresAt: "2026-07-10T09:00:00.000Z",
});

const createClient = (sessionResponse: AuthSessionView | null) =>
  ({
    beginLogin: vi.fn(),
    completeCallback: vi.fn(),
    getSession: vi.fn(async () => sessionResponse),
    refreshSession: vi.fn(),
    logout: vi.fn(async () => ({ warnings: [] as const })),
    close: vi.fn(async () => {}),
  }) as unknown as NodeOidcClient;

describe("Fastify connector instance isolation", () => {
  it("never lets connector B reuse connector A auth on the same request", async () => {
    const clientA = createClient(session);
    const clientB = createClient(null);
    const connectorA = createFastifyOidc({
      client: clientA,
      redirectUri: "https://app.example.com/oidc/callback",
      cookieNames: { session: "__Host-x_oidc_session" },
      clock: () => NOW,
    });
    const connectorB = createFastifyOidc({
      client: clientB,
      redirectUri: "https://app.example.com/oidc/callback",
      cookieNames: { session: "__Host-x_oidc_session" },
      clock: () => NOW,
    });
    const app = Fastify();
    app.get(
      "/cross-instance",
      { preHandler: [connectorA.optionalAuth, connectorB.requireAuth] },
      async () => ({ accepted: true }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/cross-instance",
      headers: { cookie: `__Host-x_oidc_session=${SESSION_ID}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(clientA.getSession).toHaveBeenCalledOnce();
    expect(clientB.getSession).toHaveBeenCalledOnce();
    await Promise.all([connectorA.close(), connectorB.close(), app.close()]);
  });
});
