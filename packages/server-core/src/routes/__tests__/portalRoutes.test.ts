import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPortalRoutes, setPortalSecurityHeaders } from "../portalRoutes.js";

describe("registerPortalRoutes", () => {
  let publicDir: string;

  beforeEach(() => {
    publicDir = mkdtempSync(join(tmpdir(), "gitea-oidc-portal-routes-"));
    mkdirSync(join(publicDir, "portal", "assets"), { recursive: true });
    writeFileSync(
      join(publicDir, "portal", "index.html"),
      '<!doctype html><html lang="zh-CN"><head></head><body><div id="app"></div></body></html>',
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(publicDir, { recursive: true, force: true });
  });

  const createApp = () => ({ get: vi.fn(), post: vi.fn() });

  const createReply = () => {
    const reply = {
      header: vi.fn(),
      type: vi.fn(),
      code: vi.fn(),
      send: vi.fn(),
      redirect: vi.fn(),
      sendFile: vi.fn(),
    };
    for (const method of ["header", "type", "code"] as const) {
      reply[method].mockReturnValue(reply);
    }
    return reply;
  };

  const createConfig = () =>
    ({
      portal: {
        enabled: true,
        basePath: "/portal",
        clientId: "portal-client",
        sessionTtlSeconds: 3600,
      },
      admin: {
        enabled: true,
        basePath: "/admin",
        allowedGroups: ["gitea-oidc-admins"],
        sessionTtlSeconds: 3600,
      },
      auth: { stateStore: { type: "memory" } },
      server: { url: "http://localhost:3000" },
      oidc: { issuer: "http://localhost:3000/oidc" },
      clients: [
        {
          client_id: "portal-client",
          client_secret: "portal:secret/%",
          redirect_uris: ["http://localhost:3000/portal/callback"],
          post_logout_redirect_uris: ["http://localhost:3000/portal/signed-out"],
          response_types: ["code"],
          grant_types: ["authorization_code"],
          token_endpoint_auth_method: "client_secret_basic",
        },
      ],
    }) as any;

  const createUser = (status: "active" | "disabled" = "active") => ({
    id: "random-id",
    sub: "user-1",
    username: "alice",
    name: "Alice",
    email: "alice@example.com",
    picture: "https://example.com/avatar.png",
    authProvider: "feishu",
    externalId: "external-secret-id",
    groups: [{ id: "gitea-oidc-admins", name: "管理员" }],
    roles: ["member"],
    status,
    providerProfile: { provider: "feishu", externalId: "external-secret-id", raw: { token: "x" } },
    metadata: { private: true },
  });

  const createOidcProvider = (
    overrides: {
      accessToken?: Record<string, unknown> | null;
      grant?: Record<string, unknown> | null;
      client?: Record<string, unknown> | null;
    } = {},
  ) => ({
    AccessToken: {
      find: vi.fn().mockResolvedValue(
        overrides.accessToken === undefined
          ? {
              accountId: "user-1",
              clientId: "portal-client",
              grantId: "grant-1",
              kind: "AccessToken",
              destroy: vi.fn().mockResolvedValue(undefined),
            }
          : overrides.accessToken,
      ),
    },
    Client: {
      find: vi
        .fn()
        .mockResolvedValue(
          overrides.client === undefined ? { clientId: "portal-client" } : overrides.client,
        ),
    },
    Grant: {
      find: vi
        .fn()
        .mockResolvedValue(
          overrides.grant === undefined
            ? { accountId: "user-1", clientId: "portal-client", isExpired: false }
            : overrides.grant,
        ),
    },
  });

  const register = (overrides: Record<string, unknown> = {}) => {
    const app = createApp();
    const userRepository = {
      findById: vi.fn().mockResolvedValue(createUser()),
    };
    const auditLogRepository = {
      append: vi.fn().mockResolvedValue({}),
    };
    const oidcProvider = createOidcProvider();
    const listPortalApplications = vi.fn().mockResolvedValue([
      {
        id: "app-1",
        name: "Gitea",
        description: "代码托管",
        iconUrl: "https://example.com/gitea.png",
        launchUrl: "https://git.example.com",
        order: 1,
      },
    ]);
    const sessionStore = registerPortalRoutes({
      app: app as any,
      publicDir,
      config: createConfig(),
      oidcProvider: oidcProvider as any,
      userRepository: userRepository as any,
      auditLogRepository: auditLogRepository as any,
      listPortalApplications,
      ...overrides,
    });
    return {
      app,
      userRepository,
      auditLogRepository,
      oidcProvider,
      listPortalApplications,
      sessionStore: sessionStore!,
    };
  };

  const handler = (app: ReturnType<typeof createApp>, method: "get" | "post", path: string) =>
    app[method].mock.calls.find((call) => call[0] === path)?.[1];

  const startLogin = async (app: ReturnType<typeof createApp>, returnTo = "/portal?view=all") => {
    const reply = createReply();
    await handler(
      app,
      "get",
      "/portal/login/start",
    )({ query: { returnTo }, headers: {}, ip: "127.0.0.1" }, reply);
    const authorizationUrl = new URL(reply.redirect.mock.calls[0]?.[0]);
    const setCookie = reply.header.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1];
    const binding = String(setCookie).match(/gitea_oidc_portal_login=([a-f0-9]{64})/u)?.[1];
    return { reply, authorizationUrl, binding: binding! };
  };

  it("serves the portal shell with runtime paths and hardened headers", async () => {
    const { app } = register();
    const reply = createReply();

    await handler(app, "get", "/portal/signed-out")({ headers: {} }, reply);

    const html = reply.send.mock.calls[0]?.[0] as string;
    expect(html).toContain('data-gitea-oidc-portal-base-path="/portal"');
    expect(html).toContain('data-gitea-oidc-admin-base-path="/admin"');
    expect(html).toContain('<base href="/portal/">');
    expect(reply.header).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("frame-ancestors 'none'"),
    );
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("creates a browser-bound, PKCE protected login and rejects external return paths", async () => {
    const { app } = register();
    const { authorizationUrl } = await startLogin(app, "https://evil.example/steal");

    expect(authorizationUrl.pathname).toBe("/oidc/auth");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("portal-client");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/portal/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/u);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("validates the portal token binding, creates a BFF session, and consumes state once", async () => {
    const { app, auditLogRepository, oidcProvider } = register();
    const { authorizationUrl, binding } = await startLogin(app);
    const state = authorizationUrl.searchParams.get("state")!;
    const challenge = authorizationUrl.searchParams.get("code_challenge")!;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "access-token-must-not-be-logged" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const reply = createReply();
    await handler(
      app,
      "get",
      "/portal/callback",
    )(
      {
        query: { code: "authorization-code", state },
        headers: {
          cookie: `gitea_oidc_portal_login=${binding}`,
          "user-agent": "vitest",
        },
        ip: "127.0.0.1",
      },
      reply,
    );

    expect(reply.redirect).toHaveBeenCalledWith("/portal?view=all");
    const tokenRequest = fetchMock.mock.calls[0]?.[1];
    const body = tokenRequest.body as URLSearchParams;
    const authorization = tokenRequest.headers.Authorization as string;
    expect(Buffer.from(authorization.slice("Basic ".length), "base64").toString()).toBe(
      "portal-client:portal%3Asecret%2F%25",
    );
    expect(body.get("code_verifier")).toBeTruthy();
    expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(
      challenge,
    );
    expect(oidcProvider.Client.find).toHaveBeenCalledWith("portal-client");
    expect(oidcProvider.Grant.find).toHaveBeenCalledWith("grant-1", {
      ignoreExpiration: true,
    });
    const issuedToken = await oidcProvider.AccessToken.find.mock.results[0]?.value;
    expect(issuedToken.destroy).toHaveBeenCalledOnce();
    expect(auditLogRepository.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user.login",
        outcome: "success",
        source: "portal",
        userId: "user-1",
      }),
    );
    expect(JSON.stringify(auditLogRepository.append.mock.calls)).not.toContain(
      "access-token-must-not-be-logged",
    );

    const replayReply = createReply();
    await handler(
      app,
      "get",
      "/portal/callback",
    )(
      {
        query: { code: "authorization-code", state },
        headers: { cookie: `gitea_oidc_portal_login=${binding}` },
        ip: "127.0.0.1",
      },
      replayReply,
    );
    expect(replayReply.code).toHaveBeenCalledWith(400);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects tokens issued to another client and disabled users", async () => {
    const foreignProvider = createOidcProvider({
      accessToken: {
        accountId: "user-1",
        clientId: "other-client",
        grantId: "grant-1",
        kind: "AccessToken",
      },
    });
    const foreign = register({ oidcProvider: foreignProvider as any });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ access_token: "foreign-token" }),
      }),
    );
    const foreignStart = await startLogin(foreign.app);
    const foreignReply = createReply();
    await handler(
      foreign.app,
      "get",
      "/portal/callback",
    )(
      {
        query: {
          code: "code",
          state: foreignStart.authorizationUrl.searchParams.get("state"),
        },
        headers: { cookie: `gitea_oidc_portal_login=${foreignStart.binding}` },
      },
      foreignReply,
    );
    expect(foreignReply.code).toHaveBeenCalledWith(403);

    const disabledRepository = { findById: vi.fn().mockResolvedValue(createUser("disabled")) };
    const disabled = register({ userRepository: disabledRepository as any });
    const disabledStart = await startLogin(disabled.app);
    const disabledReply = createReply();
    await handler(
      disabled.app,
      "get",
      "/portal/callback",
    )(
      {
        query: {
          code: "code",
          state: disabledStart.authorizationUrl.searchParams.get("state"),
        },
        headers: { cookie: `gitea_oidc_portal_login=${disabledStart.binding}` },
      },
      disabledReply,
    );
    expect(disabledReply.code).toHaveBeenCalledWith(403);
  });

  it("returns only the safe user projection and portal application projection", async () => {
    const { app, sessionStore, listPortalApplications } = register();
    const session = await sessionStore.createSession("user-1");
    const headers = { cookie: `gitea_oidc_portal_session=${session.id}` };

    const me = await handler(app, "get", "/portal/api/me")({ headers }, createReply());
    expect(me).toEqual({
      user: {
        sub: "user-1",
        username: "alice",
        name: "Alice",
        email: "alice@example.com",
        picture: "https://example.com/avatar.png",
        groups: [{ id: "gitea-oidc-admins", name: "管理员" }],
        roles: ["member"],
        status: "active",
      },
      admin: true,
      basePath: "/portal",
      adminBasePath: "/admin",
    });
    expect(JSON.stringify(me)).not.toContain("external-secret-id");
    expect(JSON.stringify(me)).not.toContain("metadata");

    const applications = await handler(
      app,
      "get",
      "/portal/api/applications",
    )({ headers }, createReply());
    expect(applications).toEqual([
      {
        id: "app-1",
        name: "Gitea",
        description: "代码托管",
        iconUrl: "https://example.com/gitea.png",
        launchUrl: "https://git.example.com",
        order: 1,
      },
    ]);
    expect(listPortalApplications).toHaveBeenCalledOnce();
  });

  it("rejects CSRF logout attempts and ends both the BFF and OP sessions", async () => {
    const { app, sessionStore, auditLogRepository } = register();
    const session = await sessionStore.createSession("user-1");
    const cookie = `gitea_oidc_portal_session=${session.id}`;

    const rejectedReply = createReply();
    await handler(app, "post", "/portal/logout")({ headers: { cookie } }, rejectedReply);
    expect(rejectedReply.code).toHaveBeenCalledWith(403);
    expect(await sessionStore.getSession(session.id)).not.toBeNull();

    const reply = createReply();
    const result = await handler(
      app,
      "post",
      "/portal/logout",
    )(
      {
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-gitea-oidc-portal-action": "logout",
        },
        ip: "127.0.0.1",
      },
      reply,
    );

    expect(await sessionStore.getSession(session.id)).toBeNull();
    expect(result.ok).toBe(true);
    const endSessionUrl = new URL(result.redirectTo);
    expect(endSessionUrl.pathname).toBe("/oidc/session/end");
    expect(endSessionUrl.searchParams.get("client_id")).toBe("portal-client");
    expect(endSessionUrl.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost:3000/portal/signed-out",
    );
    expect(auditLogRepository.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user.logout",
        outcome: "success",
        source: "portal",
        userId: "user-1",
      }),
    );
  });

  it("never accepts bearer tokens as portal BFF sessions", async () => {
    const { app, userRepository } = register();
    const reply = createReply();

    await handler(
      app,
      "get",
      "/portal/api/me",
    )({ headers: { authorization: "Bearer access-token" } }, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it("does not register any routes when the portal is disabled", () => {
    const app = createApp();
    const config = createConfig();
    config.portal.enabled = false;

    expect(
      registerPortalRoutes({
        app: app as any,
        publicDir: join(publicDir, "missing"),
        config,
        oidcProvider: {} as any,
        userRepository: {} as any,
        listPortalApplications: vi.fn(),
      }),
    ).toBeNull();
    expect(app.get).not.toHaveBeenCalled();
    expect(app.post).not.toHaveBeenCalled();
  });
});

describe("setPortalSecurityHeaders", () => {
  it("sets anti-framing and MIME sniffing protections", () => {
    const target = { setHeader: vi.fn() };
    setPortalSecurityHeaders(target);
    expect(target.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(target.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(target.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.not.stringContaining("'unsafe-inline'"),
    );
  });

  it("only permits HTTP images for local HTTP deployments", () => {
    const target = { setHeader: vi.fn() };
    setPortalSecurityHeaders(target, true);

    expect(target.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("img-src 'self' data: https: http:"),
    );
  });
});
