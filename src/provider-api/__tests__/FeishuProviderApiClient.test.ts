import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryProviderTokenRepository } from "../../repositories/MemoryProviderTokenRepository";
import { FeishuProviderApiClient } from "../FeishuProviderApiClient";

describe("FeishuProviderApiClient", () => {
  const fetchMock = vi.fn();
  let repository: MemoryProviderTokenRepository;
  let client: FeishuProviderApiClient;

  beforeEach(() => {
    repository = new MemoryProviderTokenRepository();
    vi.stubGlobal("fetch", fetchMock);
    client = new FeishuProviderApiClient({
      config: {
        appId: "cli-test",
        appSecret: "secret",
        redirectUri: "http://localhost/callback",
      },
      tokenRepository: repository,
      baseUrl: "https://open.feishu.cn/open-apis",
      refreshSkewSeconds: 300,
      requestTimeoutMs: 10000,
      allowedOperations: ["authen.user_info"],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const createJsonResponse = (data: unknown) => ({
    ok: true,
    status: 200,
    headers: new Map([["content-type", "application/json"]]),
    json: vi.fn().mockResolvedValue(data),
  });

  it("refreshes an expiring user token lazily", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: new Date(Date.now() + 10_000),
      status: "valid",
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          code: 0,
          app_access_token: "app-token",
          expire: 7200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          code: 0,
          data: {
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 7200,
            token_type: "Bearer",
          },
        }),
      });

    const token = await client.getUserToken("user-1");

    expect(token?.accessToken).toBe("new-access");
    expect(token?.refreshToken).toBe("new-refresh");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/authen/v1/refresh_access_token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not reuse or reissue locally revoked app tokens", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "revoked-app-access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "revoked",
    });

    const token = await client.getAppToken();

    expect(token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized app token responses without storing provider tokens", async () => {
    const limitedClient = new FeishuProviderApiClient({
      config: {
        appId: "cli-test",
        appSecret: "secret",
        redirectUri: "http://localhost/callback",
      },
      tokenRepository: repository,
      baseUrl: "https://open.feishu.cn/open-apis",
      refreshSkewSeconds: 300,
      requestTimeoutMs: 10000,
      responseBodyLimitBytes: 64,
      allowedOperations: ["authen.user_info"],
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, app_access_token: "x".repeat(100), expire: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(limitedClient.getAppToken()).rejects.toThrow(/response body is too large/);
    await expect(repository.find("feishu", "app", "default")).resolves.toBeNull();
  });

  it("does not mark locally revoked app tokens valid during probe", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "revoked-app-access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "revoked",
    });

    const status = await client.probeToken({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "revoked-app-access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "revoked",
    });
    const stored = await repository.find("feishu", "app", "default");

    expect(status).toBe("revoked");
    expect(stored?.status).toBe("revoked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects disallowed operations before sending requests", async () => {
    await expect(
      client.request({ tokenKind: "user", operation: "bad" }, { userId: "user-1" }),
    ).rejects.toThrow(/not allowed/);
  });

  it("rejects user token requests for app-token-only operations", async () => {
    const contactClient = new FeishuProviderApiClient({
      config: {
        appId: "cli-test",
        appSecret: "secret",
        redirectUri: "http://localhost/callback",
      },
      tokenRepository: repository,
      baseUrl: "https://open.feishu.cn/open-apis",
      refreshSkewSeconds: 300,
      requestTimeoutMs: 10000,
      allowedOperations: ["contact.user.get"],
    });

    await expect(
      contactClient.request(
        {
          tokenKind: "user",
          operation: "contact.user.get",
          pathParams: { user_id: "ou_1" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/does not allow user token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds the real request from the server-side operation definition", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });
    fetchMock.mockResolvedValue(createJsonResponse({ ok: true }));

    await client.request(
      { tokenKind: "user", operation: "authen.user_info" },
      { userId: "user-1" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/authen/v1/user_info",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer access" }),
      }),
    );
  });

  it("rejects a whitelisted operation when the caller supplies a different path", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });

    await expect(
      client.request(
        {
          method: "GET",
          path: "/contact/v3/users/ou_1",
          tokenKind: "user",
          operation: "authen.user_info",
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/path does not match/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders operation path parameters server-side", async () => {
    const contactClient = new FeishuProviderApiClient({
      config: {
        appId: "cli-test",
        appSecret: "secret",
        redirectUri: "http://localhost/callback",
      },
      tokenRepository: repository,
      baseUrl: "https://open.feishu.cn/open-apis",
      refreshSkewSeconds: 300,
      requestTimeoutMs: 10000,
      allowedOperations: ["contact.user.get"],
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });
    fetchMock.mockResolvedValue(createJsonResponse({ ok: true }));

    await contactClient.request(
      {
        tokenKind: "app",
        operation: "contact.user.get",
        pathParams: { user_id: "ou_1" },
      },
      { userId: "user-1" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/contact/v3/users/ou_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("allows only operation-defined query parameters", async () => {
    const contactClient = new FeishuProviderApiClient({
      config: {
        appId: "cli-test",
        appSecret: "secret",
        redirectUri: "http://localhost/callback",
      },
      tokenRepository: repository,
      baseUrl: "https://open.feishu.cn/open-apis",
      refreshSkewSeconds: 300,
      requestTimeoutMs: 10000,
      allowedOperations: ["contact.user.get"],
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });
    fetchMock.mockResolvedValue(createJsonResponse({ ok: true }));

    await contactClient.request(
      {
        tokenKind: "app",
        operation: "contact.user.get",
        pathParams: { user_id: "ou_1" },
        query: { user_id_type: "open_id", department_id_type: "open_department_id" },
      },
      { userId: "user-1" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/contact/v3/users/ou_1?user_id_type=open_id&department_id_type=open_department_id",
      expect.objectContaining({ method: "GET" }),
    );

    await expect(
      contactClient.request(
        {
          tokenKind: "app",
          operation: "contact.user.get",
          pathParams: { user_id: "ou_1" },
          query: { page_token: "unexpected" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/does not allow query parameter/);
  });

  it("rejects caller-supplied request headers", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "authen.user_info",
          headers: { Authorization: "Bearer injected", "X-Forwarded-Host": "evil.example" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/request header is reserved|does not allow request header/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-scalar path and query parameters", async () => {
    const contactClient = new FeishuProviderApiClient({
      config: {
        appId: "cli-test",
        appSecret: "secret",
        redirectUri: "http://localhost/callback",
      },
      tokenRepository: repository,
      baseUrl: "https://open.feishu.cn/open-apis",
      refreshSkewSeconds: 300,
      requestTimeoutMs: 10000,
      allowedOperations: ["contact.user.get"],
    });
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });

    await expect(
      contactClient.request(
        {
          tokenKind: "app",
          operation: "contact.user.get",
          pathParams: { user_id: { nested: true } as any },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/path parameter must be a scalar/);

    await expect(
      contactClient.request(
        {
          tokenKind: "app",
          operation: "contact.user.get",
          pathParams: { user_id: "ou_1" },
          query: { user_id_type: ["open_id"] as any },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/query parameter must be a scalar/);
  });

  it("rejects absolute request URLs", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });

    await expect(
      client.request(
        {
          method: "GET",
          path: "https://example.com/evil",
          tokenKind: "user",
          operation: "authen.user_info",
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/path does not match/);
  });

  it("rejects paths that escape the provider base URL", async () => {
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    });

    await expect(
      client.request(
        {
          method: "GET",
          path: "../authen/v1/user_info",
          tokenKind: "user",
          operation: "authen.user_info",
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/path does not match/);
  });
});
