import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminRoutes, setAdminSecurityHeaders } from "../adminRoutes";

describe("registerAdminRoutes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createApp = () => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  });

  const adminCookieHeader = (sessionId: string) => ({
    cookie: `gitea_oidc_admin_session=${sessionId}`,
  });

  const adminMutationHeaders = (sessionId: string, origin: string = "http://localhost:3000") => ({
    ...adminCookieHeader(sessionId),
    "content-type": "application/json",
    origin,
    "x-gitea-oidc-admin-action": "1",
  });

  const createAdminClient = (serverUrl: string = "http://localhost:3000") => ({
    client_id: "gitea",
    client_secret: "secret",
    redirect_uris: [`${serverUrl}/admin/callback`],
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "client_secret_basic",
  });

  const createAdminCallbackOidcProvider = (
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
              accountId: "admin-1",
              clientId: "gitea",
              grantId: "grant-1",
              kind: "AccessToken",
            }
          : overrides.accessToken,
      ),
    },
    Client: {
      find: vi
        .fn()
        .mockResolvedValue(
          overrides.client === undefined ? { clientId: "gitea" } : overrides.client,
        ),
    },
    Grant: {
      find: vi
        .fn()
        .mockResolvedValue(
          overrides.grant === undefined
            ? { accountId: "admin-1", clientId: "gitea", isExpired: false }
            : overrides.grant,
        ),
    },
  });

  it("allows configured admin group users to call /admin/api/me with an admin session", async () => {
    const app = createApp();
    const user = { sub: "user-1", groups: ["gitea-oidc-admins"], status: "active" };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(user), list: vi.fn() } as any,
    });
    const session = sessionStore!.createSession("user-1");

    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const result = await handler(
      { headers: adminCookieHeader(session.id) },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(result).toEqual({ user, admin: true });
  });

  it("rejects bearer tokens on admin APIs", async () => {
    const app = createApp();
    const accessTokenFind = vi.fn().mockResolvedValue({ accountId: "admin-1" });
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {
        AccessToken: { find: accessTokenFind },
      } as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn(), list: vi.fn() } as any,
    });
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler({ headers: { authorization: "Bearer oidc-token" } }, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(accessTokenFind).not.toHaveBeenCalled();
  });

  it("rejects non-admin provider users from admin APIs", async () => {
    const app = createApp();
    const user = {
      sub: "feishu-user-1",
      groups: ["dev-group"],
      authProvider: "feishu",
      status: "active",
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(user), list: vi.fn() } as any,
    });
    const session = sessionStore!.createSession("feishu-user-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler({ headers: adminCookieHeader(session.id) }, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Forbidden" });
  });

  it("rejects unsafe user list query options before calling the repository", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      list: vi.fn().mockResolvedValue([]),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler(
      {
        headers: adminCookieHeader(session.id),
        query: { sortBy: "username; DROP TABLE users" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "Unsupported user sort field" });
    expect(userRepository.list).not.toHaveBeenCalled();
  });

  it("parses safe user list query options explicitly", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      list: vi.fn().mockResolvedValue([]),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];

    const result = await handler(
      {
        headers: adminCookieHeader(session.id),
        query: {
          authProvider: "local",
          sortBy: "username",
          sortOrder: "desc",
          offset: "1",
          limit: "2",
        },
      },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(result).toEqual([]);
    expect(userRepository.list).toHaveBeenCalledWith({
      filter: { authProvider: "local" },
      sortBy: "username",
      sortOrder: "desc",
      offset: 1,
      limit: 2,
    });
  });

  it("uses a safe default limit for user list queries", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      list: vi.fn().mockResolvedValue([]),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];

    await handler(
      {
        headers: adminCookieHeader(session.id),
        query: {},
      },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(userRepository.list).toHaveBeenCalledWith({ limit: 100 });
  });

  it("builds admin login authorization URL from the configured OIDC issuer", async () => {
    const app = createApp();
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
    });
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/login/start")?.[1];
    const reply = { redirect: vi.fn() };

    await handler({ query: { returnTo: "/admin/tokens" } }, reply);

    const redirectUrl = new URL(reply.redirect.mock.calls[0][0]);
    expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe("http://localhost:3000/oidc/auth");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/admin/callback",
    );
  });

  it("selects the client that is configured for the admin callback", async () => {
    const app = createApp();
    registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [
          {
            ...createAdminClient(),
            client_id: "business-app",
            redirect_uris: ["http://localhost:8080/callback"],
          },
          {
            ...createAdminClient(),
            client_id: "admin-app",
            client_secret: "admin-secret",
          },
        ],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
    });
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/login/start")?.[1];
    const reply = { redirect: vi.fn() };

    await handler({ query: {} }, reply);

    const redirectUrl = new URL(reply.redirect.mock.calls[0][0]);
    expect(redirectUrl.searchParams.get("client_id")).toBe("admin-app");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/admin/callback",
    );
  });

  it("rejects admin route registration when no client can receive the admin callback", () => {
    const app = createApp();

    expect(() =>
      registerAdminRoutes({
        app: app as any,
        config: {
          admin: {
            enabled: true,
            basePath: "/admin",
            allowedGroups: ["gitea-oidc-admins"],
            sessionTtlSeconds: 3600,
          },
          server: { url: "http://localhost:3000" },
          oidc: { issuer: "http://localhost:3000/oidc" },
          clients: [
            {
              ...createAdminClient(),
              redirect_uris: ["http://localhost:8080/callback"],
            },
          ],
        } as any,
        oidcProvider: {} as any,
        authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
        userRepository: {} as any,
      }),
    ).toThrow(/Admin client configuration is invalid/);
  });

  it("normalizes trailing slash in server.url for the admin callback URI", async () => {
    const app = createApp();
    registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000/" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
    });
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/login/start")?.[1];
    const reply = { redirect: vi.fn() };

    await handler({ query: {} }, reply);

    const redirectUrl = new URL(reply.redirect.mock.calls[0][0]);
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/admin/callback",
    );
  });

  it("serves the admin SPA index for login and routed admin pages", async () => {
    const app = createApp();
    registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
    });
    const loginHandler = app.get.mock.calls.find((call) => call[0] === "/admin/login")?.[1];
    const usersHandler = app.get.mock.calls.find((call) => call[0] === "/admin/users")?.[1];
    const reply = {
      header: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await loginHandler({}, reply);
    await usersHandler({}, reply);

    expect(reply.type).toHaveBeenCalledTimes(2);
    expect(reply.type).toHaveBeenCalledWith("text/html; charset=utf-8");
    expect(reply.header).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("frame-ancestors 'none'"),
    );
    expect(reply.header).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(reply.header).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(reply.header).toHaveBeenCalledWith("Referrer-Policy", "same-origin");
    expect(reply.send.mock.calls[0][0]).toContain('<div id="app"></div>');
  });

  it("can apply admin security headers to Node static responses", () => {
    const response = { setHeader: vi.fn() };

    setAdminSecurityHeaders(response);

    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("script-src 'self'"),
    );
    expect(response.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(response.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
  });

  it("wires user create, update and delete APIs behind admin guard", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const created = {
      sub: "user-1",
      username: "user-1",
      email: "user-1@example.com",
      groups: [],
      status: "active",
    };
    const createPayload = {
      username: "user-1",
      email: "user-1@example.com",
      groups: [],
      status: "active",
    };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn().mockResolvedValue(created),
      update: vi.fn().mockResolvedValue({ ...created, status: "disabled" }),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");

    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const patchHandler = app.patch.mock.calls.find(
      (call) => call[0] === "/admin/api/users/:sub",
    )?.[1];
    const deleteHandler = app.delete.mock.calls.find(
      (call) => call[0] === "/admin/api/users/:sub",
    )?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler({ headers: adminMutationHeaders(session.id), body: createPayload }, reply);
    await patchHandler(
      {
        headers: adminMutationHeaders(session.id),
        params: { sub: "user-1" },
        body: { status: "disabled" },
      },
      reply,
    );
    await deleteHandler(
      { headers: adminMutationHeaders(session.id), params: { sub: "user-1" } },
      reply,
    );

    expect(userRepository.create).toHaveBeenCalledWith(createPayload);
    expect(userRepository.update).toHaveBeenCalledWith("user-1", { status: "disabled" });
    expect(userRepository.delete).toHaveBeenCalledWith("user-1");
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it("revokes OIDC and provider credentials before deleting a user", async () => {
    const app = createApp();
    const calls: string[] = [];
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const user = { sub: "user-1", groups: [], status: "active" };
    const userRepository = {
      findById: vi.fn().mockImplementation(async (sub) => (sub === "admin-1" ? admin : user)),
      delete: vi.fn(async () => calls.push("delete")),
    };
    const tokenRepository = {
      deleteByOwnerId: vi.fn(async () => calls.push("provider-tokens")),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
      tokenRepository: tokenRepository as any,
      revokeOidcAccount: async () => calls.push("oidc"),
    });
    const session = sessionStore!.createSession("admin-1") as any;
    const handler = app.delete.mock.calls.find((call) => call[0] === "/admin/api/users/:sub")?.[1];

    await handler(
      { headers: adminMutationHeaders(session.id), params: { sub: "user-1" } },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(calls).toEqual(["oidc", "provider-tokens", "delete"]);
  });

  it("does not disable a user when credential revocation fails", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const user = { sub: "user-1", groups: [], status: "active" };
    const userRepository = {
      findById: vi.fn().mockImplementation(async (sub) => (sub === "admin-1" ? admin : user)),
      update: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
      revokeOidcAccount: vi.fn().mockRejectedValue(new Error("revoke failed")),
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.patch.mock.calls.find((call) => call[0] === "/admin/api/users/:sub")?.[1];

    await expect(
      handler(
        {
          headers: adminMutationHeaders(session.id),
          params: { sub: "user-1" },
          body: { status: "disabled" },
        },
        { code: vi.fn().mockReturnThis(), send: vi.fn() },
      ),
    ).rejects.toThrow("revoke failed");
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it("does not expose raw provider tokens from /admin/api/tokens", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      tokenRepository: {
        list: vi.fn().mockResolvedValue([
          {
            id: "feishu:user:user-1",
            provider: "feishu",
            ownerType: "user",
            ownerId: "user-1",
            accessToken: "raw-access-token",
            refreshToken: "raw-refresh-token",
            status: "valid",
            expiresAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ]),
      } as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/tokens")?.[1];

    const result = await handler({ headers: adminCookieHeader(session.id), query: {} }, {});

    expect(result).toEqual([
      expect.objectContaining({
        id: "feishu:user:user-1",
        provider: "feishu",
        ownerType: "user",
        ownerId: "user-1",
        status: "valid",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("raw-access-token");
    expect(JSON.stringify(result)).not.toContain("raw-refresh-token");
  });

  it("uses a safe default limit for provider token list queries", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const tokenRepository = { list: vi.fn().mockResolvedValue([]) };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      tokenRepository: tokenRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/tokens")?.[1];

    const result = await handler(
      { headers: adminCookieHeader(session.id), query: {} },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(result).toEqual([]);
    expect(tokenRepository.list).toHaveBeenCalledWith({ limit: 100 });
  });

  it("parses safe provider token list query options explicitly", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const tokenRepository = { list: vi.fn().mockResolvedValue([]) };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      tokenRepository: tokenRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/tokens")?.[1];

    const result = await handler(
      {
        headers: adminCookieHeader(session.id),
        query: {
          provider: "feishu",
          ownerType: "user",
          ownerId: "user-1",
          status: "valid",
          offset: "1",
          limit: "2",
        },
      },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(result).toEqual([]);
    expect(tokenRepository.list).toHaveBeenCalledWith({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      status: "valid",
      offset: 1,
      limit: 2,
    });
  });

  it("rejects unsafe provider token list query options before calling the repository", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const tokenRepository = { list: vi.fn().mockResolvedValue([]) };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      tokenRepository: tokenRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/tokens")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler(
      {
        headers: adminCookieHeader(session.id),
        query: { ownerType: "tenant", limit: "-1" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: "Unsupported provider token owner type",
    });
    expect(tokenRepository.list).not.toHaveBeenCalled();
  });

  it("rejects invalid provider token probe payloads before probing", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const providerApiService = { probeToken: vi.fn() };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      providerApiService: providerApiService as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find((call) => call[0] === "/admin/api/tokens/probe")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler(
      {
        headers: adminMutationHeaders(session.id),
        body: { provider: "feishu", ownerType: "tenant", ownerId: "user-1" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: "Unsupported provider token owner type",
    });
    expect(providerApiService.probeToken).not.toHaveBeenCalled();
  });

  it("probes provider tokens only with a validated payload", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const providerApiService = { probeToken: vi.fn().mockResolvedValue("valid") };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      providerApiService: providerApiService as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find((call) => call[0] === "/admin/api/tokens/probe")?.[1];

    const result = await handler(
      {
        headers: adminMutationHeaders(session.id),
        body: { provider: "feishu", ownerType: "user", ownerId: "user-1" },
      },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(result).toEqual({ status: "valid" });
    expect(providerApiService.probeToken).toHaveBeenCalledWith("feishu", "user", "user-1");
  });

  it("does not expose raw provider profile or metadata from user APIs", async () => {
    const app = createApp();
    const admin = {
      sub: "admin-1",
      username: "admin",
      email: "admin@example.com",
      groups: ["gitea-oidc-admins"],
      authProvider: "feishu",
      externalId: "open-admin",
      status: "active",
      providerProfile: {
        provider: "feishu",
        externalId: "open-admin",
        raw: {
          mobile: "13800000000",
          accessToken: "profile-token",
        },
      },
      metadata: {
        unionId: "union-admin",
        accessToken: "metadata-token",
      },
    };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      list: vi.fn().mockResolvedValue([admin]),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");

    const meHandler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const listHandler = app.get.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const detailHandler = app.get.mock.calls.find(
      (call) => call[0] === "/admin/api/users/:sub",
    )?.[1];

    const me = await meHandler(
      { headers: adminCookieHeader(session.id) },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );
    const users = await listHandler({ headers: adminCookieHeader(session.id), query: {} }, {});
    const detail = await detailHandler(
      { headers: adminCookieHeader(session.id), params: { sub: "admin-1" } },
      {},
    );

    expect(me.user).toEqual(
      expect.objectContaining({
        sub: "admin-1",
        username: "admin",
        email: "admin@example.com",
        authProvider: "feishu",
        externalId: "open-admin",
      }),
    );
    for (const value of [me, users, detail]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain("providerProfile");
      expect(serialized).not.toContain("metadata");
      expect(serialized).not.toContain("13800000000");
      expect(serialized).not.toContain("profile-token");
      expect(serialized).not.toContain("metadata-token");
    }
  });

  it("rejects unsupported admin user mutation fields", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn(),
      update: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const patchHandler = app.patch.mock.calls.find(
      (call) => call[0] === "/admin/api/users/:sub",
    )?.[1];
    const postReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    const patchReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler(
      {
        headers: adminMutationHeaders(session.id),
        body: {
          username: "user-1",
          metadata: { accessToken: "raw-token" },
        },
      },
      postReply,
    );
    await patchHandler(
      {
        headers: adminMutationHeaders(session.id),
        params: { sub: "admin-1" },
        body: {
          authProvider: "feishu",
          externalId: "open-admin-rebound",
          emailVerified: true,
          providerProfile: { raw: { mobile: "13800000000" } },
        },
      },
      patchReply,
    );

    expect(postReply.code).toHaveBeenCalledWith(400);
    expect(postReply.send).toHaveBeenCalledWith({
      error: "Unsupported user fields: metadata",
    });
    expect(patchReply.code).toHaveBeenCalledWith(400);
    expect(patchReply.send).toHaveBeenCalledWith({
      error: "Unsupported user fields: authProvider, externalId, emailVerified, providerProfile",
    });
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it("rejects invalid admin user mutation field types", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin), create: vi.fn() } as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler(
      {
        headers: adminMutationHeaders(session.id),
        body: {
          username: "user-1",
          groups: "gitea-oidc-admins",
        },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "User field must be a string array: groups" });
  });

  it("rejects cookie-authenticated mutations without CSRF headers", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler(
      {
        headers: {
          cookie: `gitea_oidc_admin_session=${session.id}`,
          "content-type": "application/json",
          origin: "https://id.example.com",
        },
        body: { username: "user-1" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "CSRF protection failed" });
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("allows cookie-authenticated mutations with same-origin CSRF headers", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const created = { sub: "user-1", username: "user-1", status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn().mockResolvedValue(created),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler(
      {
        headers: {
          cookie: `gitea_oidc_admin_session=${session.id}`,
          "content-type": "application/json",
          origin: "https://id.example.com",
          "x-gitea-oidc-admin-action": "1",
        },
        body: { username: "user-1" },
      },
      reply,
    );

    expect(userRepository.create).toHaveBeenCalledWith({ username: "user-1" });
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith(created);
  });

  it("rejects mutation Referer fallback from same-origin non-admin path prefixes", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler(
      {
        headers: {
          cookie: `gitea_oidc_admin_session=${session.id}`,
          "content-type": "application/json",
          referer: "https://id.example.com/admin2/users",
          "x-gitea-oidc-admin-action": "1",
        },
        body: { username: "user-1" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "CSRF protection failed" });
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("marks the admin session cookie Secure on HTTPS deployments", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: createAdminCallbackOidcProvider() as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
    });
    const state = sessionStore!.createLoginState("/admin/users");
    const callbackHandler = app.get.mock.calls.find((call) => call[0] === "/admin/callback")?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ access_token: "admin-token" }),
      }),
    );

    await callbackHandler({ query: { code: "code-1", state } }, reply);

    expect(reply.header).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("Secure"));
  });

  it("rejects admin callback tokens issued to a non-admin client", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: createAdminCallbackOidcProvider({
        accessToken: {
          accountId: "admin-1",
          clientId: "business-app",
          grantId: "grant-1",
          kind: "AccessToken",
        },
      }) as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
    });
    const state = sessionStore!.createLoginState("/admin/users");
    const callbackHandler = app.get.mock.calls.find((call) => call[0] === "/admin/callback")?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ access_token: "business-token" }),
      }),
    );

    await callbackHandler({ query: { code: "code-1", state } }, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith("Forbidden");
    expect(reply.header).not.toHaveBeenCalled();
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it("rejects admin callback tokens whose grant is expired or bound to another user", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["gitea-oidc-admins"], status: "active" };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: createAdminCallbackOidcProvider({
        grant: { accountId: "other-user", clientId: "gitea", isExpired: false },
      }) as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
    });
    const state = sessionStore!.createLoginState("/admin/users");
    const callbackHandler = app.get.mock.calls.find((call) => call[0] === "/admin/callback")?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ access_token: "admin-token" }),
      }),
    );

    await callbackHandler({ query: { code: "code-1", state } }, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith("Forbidden");
    expect(reply.header).not.toHaveBeenCalled();
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it("rejects disabled users even when they still have an admin session", async () => {
    const app = createApp();
    const disabledAdmin = {
      sub: "admin-1",
      groups: ["gitea-oidc-admins"],
      status: "disabled",
    };
    const sessionStore = registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["gitea-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(disabledAdmin) } as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler({ headers: { cookie: `gitea_oidc_admin_session=${session.id}` } }, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});
