import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthSessionView, NodeOidcClient } from "@gitea-oidc/node";
import express4 from "express4";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("express", async () => import("express4"));

import { createExpressOidc } from "../index.js";

const SESSION_ID = "s".repeat(43);
const session: AuthSessionView = {
  authenticated: true,
  user: { subject: "user-1" },
  scopes: ["openid"],
  canRefresh: false,
  createdAt: "2026-07-10T08:00:00.000Z",
  expiresAt: "2026-07-10T09:00:00.000Z",
};

const servers = new Set<Server>();

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  servers.delete(server);
};

describe("Express 4 peer compatibility", () => {
  afterEach(async () => {
    await Promise.all([...servers].map((server) => closeServer(server)));
  });

  it("forwards rejected async auth through next(error) on Express 4", async () => {
    const client = {
      beginLogin: vi.fn(),
      completeCallback: vi.fn(),
      getSession: vi.fn(async () => {
        throw new Error("express4 async failure");
      }),
      refreshSession: vi.fn(),
      logout: vi.fn(),
      close: vi.fn(),
    } as unknown as NodeOidcClient;
    const oidc = createExpressOidc({
      client,
      redirectUri: "https://app.example.com/oidc/callback",
      cookieNames: { session: "__Host-gitea_oidc_session" },
    });
    const app = express4();
    app.use(oidc.router);
    app.get("/required", oidc.requireAuth, (_request, response) => response.sendStatus(204));
    app.use(
      (
        error: unknown,
        _request: express4.Request,
        response: express4.Response,
        _next: express4.NextFunction,
      ) => {
        response.status(598).json({ error: error instanceof Error ? error.message : "unknown" });
      },
    );

    const server = createServer(app);
    servers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/required`, {
      headers: { Cookie: `__Host-gitea_oidc_session=${SESSION_ID}` },
    });

    expect(response.status).toBe(598);
    expect(await response.json()).toEqual({ error: "express4 async failure" });
  });
});
