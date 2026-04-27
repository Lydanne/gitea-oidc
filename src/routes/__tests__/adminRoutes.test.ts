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
});
