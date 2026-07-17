import { fileURLToPath } from "node:url";
import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminRoutes, setAdminSecurityHeaders } from "../adminRoutes.js";

const publicDir = fileURLToPath(new URL("../../../public", import.meta.url));

describe("registerAdminRoutes", () => {
  const adminLoginBinding = "a".repeat(64);
  const adminLoginBindingHash = createHash("sha256").update(adminLoginBinding).digest("hex");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createApp = () => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  });

  const createOidcClientLifecycle = () => ({
    acquireBlock: vi.fn((clientId: string) => ({
      clientId,
      commit: vi.fn(),
      release: vi.fn(),
    })),
    revoke: vi.fn().mockResolvedValue(undefined),
    allow: vi.fn(),
  });

  const adminCookieHeader = (sessionId: string) => ({
    cookie: `x_oidc_admin_session=${sessionId}`,
  });

  const adminLoginCookieHeader = (binding: string = adminLoginBinding) => ({
    cookie: `x_oidc_admin_login=${binding}`,
  });

  const adminMutationHeaders = (sessionId: string, origin: string = "http://localhost:3000") => ({
    ...adminCookieHeader(sessionId),
    "content-type": "application/json",
    origin,
    "x-oidc-admin-action": "1",
  });

  const createAdminClient = (serverUrl: string = "http://localhost:3000") => ({
    client_id: "gitea",
    client_secret: "secret",
    redirect_uris: [`${serverUrl}/admin/callback`],
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "client_secret_basic",
  });

  const createGroups = (...ids: string[]) => ids.map((id) => ({ id, name: id }));
  const createAdminGroups = () => createGroups("x-oidc-admins");

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
    const user = { sub: "user-1", groups: createAdminGroups(), status: "active" };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(user), list: vi.fn() } as any,
      applicationService: {} as any,
      oidcClientLifecycle: createOidcClientLifecycle(),
    });
    const session = sessionStore!.createSession("user-1");

    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const result = await handler(
      { headers: adminCookieHeader(session.id) },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(result).toEqual({
      user,
      admin: true,
      basePath: "/admin",
      capabilities: { applications: true },
    });
  });

  it("rejects bearer tokens on admin APIs", async () => {
    const app = createApp();
    const accessTokenFind = vi.fn().mockResolvedValue({ accountId: "admin-1" });
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
      groups: createGroups("dev-group"),
      authProvider: "feishu",
      status: "active",
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = {
      sub: "admin-1",
      groups: [
        {
          id: "platform",
          name: "平台",
          children: [{ id: "x-oidc-admins", name: "OIDC 管理员" }],
        },
      ],
      status: "active",
    };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      list: vi.fn().mockResolvedValue([]),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      list: vi.fn().mockResolvedValue([]),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      list: vi.fn().mockResolvedValue([]),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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

  it("builds the admin login URL and preserves the applications return path", async () => {
    const app = createApp();
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const reply = { header: vi.fn().mockReturnThis(), redirect: vi.fn() };

    await handler({ query: { returnTo: "/admin/applications?status=disabled" } }, reply);

    const redirectUrl = new URL(reply.redirect.mock.calls[0][0]);
    expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe("http://localhost:3000/oidc/auth");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/admin/callback",
    );
    expect(
      (await sessionStore!.consumeLoginState(redirectUrl.searchParams.get("state") ?? ""))
        ?.returnTo,
    ).toBe("/admin/applications?status=disabled");
    expect(reply.header).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringMatching(/x_oidc_admin_login=[a-f0-9]{64}/u),
    );

    for (const returnTo of [
      "https://evil.example.com/admin/applications",
      "//evil.example.com/admin/applications",
      "/admin/unknown",
    ]) {
      reply.redirect.mockClear();
      await handler({ query: { returnTo } }, reply);
      const rejectedRedirectUrl = new URL(reply.redirect.mock.calls[0][0]);
      expect(
        (await sessionStore!.consumeLoginState(rejectedRedirectUrl.searchParams.get("state") ?? ""))
          ?.returnTo,
      ).toBe("/admin/users");
    }
  });

  it("returns 429 when a custom distributed state store reaches its login limit", async () => {
    const app = createApp();
    const stateStore = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      take: vi.fn().mockResolvedValue(null),
      increment: vi.fn().mockResolvedValue(1001),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        auth: {
          stateStore: {
            type: "redis",
            redis: { url: "redis://localhost:6379" },
          },
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
      stateStore,
    });
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/login/start")?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
      redirect: vi.fn(),
    };

    await handler({ query: {} }, reply);

    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith("Too many admin login attempts");
    expect(reply.redirect).not.toHaveBeenCalled();
    expect(stateStore.set).not.toHaveBeenCalled();
  });

  it("rate limits repeated login starts without evicting pending states", async () => {
    const app = createApp();
    registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn(),
    };

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await handler({ headers: adminLoginCookieHeader(), ip: "203.0.113.10", query: {} }, reply);
    }
    await handler({ headers: adminLoginCookieHeader(), ip: "203.0.113.10", query: {} }, reply);

    expect(reply.redirect).toHaveBeenCalledTimes(30);
    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith("Too many admin login attempts");
  });

  it("selects the client that is configured for the admin callback", async () => {
    const app = createApp();
    registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const reply = { header: vi.fn().mockReturnThis(), redirect: vi.fn() };

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
        publicDir,
        app: app as any,
        config: {
          admin: {
            enabled: true,
            basePath: "/admin",
            allowedGroups: ["x-oidc-admins"],
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
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const reply = { header: vi.fn().mockReturnThis(), redirect: vi.fn() };

    await handler({ query: {} }, reply);

    const redirectUrl = new URL(reply.redirect.mock.calls[0][0]);
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/admin/callback",
    );
  });

  it("injects the runtime base path and application capability into admin pages", async () => {
    const app = createApp();
    registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/ops/identity/",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [
          {
            ...createAdminClient(),
            redirect_uris: ["http://localhost:3000/ops/identity/callback"],
          },
        ],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
      applicationService: {} as any,
      oidcClientLifecycle: createOidcClientLifecycle(),
    });
    const loginHandler = app.get.mock.calls.find((call) => call[0] === "/ops/identity/login")?.[1];
    const usersHandler = app.get.mock.calls.find((call) => call[0] === "/ops/identity/users")?.[1];
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
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(reply.send.mock.calls[0][0]).toContain('data-x-oidc-admin-base-path="/ops/identity"');
    expect(reply.send.mock.calls[0][0]).toContain('data-x-oidc-applications-enabled="true"');
    expect(reply.send.mock.calls[0][0]).toContain('<base href="/ops/identity/">');
    expect(reply.send.mock.calls[0][0]).toContain('<div id="app"></div>');

    const assetHandler = app.get.mock.calls.find(
      (call) => call[0] === "/ops/identity/assets/*",
    )?.[1];
    const assetReply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      sendFile: vi.fn().mockReturnThis(),
    };
    await expect(assetHandler({ params: { "*": "index-abc123.js" } }, assetReply)).resolves.toBe(
      assetReply,
    );
    expect(assetReply.sendFile).toHaveBeenCalledWith("admin/assets/index-abc123.js", {
      maxAge: "1y",
      immutable: true,
    });

    await assetHandler({ params: { "*": "../secrets.txt" } }, assetReply);
    expect(assetReply.code).toHaveBeenCalledWith(404);
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
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
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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

    const auditContext = { source: "admin", actorUserId: "admin-1" };
    expect(userRepository.create).toHaveBeenCalledWith(createPayload, auditContext);
    expect(userRepository.update).toHaveBeenCalledWith(
      "user-1",
      { status: "disabled" },
      auditContext,
    );
    expect(userRepository.delete).toHaveBeenCalledWith("user-1", auditContext);
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it("revokes OIDC and provider credentials before deleting a user", async () => {
    const app = createApp();
    const calls: string[] = [];
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const user = { sub: "user-1", groups: [], status: "active" };
    const userRepository = {
      findById: vi.fn().mockImplementation(async (sub) => (sub === "admin-1" ? admin : user)),
      delete: vi.fn(async () => calls.push("delete")),
    };
    const tokenRepository = {
      deleteByOwnerId: vi.fn(async () => calls.push("provider-tokens")),
    };
    const accountLease = {
      accountId: "user-1",
      commit: vi.fn(async () => calls.push("commit-block")),
      release: vi.fn(async () => calls.push("release-block")),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
      oidcAccountLifecycle: {
        acquireBlock: vi.fn(async () => {
          calls.push("acquire-block");
          return accountLease;
        }),
        revoke: vi.fn(async () => calls.push("oidc")),
        allow: vi.fn(),
      },
    });
    const session = sessionStore!.createSession("admin-1") as any;
    const handler = app.delete.mock.calls.find((call) => call[0] === "/admin/api/users/:sub")?.[1];

    await handler(
      { headers: adminMutationHeaders(session.id), params: { sub: "user-1" } },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(calls).toEqual(["acquire-block", "oidc", "provider-tokens", "delete", "commit-block"]);
    expect(accountLease.release).not.toHaveBeenCalled();
  });

  it("按用户、事件、结果和时间范围查询审计日志", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const records = [
      {
        id: "audit-1",
        eventType: "user.login",
        outcome: "success",
        source: "provider",
        userId: "user-1",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    ];
    const auditLogRepository = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(records),
      count: vi.fn().mockResolvedValue(1),
      deleteOlderThan: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      auditLogRepository: auditLogRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/audit-logs")?.[1];

    const result = await handler(
      {
        headers: adminCookieHeader(session.id),
        query: {
          userId: "user-1",
          eventType: "user.login",
          outcome: "success",
          from: "2026-03-01T00:00:00.000Z",
          to: "2026-03-31T23:59:59.000Z",
          offset: "10",
          limit: "20",
        },
      },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(auditLogRepository.list).toHaveBeenCalledWith({
      userId: "user-1",
      eventType: "user.login",
      outcome: "success",
      from: new Date("2026-03-01T00:00:00.000Z"),
      to: new Date("2026-03-31T23:59:59.000Z"),
      offset: 10,
      limit: 20,
    });
    expect(auditLogRepository.count).toHaveBeenCalledWith({
      userId: "user-1",
      eventType: "user.login",
      outcome: "success",
      from: new Date("2026-03-01T00:00:00.000Z"),
      to: new Date("2026-03-31T23:59:59.000Z"),
    });
    expect(result).toEqual({ items: records, total: 1 });
  });

  it("拒绝非法审计筛选条件", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const auditLogRepository = {
      append: vi.fn(),
      list: vi.fn(),
      count: vi.fn(),
      deleteOlderThan: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      auditLogRepository: auditLogRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/audit-logs")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler(
      {
        headers: adminCookieHeader(session.id),
        query: { eventType: "password.exported" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "Unsupported audit event type" });
    expect(auditLogRepository.list).not.toHaveBeenCalled();
  });

  it("管理员退出时删除会话并记录审计事件", async () => {
    const app = createApp();
    const admin = {
      sub: "admin-1",
      username: "root",
      groups: createAdminGroups(),
      status: "active",
    };
    const auditLogRepository = {
      append: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      count: vi.fn(),
      deleteOlderThan: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      auditLogRepository: auditLogRepository as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find((call) => call[0] === "/admin/logout")?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await handler(
      {
        headers: {
          ...adminMutationHeaders(session.id),
          "user-agent": "Audit Test",
        },
        ip: "203.0.113.10",
      },
      reply,
    );

    expect(await sessionStore!.getSession(session.id)).toBeNull();
    expect(auditLogRepository.append).toHaveBeenCalledWith({
      eventType: "admin.logout",
      outcome: "success",
      source: "admin",
      userId: "admin-1",
      username: "root",
      clientId: "gitea",
      ipAddress: "203.0.113.10",
      userAgent: "Audit Test",
    });
    expect(reply.send).toHaveBeenCalledWith({ ok: true });
  });

  it("does not disable a user when credential revocation fails", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const user = { sub: "user-1", groups: [], status: "active" };
    const userRepository = {
      findById: vi.fn().mockImplementation(async (sub) => (sub === "admin-1" ? admin : user)),
      update: vi.fn(),
    };
    const accountLease = {
      accountId: "user-1",
      commit: vi.fn(),
      release: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
      oidcAccountLifecycle: {
        acquireBlock: vi.fn().mockResolvedValue(accountLease),
        revoke: vi.fn().mockRejectedValue(new Error("revoke failed")),
        allow: vi.fn(),
      },
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
    expect(accountLease.release).toHaveBeenCalledOnce();
    expect(accountLease.commit).not.toHaveBeenCalled();
  });

  it("removes durable account blocks after creating or explicitly re-enabling a user", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const activeUser = { sub: "user-1", username: "user-1", groups: [], status: "active" };
    const userRepository = {
      findById: vi.fn().mockImplementation(async (sub) => (sub === "admin-1" ? admin : activeUser)),
      create: vi.fn().mockResolvedValue(activeUser),
      update: vi.fn().mockResolvedValue(activeUser),
    };
    const allow = vi.fn().mockResolvedValue(undefined);
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
      oidcAccountLifecycle: {
        acquireBlock: vi.fn(),
        revoke: vi.fn(),
        allow,
      },
    });
    const session = sessionStore!.createSession("admin-1");
    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const patchHandler = app.patch.mock.calls.find(
      (call) => call[0] === "/admin/api/users/:sub",
    )?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler(
      {
        headers: adminMutationHeaders(session.id),
        body: { username: "user-1", status: "active" },
      },
      reply,
    );
    await patchHandler(
      {
        headers: adminMutationHeaders(session.id),
        params: { sub: "user-1" },
        body: { status: "active" },
      },
      reply,
    );

    expect(allow).toHaveBeenNthCalledWith(1, "user-1");
    expect(allow).toHaveBeenNthCalledWith(2, "user-1");
  });

  it("does not expose raw provider tokens from /admin/api/tokens", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const tokenRepository = { list: vi.fn().mockResolvedValue([]) };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const tokenRepository = { list: vi.fn().mockResolvedValue([]) };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const tokenRepository = { list: vi.fn().mockResolvedValue([]) };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const providerApiService = { probeToken: vi.fn() };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const providerApiService = { probeToken: vi.fn().mockResolvedValue("valid") };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
      groups: createAdminGroups(),
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
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn(),
      update: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
          groups: "x-oidc-admins",
        },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "User groups must be an array" });

    const legacyReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await postHandler(
      {
        headers: adminMutationHeaders(session.id),
        body: {
          username: "user-1",
          groups: ["x-oidc-admins"],
        },
      },
      legacyReply,
    );

    expect(legacyReply.code).toHaveBeenCalledWith(400);
    expect(legacyReply.send).toHaveBeenCalledWith({
      error: "User group must be an object with id and name",
    });
  });

  it("accepts and returns tree-shaped admin user groups", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const groups = [
      {
        id: "engineering",
        name: "研发中心",
        children: [{ id: "backend", name: "后端组" }],
      },
    ];
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn().mockImplementation(async (user) => ({
        sub: "user-1",
        status: "disabled",
        ...user,
      })),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler(
      {
        headers: adminMutationHeaders(session.id),
        body: {
          username: "alice",
          name: "Alice",
          email: "alice@example.com",
          authProvider: "local",
          externalId: "alice",
          groups,
          status: "disabled",
        },
      },
      reply,
    );

    expect(userRepository.create).toHaveBeenCalledWith(expect.objectContaining({ groups }), {
      source: "admin",
      actorUserId: "admin-1",
    });
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ groups }));
  });

  it("rejects cookie-authenticated mutations without CSRF headers", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
          cookie: `x_oidc_admin_session=${session.id}`,
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const created = { sub: "user-1", username: "user-1", status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn().mockResolvedValue(created),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
          cookie: `x_oidc_admin_session=${session.id}`,
          "content-type": "application/json",
          origin: "https://id.example.com",
          "x-oidc-admin-action": "1",
        },
        body: { username: "user-1" },
      },
      reply,
    );

    expect(userRepository.create).toHaveBeenCalledWith(
      { username: "user-1" },
      { source: "admin", actorUserId: "admin-1" },
    );
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith(created);
  });

  it("rejects mutation Referer fallback from same-origin non-admin path prefixes", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const userRepository = {
      findById: vi.fn().mockResolvedValue(admin),
      create: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
          cookie: `x_oidc_admin_session=${session.id}`,
          "content-type": "application/json",
          referer: "https://id.example.com/admin2/users",
          "x-oidc-admin-action": "1",
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
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const auditLogRepository = {
      append: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      count: vi.fn(),
      deleteOlderThan: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: createAdminCallbackOidcProvider() as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      auditLogRepository: auditLogRepository as any,
    });
    const state = sessionStore!.createLoginState("/admin/users", adminLoginBindingHash);
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

    await callbackHandler(
      {
        headers: { ...adminLoginCookieHeader(), "user-agent": "Audit Test" },
        ip: "203.0.113.10",
        query: { code: "code-1", state },
      },
      reply,
    );

    expect(reply.header).toHaveBeenCalledWith("Set-Cookie", [
      expect.stringContaining("x_oidc_admin_login=;"),
      expect.stringMatching(/x_oidc_admin_session=.*Secure/u),
    ]);
    expect(auditLogRepository.append).toHaveBeenCalledWith({
      eventType: "admin.login",
      outcome: "success",
      source: "admin",
      userId: "admin-1",
      username: undefined,
      clientId: "gitea",
      ipAddress: "203.0.113.10",
      userAgent: "Audit Test",
    });
  });

  it("rejects admin callbacks that are not bound to the initiating browser", async () => {
    const app = createApp();
    const auditLogRepository = {
      append: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      count: vi.fn(),
      deleteOlderThan: vi.fn(),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "https://id.example.com" },
        oidc: { issuer: "https://id.example.com/oidc" },
        clients: [createAdminClient("https://id.example.com")],
      } as any,
      oidcProvider: createAdminCallbackOidcProvider() as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
      auditLogRepository: auditLogRepository as any,
    });
    const callbackHandler = app.get.mock.calls.find((call) => call[0] === "/admin/callback")?.[1];

    for (const headers of [{}, adminLoginCookieHeader("b".repeat(64))]) {
      const state = sessionStore!.createLoginState("/admin/users", adminLoginBindingHash);
      const reply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
        header: vi.fn().mockReturnThis(),
        redirect: vi.fn(),
      };

      await callbackHandler({ headers, query: { code: "code-1", state } }, reply);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith("Invalid admin login state");
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.stringMatching(/x_oidc_admin_login=;.*Max-Age=0/u),
      );
      expect(reply.redirect).not.toHaveBeenCalled();
      expect(await sessionStore!.consumeLoginState(state)).toBeNull();
    }

    expect(auditLogRepository.append).toHaveBeenCalledTimes(2);

    const anonymousReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn(),
    };
    await callbackHandler(
      { headers: {}, query: { code: "code-1", state: "not-issued-by-this-service" } },
      anonymousReply,
    );
    expect(auditLogRepository.append).toHaveBeenCalledTimes(2);
  });

  it("rejects admin callback tokens issued to a non-admin client", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const state = sessionStore!.createLoginState("/admin/users", adminLoginBindingHash);
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

    await callbackHandler(
      { headers: adminLoginCookieHeader(), query: { code: "code-1", state } },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith("Forbidden");
    expect(reply.header).toHaveBeenCalledOnce();
    expect(reply.header).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("x_oidc_admin_login=;"),
    );
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it("rejects admin callback tokens whose grant is expired or bound to another user", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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
    const state = sessionStore!.createLoginState("/admin/users", adminLoginBindingHash);
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

    await callbackHandler(
      { headers: adminLoginCookieHeader(), query: { code: "code-1", state } },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith("Forbidden");
    expect(reply.header).toHaveBeenCalledOnce();
    expect(reply.header).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("x_oidc_admin_login=;"),
    );
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it("rejects disabled users even when they still have an admin session", async () => {
    const app = createApp();
    const disabledAdmin = {
      sub: "admin-1",
      groups: createAdminGroups(),
      status: "disabled",
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
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

    await handler({ headers: { cookie: `x_oidc_admin_session=${session.id}` } }, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("returns 503 for application APIs when the control plane is disabled", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
    });
    const session = sessionStore!.createSession("admin-1");
    const meHandler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/applications")?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    const me = await meHandler(
      { headers: adminCookieHeader(session.id) },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );
    await handler({ headers: adminCookieHeader(session.id) }, reply);

    expect(me.capabilities).toEqual({ applications: false });
    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({ error: "Application management is not enabled" });
  });

  it("refuses to mount an application control plane without an OIDC lifecycle coordinator", () => {
    expect(() =>
      registerAdminRoutes({
        publicDir,
        app: createApp() as any,
        config: {
          admin: {
            enabled: true,
            basePath: "/admin",
            allowedGroups: ["x-oidc-admins"],
            sessionTtlSeconds: 3600,
          },
          server: { url: "http://localhost:3000" },
          oidc: { issuer: "http://localhost:3000/oidc" },
          clients: [createAdminClient()],
        } as any,
        oidcProvider: {} as any,
        authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
        userRepository: {} as any,
        applicationService: {} as any,
      }),
    ).toThrow("必须同时配置 applicationService 和 oidcClientLifecycle");
  });

  it("marks application reads no-store and hides internal storage errors", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: {
        listApplicationDetails: vi.fn().mockRejectedValue(new Error("/private/applications.db")),
      } as any,
      oidcClientLifecycle: createOidcClientLifecycle(),
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/applications")?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await expect(handler({ headers: adminCookieHeader(session.id) }, reply)).resolves.toBe(reply);

    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(reply.header).toHaveBeenCalledWith("Pragma", "no-cache");
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: "Internal Server Error" });
    expect(JSON.stringify(reply.send.mock.calls)).not.toContain("applications.db");
  });

  it("returns a repeatable public connection document without credentials", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const connection = {
      schemaVersion: 1,
      issuer: "https://id.example.com",
      clientId: "client-1",
      redirectUris: ["https://app.example.com/callback"],
    };
    const applicationService = {
      getApplicationConnection: vi.fn().mockResolvedValue(connection),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: createOidcClientLifecycle(),
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.get.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/:id/connection",
    )?.[1];
    const reply = { code: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };

    await expect(
      handler({ headers: adminCookieHeader(session.id), params: { id: "app-1" } }, reply),
    ).resolves.toBe(connection);

    expect(applicationService.getApplicationConnection).toHaveBeenCalledWith("app-1");
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(JSON.stringify(connection)).not.toContain("clientSecret");
  });

  it("creates an application with idempotency and no-store response headers", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const applicationService = {
      createCustomApplication: vi.fn().mockResolvedValue({
        replayed: false,
        response: {
          application: { id: "app-1" },
          credentialDelivery: {
            kind: "direct",
            credential: {
              schemaVersion: 1,
              applicationId: "app-1",
              oidcClientId: "oidc-client-1",
              issuer: "https://id.example.com",
              clientId: "client-1",
              kind: "client_secret",
              clientSecret: "one-time-secret",
            },
          },
        },
      }),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: createOidcClientLifecycle(),
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find((call) => call[0] === "/admin/api/applications")?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    const body = { schemaVersion: 1 };

    await handler(
      {
        headers: {
          ...adminMutationHeaders(session.id),
          "idempotency-key": "create-app-request-1",
        },
        body,
      },
      reply,
    );

    expect(applicationService.createCustomApplication).toHaveBeenCalledWith(body, {
      idempotencyKey: "create-app-request-1",
      actor: { type: "user", id: "admin-1" },
    });
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(reply.header).toHaveBeenCalledWith("Pragma", "no-cache");
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("lists templates, creates a template application and returns its repeatable guide", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const templates = [
      {
        reference: { id: "gitea", version: 1 },
        name: "Gitea",
        description: "X OIDC",
        supportedVersions: ["1.26"],
        form: { fields: [] },
      },
    ];
    const guide = { schemaVersion: 1, title: "Gitea 1.26 OIDC 接入说明", nodes: [] };
    const applicationService = {
      listApplicationTemplates: vi.fn().mockReturnValue(templates),
      previewApplicationTemplate: vi.fn().mockReturnValue({
        schemaVersion: 1,
        template: { id: "gitea", version: 1 },
      }),
      createTemplateApplication: vi.fn().mockResolvedValue({
        replayed: false,
        response: { application: { id: "app-1", source: { kind: "template" } } },
      }),
      getApplicationIntegrationGuide: vi.fn().mockResolvedValue(guide),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: createOidcClientLifecycle(),
    });
    const session = sessionStore!.createSession("admin-1");
    const listHandler = app.get.mock.calls.find(
      (call) => call[0] === "/admin/api/application-templates",
    )?.[1];
    const createHandler = app.post.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/from-template",
    )?.[1];
    const previewHandler = app.post.mock.calls.find(
      (call) => call[0] === "/admin/api/application-templates/preview",
    )?.[1];
    const guideHandler = app.get.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/:id/integration-guide",
    )?.[1];
    const readReply = { code: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };

    await expect(
      listHandler({ headers: adminCookieHeader(session.id) }, readReply),
    ).resolves.toEqual(templates);
    const body = {
      schemaVersion: 1,
      template: { id: "gitea", version: 1 },
      application: { name: "Gitea" },
      templateInput: { targetVersion: "1.26" },
    };
    const createReply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    const previewBody = {
      schemaVersion: 1,
      template: { id: "gitea", version: 1 },
      templateInput: { targetVersion: "1.26" },
    };
    await expect(
      previewHandler({ headers: adminMutationHeaders(session.id), body: previewBody }, createReply),
    ).resolves.toMatchObject({ template: { id: "gitea", version: 1 } });
    await createHandler(
      {
        headers: {
          ...adminMutationHeaders(session.id),
          "idempotency-key": "create-template-app-1",
        },
        body,
      },
      createReply,
    );
    await expect(
      guideHandler({ headers: adminCookieHeader(session.id), params: { id: "app-1" } }, readReply),
    ).resolves.toBe(guide);

    expect(applicationService.createTemplateApplication).toHaveBeenCalledWith(body, {
      idempotencyKey: "create-template-app-1",
      actor: { type: "user", id: "admin-1" },
    });
    expect(applicationService.previewApplicationTemplate).toHaveBeenCalledWith(previewBody);
    expect(applicationService.getApplicationIntegrationGuide).toHaveBeenCalledWith("app-1");
    expect(createReply.code).toHaveBeenCalledWith(201);
    expect(readReply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("strictly validates and rotates an application Client Secret with no-store headers", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const rotated = {
      schemaVersion: 1,
      application: { id: "app-1", version: 4 },
      credentialDelivery: {
        kind: "direct",
        credential: { kind: "client_secret", clientSecret: "one-time-rotated-secret" },
      },
    };
    const applicationService = {
      rotateApplicationSecret: vi.fn().mockResolvedValue(rotated),
    };
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: createOidcClientLifecycle(),
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/:id/rotate-secret",
    )?.[1];
    const reply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await expect(
      handler(
        {
          headers: adminMutationHeaders(session.id),
          params: { id: "app-1" },
          body: { schemaVersion: 1, expectedVersion: 3 },
        },
        reply,
      ),
    ).resolves.toBe(rotated);
    expect(applicationService.rotateApplicationSecret).toHaveBeenCalledWith("app-1", {
      expectedVersion: 3,
      actor: { type: "user", id: "admin-1" },
    });
    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(reply.header).toHaveBeenCalledWith("Pragma", "no-cache");

    const invalidReply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    await handler(
      {
        headers: adminMutationHeaders(session.id),
        params: { id: "app-1" },
        body: { schemaVersion: 1, expectedVersion: 4, clientSecret: "injected" },
      },
      invalidReply,
    );
    expect(invalidReply.code).toHaveBeenCalledWith(400);
    expect(applicationService.rotateApplicationSecret).toHaveBeenCalledTimes(1);
  });

  it("disables an application with optimistic version and revokes every client", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const disabling = {
      application: { id: "app-1", status: "disabling", version: 2 },
      clients: [{ clientId: "client-1" }, { clientId: "client-2" }],
      secrets: [],
    };
    const updated = {
      ...disabling,
      application: { id: "app-1", status: "disabled", version: 3 },
    };
    const applicationService = {
      getApplication: vi.fn().mockResolvedValue({
        application: { id: "app-1", status: "active", version: 1 },
        clients: disabling.clients,
        secrets: [],
      }),
      disableApplication: vi.fn().mockResolvedValue(disabling),
      completeDisableApplication: vi.fn().mockResolvedValue(updated),
    };
    const blockLeases = [
      { clientId: "client-1", commit: vi.fn(), release: vi.fn() },
      { clientId: "client-2", commit: vi.fn(), release: vi.fn() },
    ];
    const acquireOidcClientBlock = vi
      .fn()
      .mockReturnValueOnce(blockLeases[0])
      .mockReturnValueOnce(blockLeases[1]);
    const revokeOidcClient = vi.fn().mockResolvedValue(undefined);
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: {
        acquireBlock: acquireOidcClientBlock,
        revoke: revokeOidcClient,
        allow: vi.fn(),
      },
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/:id/disable",
    )?.[1];

    const result = await handler(
      {
        headers: adminMutationHeaders(session.id),
        params: { id: "app-1" },
        body: { expectedVersion: 1 },
      },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(applicationService.disableApplication).toHaveBeenCalledWith("app-1", {
      expectedVersion: 1,
      actor: { type: "user", id: "admin-1" },
    });
    expect(applicationService.completeDisableApplication).toHaveBeenCalledWith("app-1", {
      expectedVersion: 2,
      actor: { type: "user", id: "admin-1" },
    });
    expect(acquireOidcClientBlock.mock.calls).toEqual([["client-1"], ["client-2"]]);
    expect(acquireOidcClientBlock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      applicationService.disableApplication.mock.invocationCallOrder[0],
    );
    expect(blockLeases.every((lease) => lease.commit.mock.calls.length === 1)).toBe(true);
    expect(blockLeases.every((lease) => lease.release.mock.calls.length === 0)).toBe(true);
    expect(revokeOidcClient.mock.calls).toEqual([["client-1"], ["client-2"]]);
    expect(result).toBe(updated);
  });

  it("allows the same disable request to retry OIDC revocation after a transient failure", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const active = {
      application: { id: "app-1", status: "active", version: 1 },
      clients: [{ clientId: "client-1" }],
      secrets: [],
    };
    const disabling = {
      application: { ...active.application, status: "disabling", version: 2 },
      clients: active.clients,
      secrets: [],
    };
    const disabled = {
      ...disabling,
      application: { ...active.application, status: "disabled", version: 3 },
    };
    const applicationService = {
      getApplication: vi
        .fn()
        .mockResolvedValueOnce(active)
        .mockResolvedValueOnce(disabling)
        .mockResolvedValueOnce(disabled),
      disableApplication: vi.fn().mockResolvedValue(disabling),
      completeDisableApplication: vi.fn().mockResolvedValue(disabled),
    };
    const revokeOidcClient = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary storage failure"))
      .mockResolvedValueOnce(undefined);
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: {
        ...createOidcClientLifecycle(),
        revoke: revokeOidcClient,
      },
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/:id/disable",
    )?.[1];
    const request = {
      headers: adminMutationHeaders(session.id),
      params: { id: "app-1" },
      body: { expectedVersion: 1 },
    };
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

    await expect(handler(request, reply)).resolves.toBe(reply);
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: "Internal Server Error" });
    await expect(handler(request, reply)).resolves.toBe(disabled);
    await expect(handler(request, reply)).resolves.toBe(disabled);

    expect(applicationService.disableApplication).toHaveBeenCalledTimes(1);
    expect(applicationService.completeDisableApplication).toHaveBeenCalledTimes(1);
    expect(revokeOidcClient).toHaveBeenCalledTimes(3);
  });

  it("serializes concurrent disable requests for the same application", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const active = {
      application: { id: "app-1", status: "active", version: 1 },
      clients: [{ clientId: "client-1" }],
      secrets: [],
    };
    const disabling = {
      ...active,
      application: { ...active.application, status: "disabling", version: 2 },
    };
    const disabled = {
      ...active,
      application: { ...active.application, status: "disabled", version: 3 },
    };
    const applicationService = {
      getApplication: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(disabled),
      disableApplication: vi.fn().mockResolvedValue(disabling),
      completeDisableApplication: vi.fn().mockResolvedValue(disabled),
    };
    let finishFirstRevocation!: () => void;
    const firstRevocation = new Promise<void>((resolve) => {
      finishFirstRevocation = resolve;
    });
    const lifecycle = createOidcClientLifecycle();
    lifecycle.revoke.mockImplementationOnce(() => firstRevocation).mockResolvedValueOnce(undefined);
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: lifecycle,
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/:id/disable",
    )?.[1];
    const request = {
      headers: adminMutationHeaders(session.id),
      params: { id: "app-1" },
      body: { expectedVersion: 1 },
    };

    const first = handler(request, { code: vi.fn().mockReturnThis(), send: vi.fn() });
    await vi.waitFor(() => expect(lifecycle.revoke).toHaveBeenCalledTimes(1));
    const second = handler(request, { code: vi.fn().mockReturnThis(), send: vi.fn() });
    await Promise.resolve();
    expect(applicationService.getApplication).toHaveBeenCalledTimes(1);

    finishFirstRevocation();
    await expect(first).resolves.toBe(disabled);
    await expect(second).resolves.toBe(disabled);
    expect(applicationService.getApplication).toHaveBeenCalledTimes(2);
    expect(applicationService.disableApplication).toHaveBeenCalledTimes(1);
    expect(applicationService.completeDisableApplication).toHaveBeenCalledTimes(1);
    expect(lifecycle.allow).not.toHaveBeenCalled();
  });

  it("enables an application idempotently and always removes every Client barrier", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: createAdminGroups(), status: "active" };
    const disabled = {
      application: { id: "app-1", status: "disabled", version: 3 },
      clients: [{ clientId: "client-1" }, { clientId: "client-2" }],
    };
    const active = {
      ...disabled,
      application: { ...disabled.application, status: "active", version: 4 },
    };
    const applicationService = {
      getApplication: vi.fn().mockResolvedValueOnce(disabled).mockResolvedValueOnce(active),
      enableApplication: vi.fn().mockResolvedValue(active),
    };
    const allowOidcClient = vi.fn();
    const sessionStore = registerAdminRoutes({
      publicDir,
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["x-oidc-admins"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [createAdminClient()],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(admin) } as any,
      applicationService: applicationService as any,
      oidcClientLifecycle: {
        ...createOidcClientLifecycle(),
        allow: allowOidcClient,
      },
    });
    const session = sessionStore!.createSession("admin-1");
    const handler = app.post.mock.calls.find(
      (call) => call[0] === "/admin/api/applications/:id/enable",
    )?.[1];
    const request = {
      headers: adminMutationHeaders(session.id),
      params: { id: "app-1" },
      body: { expectedVersion: 3 },
    };
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

    await expect(handler(request, reply)).resolves.toBe(active);
    await expect(handler(request, reply)).resolves.toBe(active);

    expect(applicationService.enableApplication).toHaveBeenCalledTimes(1);
    expect(allowOidcClient.mock.calls).toEqual([
      ["client-1"],
      ["client-2"],
      ["client-1"],
      ["client-2"],
    ]);
  });
});
