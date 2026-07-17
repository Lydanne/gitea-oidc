import "reflect-metadata";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { HttpException } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { AuthSessionView, NodeOidcClient } from "@x-oidc/node";
import { describe, expect, it, vi } from "vitest";
import { NestOidcService } from "../nestOidcService.js";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const SESSION_ID = "s".repeat(43);
const SESSION_COOKIE_NAME = `__Host-x_oidc_session_${createHash("sha256")
  .update("https://app.example.com")
  .digest("base64url")
  .slice(0, 16)}`;
const session: AuthSessionView = Object.freeze({
  authenticated: true,
  user: Object.freeze({ subject: "user-a" }),
  scopes: Object.freeze(["openid"]),
  canRefresh: false,
  createdAt: "2026-07-10T08:00:00.000Z",
  expiresAt: "2026-07-10T09:00:00.000Z",
});

const createClient = (sessionResponse: AuthSessionView | null): NodeOidcClient => ({
  beginLogin: vi.fn(),
  completeCallback: vi.fn(),
  getSession: vi.fn(async () => sessionResponse),
  refreshSession: vi.fn(),
  logout: vi.fn(async () => ({ warnings: [] })),
  close: vi.fn(async () => {}),
});

const createService = (client: NodeOidcClient): NestOidcService => {
  const adapterHost = new HttpAdapterHost();
  adapterHost.httpAdapter = {
    appendHeader: vi.fn(),
    setHeader: vi.fn(),
  } as never;
  return new NestOidcService(
    {
      client,
      redirectUri: "https://app.example.com/oidc/callback",
      clock: () => NOW,
    },
    adapterHost,
  );
};

describe("Nest connector instance isolation", () => {
  it("never lets connector B reuse connector A auth on the same request", async () => {
    const clientA = createClient(session);
    const clientB = createClient(null);
    const connectorA = createService(clientA);
    const connectorB = createService(clientB);
    const request = { headers: { cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` } };
    const response = new EventEmitter();

    await expect(connectorA.resolveAuth(request, response)).resolves.toEqual(session);
    await expect(connectorB.requireAuth(request, response)).rejects.toBeInstanceOf(HttpException);

    expect(clientA.getSession).toHaveBeenCalledOnce();
    expect(clientB.getSession).toHaveBeenCalledOnce();
    expect(connectorA.getAuth(request).user.subject).toBe("user-a");
    expect(() => connectorB.getAuth(request)).toThrow(HttpException);
  });
});
