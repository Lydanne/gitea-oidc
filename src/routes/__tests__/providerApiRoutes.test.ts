import { describe, expect, it, vi } from "vitest";
import { registerProviderApiRoutes } from "../providerApiRoutes";

describe("registerProviderApiRoutes", () => {
  const createApp = () => ({
    post: vi.fn(),
  });

  const createReply = () => ({
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn(function (this: any, status: number) {
      this.statusCode = status;
      return this;
    }),
    send: vi.fn(function (this: any, payload: unknown) {
      this.payload = payload;
      return payload;
    }),
  });

  it("does not register proxy route when sdkProxy is disabled", () => {
    const app = createApp();

    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: {} as any,
      userRepository: {} as any,
      providerApiService: {} as any,
      sdkProxy: false,
    });

    expect(app.post).not.toHaveBeenCalled();
  });

  it("requires a valid OIDC bearer token", async () => {
    const app = createApp();
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: { AccessToken: { find: vi.fn() } } as any,
      userRepository: { findById: vi.fn() } as any,
      providerApiService: { request: vi.fn() } as any,
      sdkProxy: true,
    });
    const handler = app.post.mock.calls[0][1];
    const reply = createReply();

    await handler({ headers: {}, params: { provider: "feishu" }, body: {} }, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("forwards authorized requests to ProviderApiService", async () => {
    const app = createApp();
    const providerApiService = {
      request: vi.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } }),
    };
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: {
        AccessToken: { find: vi.fn().mockResolvedValue({ accountId: "user-1" }) },
      } as any,
      userRepository: {
        findById: vi.fn().mockResolvedValue({
          sub: "user-1",
          groups: ["Owners"],
          roles: ["admin"],
          status: "active",
        }),
      } as any,
      providerApiService: providerApiService as any,
      sdkProxy: true,
    });
    const handler = app.post.mock.calls[0][1];

    const result = await handler(
      {
        headers: { authorization: "Bearer oidc-token" },
        params: { provider: "feishu" },
        body: { method: "GET", path: "/authen/v1/user_info", tokenKind: "user" },
      },
      createReply(),
    );

    expect(result).toEqual({ status: 200, headers: {}, data: { ok: true } });
    expect(providerApiService.request).toHaveBeenCalledWith(
      "feishu",
      expect.objectContaining({ path: "/authen/v1/user_info" }),
      { userId: "user-1", groups: ["Owners"], roles: ["admin"] },
    );
  });
});
