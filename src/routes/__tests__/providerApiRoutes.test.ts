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

  const createOidcProvider = ({
    token = {},
    grant = {},
    client = { clientId: "trusted-bff" },
  }: {
    token?: Record<string, unknown>;
    grant?: Record<string, unknown> | null;
    client?: Record<string, unknown> | null;
  } = {}) =>
    ({
      AccessToken: {
        find: vi.fn().mockResolvedValue({
          accountId: "user-1",
          clientId: "trusted-bff",
          grantId: "grant-1",
          scope: "openid provider_api",
          ...token,
        }),
      },
      Client: {
        find: vi.fn().mockResolvedValue(client),
      },
      Grant: {
        find: vi.fn().mockResolvedValue(
          grant === null
            ? null
            : {
                accountId: "user-1",
                clientId: "trusted-bff",
                isExpired: false,
                ...grant,
              },
        ),
      },
    }) as any;

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

  it("rejects disabled users even when the bearer token is valid", async () => {
    const app = createApp();
    const providerApiService = { request: vi.fn() };
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: createOidcProvider(),
      userRepository: {
        findById: vi.fn().mockResolvedValue({
          sub: "user-1",
          status: "disabled",
        }),
      } as any,
      providerApiService: providerApiService as any,
      sdkProxy: true,
    });
    const handler = app.post.mock.calls[0][1];
    const reply = createReply();

    await handler(
      { headers: { authorization: "Bearer oidc-token" }, params: { provider: "feishu" }, body: {} },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(providerApiService.request).not.toHaveBeenCalled();
  });

  it("rejects bearer tokens issued to clients outside the Provider API allowlist", async () => {
    const app = createApp();
    const providerApiService = { request: vi.fn() };
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: createOidcProvider({
        token: { clientId: "spa" },
        grant: { clientId: "spa" },
        client: { clientId: "spa" },
      }),
      userRepository: {
        findById: vi.fn().mockResolvedValue({
          sub: "user-1",
          groups: [],
          status: "active",
        }),
      } as any,
      providerApiService: providerApiService as any,
      sdkProxy: true,
      allowedClientIds: ["trusted-bff"],
    });
    const handler = app.post.mock.calls[0][1];
    const reply = createReply();

    await handler(
      {
        headers: { authorization: "Bearer oidc-token" },
        params: { provider: "feishu" },
        body: { tokenKind: "user", operation: "authen.user_info" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Forbidden" });
    expect(providerApiService.request).not.toHaveBeenCalled();
  });

  it("rejects bearer tokens without the Provider API scope", async () => {
    const app = createApp();
    const providerApiService = { request: vi.fn() };
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: createOidcProvider({ token: { scope: "openid profile" } }),
      userRepository: {
        findById: vi.fn().mockResolvedValue({
          sub: "user-1",
          groups: [],
          status: "active",
        }),
      } as any,
      providerApiService: providerApiService as any,
      sdkProxy: true,
      allowedClientIds: ["trusted-bff"],
    });
    const handler = app.post.mock.calls[0][1];
    const reply = createReply();

    await handler(
      {
        headers: { authorization: "Bearer oidc-token" },
        params: { provider: "feishu" },
        body: { tokenKind: "user", operation: "authen.user_info" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Forbidden" });
    expect(providerApiService.request).not.toHaveBeenCalled();
  });

  it("forwards authorized requests to ProviderApiService", async () => {
    const app = createApp();
    const providerApiService = {
      request: vi.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } }),
    };
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: createOidcProvider(),
      userRepository: {
        findById: vi.fn().mockResolvedValue({
          sub: "user-1",
          groups: ["gitea-oidc-admins"],
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
        body: {
          method: "GET",
          path: "/authen/v1/user_info",
          tokenKind: "user",
          operation: "authen.user_info",
        },
      },
      createReply(),
    );

    expect(result).toEqual({ status: 200, headers: {}, data: { ok: true } });
    expect(providerApiService.request).toHaveBeenCalledWith(
      "feishu",
      expect.objectContaining({ operation: "authen.user_info", path: "/authen/v1/user_info" }),
      { userId: "user-1", groups: ["gitea-oidc-admins"], roles: ["admin"] },
    );
  });

  it("rejects bearer tokens whose OIDC client no longer exists", async () => {
    const app = createApp();
    const providerApiService = { request: vi.fn() };
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: createOidcProvider({ client: null }),
      userRepository: {
        findById: vi.fn().mockResolvedValue({
          sub: "user-1",
          groups: [],
          status: "active",
        }),
      } as any,
      providerApiService: providerApiService as any,
      sdkProxy: true,
    });
    const handler = app.post.mock.calls[0][1];
    const reply = createReply();

    await handler(
      {
        headers: { authorization: "Bearer oidc-token" },
        params: { provider: "feishu" },
        body: { tokenKind: "user", operation: "authen.user_info" },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(providerApiService.request).not.toHaveBeenCalled();
  });

  it("rejects bearer tokens whose OIDC grant is missing, expired, or mismatched", async () => {
    for (const oidcProvider of [
      createOidcProvider({ grant: null }),
      createOidcProvider({ grant: { isExpired: true } }),
      createOidcProvider({ grant: { accountId: "user-2" } }),
      createOidcProvider({ grant: { clientId: "other-client" } }),
    ]) {
      const app = createApp();
      const providerApiService = { request: vi.fn() };
      registerProviderApiRoutes({
        app: app as any,
        oidcProvider,
        userRepository: {
          findById: vi.fn().mockResolvedValue({
            sub: "user-1",
            groups: [],
            status: "active",
          }),
        } as any,
        providerApiService: providerApiService as any,
        sdkProxy: true,
      });
      const handler = app.post.mock.calls[0][1];
      const reply = createReply();

      await handler(
        {
          headers: { authorization: "Bearer oidc-token" },
          params: { provider: "feishu" },
          body: { tokenKind: "user", operation: "authen.user_info" },
        },
        reply,
      );

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(providerApiService.request).not.toHaveBeenCalled();
    }
  });

  it("redacts token-like values from Provider API error responses", async () => {
    const app = createApp();
    const providerApiService = {
      request: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "failed with Authorization: Bearer provider-token refresh_token=provider-refresh",
          ),
        ),
    };
    registerProviderApiRoutes({
      app: app as any,
      oidcProvider: createOidcProvider(),
      userRepository: {
        findById: vi.fn().mockResolvedValue({ sub: "user-1", status: "active" }),
      } as any,
      providerApiService: providerApiService as any,
      sdkProxy: true,
    });
    const handler = app.post.mock.calls[0][1];
    const reply = createReply();

    await handler(
      { headers: { authorization: "Bearer oidc-token" }, params: { provider: "feishu" }, body: {} },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(JSON.stringify(reply.payload)).toContain("[REDACTED]");
    expect(JSON.stringify(reply.payload)).not.toContain("provider-token");
    expect(JSON.stringify(reply.payload)).not.toContain("provider-refresh");
  });
});
