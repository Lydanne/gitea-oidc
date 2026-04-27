import { describe, expect, it, vi } from "vitest";
import { registerAdminRoutes } from "../adminRoutes";

describe("registerAdminRoutes", () => {
  const createApp = () => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  });

  it("allows Owners users to call /admin/api/me with bearer token", async () => {
    const app = createApp();
    const user = { sub: "user-1", groups: ["Owners"], status: "active" };
    registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["Owners"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [{ client_id: "gitea", client_secret: "secret" }],
      } as any,
      oidcProvider: {
        AccessToken: { find: vi.fn().mockResolvedValue({ accountId: "user-1" }) },
      } as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: { findById: vi.fn().mockResolvedValue(user), list: vi.fn() } as any,
    });

    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/api/me")?.[1];
    const result = await handler(
      { headers: { authorization: "Bearer oidc-token" } },
      { code: vi.fn().mockReturnThis(), send: vi.fn() },
    );

    expect(result).toEqual({ user, admin: true });
  });

  it("builds admin login authorization URL from the configured OIDC issuer", async () => {
    const app = createApp();
    registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["Owners"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [{ client_id: "gitea", client_secret: "secret" }],
      } as any,
      oidcProvider: {} as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: {} as any,
    });
    const handler = app.get.mock.calls.find((call) => call[0] === "/admin/login")?.[1];
    const reply = { redirect: vi.fn() };

    await handler({}, reply);

    const redirectUrl = new URL(reply.redirect.mock.calls[0][0]);
    expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe("http://localhost:3000/oidc/auth");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/admin/callback",
    );
  });

  it("wires user create, update and delete APIs behind admin guard", async () => {
    const app = createApp();
    const admin = { sub: "admin-1", groups: ["Owners"], status: "active" };
    const created = {
      sub: "user-1",
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
    registerAdminRoutes({
      app: app as any,
      config: {
        admin: {
          enabled: true,
          basePath: "/admin",
          allowedGroups: ["Owners"],
          sessionTtlSeconds: 3600,
        },
        server: { url: "http://localhost:3000" },
        oidc: { issuer: "http://localhost:3000/oidc" },
        clients: [{ client_id: "gitea", client_secret: "secret" }],
      } as any,
      oidcProvider: {
        AccessToken: { find: vi.fn().mockResolvedValue({ accountId: "admin-1" }) },
      } as any,
      authCoordinator: { getProviders: vi.fn().mockReturnValue([]) } as any,
      userRepository: userRepository as any,
    });

    const postHandler = app.post.mock.calls.find((call) => call[0] === "/admin/api/users")?.[1];
    const patchHandler = app.patch.mock.calls.find(
      (call) => call[0] === "/admin/api/users/:sub",
    )?.[1];
    const deleteHandler = app.delete.mock.calls.find(
      (call) => call[0] === "/admin/api/users/:sub",
    )?.[1];
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await postHandler({ headers: { authorization: "Bearer token" }, body: created }, reply);
    await patchHandler(
      {
        headers: { authorization: "Bearer token" },
        params: { sub: "user-1" },
        body: { status: "disabled" },
      },
      reply,
    );
    await deleteHandler(
      { headers: { authorization: "Bearer token" }, params: { sub: "user-1" } },
      reply,
    );

    expect(userRepository.create).toHaveBeenCalledWith(created);
    expect(userRepository.update).toHaveBeenCalledWith("user-1", { status: "disabled" });
    expect(userRepository.delete).toHaveBeenCalledWith("user-1");
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.code).toHaveBeenCalledWith(204);
  });
});
