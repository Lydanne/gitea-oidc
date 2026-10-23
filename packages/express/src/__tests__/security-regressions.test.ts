import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthSessionView, NodeOidcClient } from "@x-oidc/node";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExpressOidc } from "../index.js";

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

const servers = new Set<Server>();

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  servers.delete(server);
};

afterEach(async () => {
  await Promise.all([...servers].map(closeServer));
});

describe("Express connector instance isolation", () => {
  it("never lets connector B reuse connector A auth on the same request", async () => {
    const clientA = createClient(session);
    const clientB = createClient(null);
    const connectorA = createExpressOidc({
      client: clientA,
      redirectUri: "https://app.example.com/oidc/callback",
      cookieNames: { session: "__Host-x_oidc_session" },
      clock: () => NOW,
    });
    const connectorB = createExpressOidc({
      client: clientB,
      redirectUri: "https://app.example.com/oidc/callback",
      cookieNames: { session: "__Host-x_oidc_session" },
      clock: () => NOW,
    });
    const app = express();
    app.get(
      "/cross-instance",
      connectorA.optionalAuth,
      connectorB.requireAuth,
      (_request, response) => {
        response.sendStatus(204);
      },
    );
    const server = createServer(app);
    servers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/cross-instance`, {
      headers: { Cookie: `__Host-x_oidc_session=${SESSION_ID}` },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(clientA.getSession).toHaveBeenCalledOnce();
    expect(clientB.getSession).toHaveBeenCalledOnce();
    await Promise.all([connectorA.close(), connectorB.close()]);
  });
});
