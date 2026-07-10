import type { AuthSessionView, NodeOidcClient } from "@gitea-oidc/node";
import { describe, expect, it, vi } from "vitest";
import { createWebConnectorCore } from "../index.js";

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
    logout: vi.fn(async () => ({
      logoutUrl: "https://id.example.com/session/end",
      warnings: [] as const,
    })),
    close: vi.fn(async () => {}),
  }) satisfies NodeOidcClient;

const createCore = (client = createClient()) => ({
  client,
  core: createWebConnectorCore({
    client,
    redirectUri: "https://app.example.com/oidc/callback",
    postLogoutRedirectUri: "https://app.example.com/signed-out",
    clock: () => NOW,
  }),
});

describe("WebConnectorCore", () => {
  it("starts login with a registered redirect and a short transaction cookie", async () => {
    const { client, core } = createCore();
    const result = await core.beginLogin("/oidc/login?returnTo=%2Fdashboard");

    expect(client.beginLogin).toHaveBeenCalledWith({
      redirectUri: "https://app.example.com/oidc/callback",
      returnTo: "/dashboard",
    });
    expect(result.redirectUrl).toContain("https://id.example.com/authorize");
    expect(result.transactionCookie).toContain(`=${TRANSACTION_ID}`);
    expect(result.transactionCookie).toContain("Path=/;");
    expect(result.transactionCookie).toContain("Max-Age=600");
    expect(result.transactionCookie).toContain("Secure");
  });

  it("completes callback from only the raw query and transaction cookie", async () => {
    const { client, core } = createCore();
    const result = await core.completeCallback(
      "/oidc/callback?code=authorization-code&state=server-state",
      `${core.cookies.transaction.name}=${TRANSACTION_ID}`,
    );

    expect(client.completeCallback).toHaveBeenCalledWith({
      callbackParameters: "code=authorization-code&state=server-state",
      transactionId: TRANSACTION_ID,
    });
    expect(result.redirectTo).toBe("/dashboard");
    expect(result.sessionCookie).toContain(`=${SESSION_ID}`);
    expect(result.sessionCookie).toContain("Path=/;");
    expect(result.sessionCookie).toContain("Max-Age=3600");
  });

  it("rejects callback without a unique opaque transaction cookie", async () => {
    const { client, core } = createCore();

    await expect(core.completeCallback("/oidc/callback?code=one", undefined)).rejects.toMatchObject(
      {
        code: "INVALID_REQUEST",
      },
    );
    await expect(
      core.completeCallback(
        "/oidc/callback?code=one",
        `${core.cookies.transaction.name}=${TRANSACTION_ID}; ${core.cookies.transaction.name}=${TRANSACTION_ID}`,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(client.completeCallback).not.toHaveBeenCalled();
  });

  it("projects only AuthSessionView fields and never forwards injected token fields", async () => {
    const client = createClient();
    client.getSession.mockResolvedValueOnce({
      ...session,
      accessToken: "must-not-leak",
      user: { ...session.user, internalId: "must-not-leak" },
    } as AuthSessionView);
    const { core } = createCore(client);

    const result = await core.resolveSession(`${core.cookies.session.name}=${SESSION_ID}`);

    expect(result.session).toEqual(session);
    expect(JSON.stringify(result.session)).not.toContain("must-not-leak");
    expect(Object.isFrozen(result.session)).toBe(true);
  });

  it("rejects malformed session views returned by an injected client", async () => {
    const client = createClient();
    const { core } = createCore(client);
    const cookie = `${core.cookies.session.name}=${SESSION_ID}`;

    client.getSession.mockResolvedValueOnce({
      ...session,
      user: { subject: "user-1\nadmin" },
    });
    await expect(core.resolveSession(cookie)).rejects.toMatchObject({
      code: "INVALID_CLIENT_RESPONSE",
    });

    client.getSession.mockResolvedValueOnce({
      ...session,
      createdAt: session.expiresAt,
    });
    await expect(core.resolveSession(cookie)).rejects.toMatchObject({
      code: "INVALID_CLIENT_RESPONSE",
    });
  });

  it("clears invalid and expired session cookies without downgrading storage errors", async () => {
    const { client, core } = createCore();
    const duplicate = `${core.cookies.session.name}=${SESSION_ID}; ${core.cookies.session.name}=${SESSION_ID}`;

    await expect(core.resolveSession(duplicate)).resolves.toMatchObject({
      session: null,
      clearSessionCookie: expect.stringContaining("Max-Age=0"),
    });
    expect(client.getSession).not.toHaveBeenCalled();

    client.getSession.mockResolvedValueOnce(null);
    await expect(
      core.resolveSession(`${core.cookies.session.name}=${SESSION_ID}`),
    ).resolves.toMatchObject({ session: null, clearSessionCookie: expect.any(String) });

    client.getSession.mockResolvedValueOnce({
      ...session,
      createdAt: "2026-07-10T07:00:00.000Z",
      expiresAt: "2026-07-10T08:00:00.000Z",
    });
    await expect(
      core.resolveSession(`${core.cookies.session.name}=${SESSION_ID}`),
    ).resolves.toMatchObject({ session: null, clearSessionCookie: expect.any(String) });

    client.getSession.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(core.resolveSession(`${core.cookies.session.name}=${SESSION_ID}`)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("requires exact same-origin logout before touching the session", async () => {
    const { client, core } = createCore();
    const cookie = `${core.cookies.session.name}=${SESSION_ID}`;

    await expect(core.logout(cookie, "https://evil.example.com")).rejects.toMatchObject({
      code: "CSRF_REJECTED",
    });
    expect(client.logout).not.toHaveBeenCalled();

    await expect(core.logout(cookie, "https://app.example.com")).resolves.toEqual({
      redirectUrl: "https://id.example.com/session/end",
      warnings: [],
    });
    expect(client.logout).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      postLogoutRedirectUri: "https://app.example.com/signed-out",
    });
  });

  it("does not close an injected Node client but closes that connector instance", async () => {
    const { client, core } = createCore();

    const first = core.close();
    const second = core.close();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(client.close).not.toHaveBeenCalled();
    await expect(core.beginLogin("/oidc/login")).rejects.toMatchObject({
      code: "CLIENT_CLOSED",
    });
    await expect(core.resolveSession(undefined)).rejects.toMatchObject({
      code: "CLIENT_CLOSED",
    });
    await expect(core.completeCallback("/oidc/callback", undefined)).rejects.toMatchObject({
      code: "CLIENT_CLOSED",
    });
    await expect(core.logout(undefined, "https://app.example.com")).rejects.toMatchObject({
      code: "CLIENT_CLOSED",
    });
    expect(() => core.validateLogoutOrigin("https://app.example.com")).toThrow(
      expect.objectContaining({ code: "CLIENT_CLOSED" }),
    );
    expect(() => core.clearTransactionCookie()).toThrow(
      expect.objectContaining({ code: "CLIENT_CLOSED" }),
    );
    expect(() => core.clearSessionCookie()).toThrow(
      expect.objectContaining({ code: "CLIENT_CLOSED" }),
    );
  });

  it("exposes only fixed logout warning codes", async () => {
    const client = createClient();
    client.logout.mockResolvedValueOnce({
      warnings: ["REFRESH_TOKEN_REVOCATION_FAILED"],
    });
    const { core } = createCore(client);
    const cookie = `${core.cookies.session.name}=${SESSION_ID}`;

    await expect(core.logout(cookie, "https://app.example.com")).resolves.toEqual({
      warnings: ["REFRESH_TOKEN_REVOCATION_FAILED"],
    });

    client.logout.mockResolvedValueOnce({
      warnings: ["secret-upstream-detail"],
    } as never);
    await expect(core.logout(cookie, "https://app.example.com")).rejects.toMatchObject({
      code: "INVALID_CLIENT_RESPONSE",
    });
  });

  it("reports fixed logout warnings through a non-blocking observability hook", async () => {
    const client = createClient();
    client.logout.mockResolvedValueOnce({
      warnings: ["ACCESS_TOKEN_REVOCATION_FAILED"],
    });
    const onLogoutWarning = vi.fn(() => {
      throw new Error("logging backend unavailable");
    });
    const core = createWebConnectorCore({
      client,
      redirectUri: "https://app.example.com/oidc/callback",
      onLogoutWarning,
      clock: () => NOW,
    });

    await expect(
      core.logout(`${core.cookies.session.name}=${SESSION_ID}`, "https://app.example.com"),
    ).resolves.toEqual({ warnings: ["ACCESS_TOKEN_REVOCATION_FAILED"] });
    expect(onLogoutWarning).toHaveBeenCalledWith("ACCESS_TOKEN_REVOCATION_FAILED");
  });

  it("namespaces host-only cookies by origin to avoid cross-port collisions", () => {
    const first = createWebConnectorCore({
      client: createClient(),
      redirectUri: "https://app.example.com:3000/oidc/callback",
    });
    const second = createWebConnectorCore({
      client: createClient(),
      redirectUri: "https://app.example.com:4000/oidc/callback",
    });

    expect(first.cookies.transaction.name).toMatch(/^__Host-/u);
    expect(first.cookies.transaction.path).toBe("/");
    expect(first.cookies.transaction.name).not.toBe(second.cookies.transaction.name);
    expect(first.cookies.session.name).not.toBe(second.cookies.session.name);
  });

  it("never falls back to in-memory storage for incomplete client options", () => {
    expect(() =>
      createWebConnectorCore({
        clientOptions: {} as never,
        redirectUri: "https://app.example.com/oidc/callback",
      }),
    ).toThrow();
    expect(() => createWebConnectorCore(null as never)).toThrow();
    expect(() =>
      createWebConnectorCore({
        client: null as never,
        redirectUri: "https://app.example.com/oidc/callback",
      }),
    ).toThrow();
  });

  it.each([
    "https://app.example.com/callback",
    "https://app.example.com/oidc/callback?tenant=one",
    "http://app.example.com/oidc/callback",
    "\nhttps://app.example.com/oidc/callback",
  ])("rejects invalid connector redirect URI %s", (redirectUri) => {
    expect(() => createWebConnectorCore({ client: createClient(), redirectUri })).toThrow();
  });
});
