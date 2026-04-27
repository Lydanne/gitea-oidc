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
      allowedOperations: ["authen.user_info"],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
  });

  it("rejects disallowed operations before sending requests", async () => {
    await expect(
      client.request(
        { method: "GET", path: "/authen/v1/user_info", tokenKind: "user", operation: "bad" },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/not allowed/);
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
    ).rejects.toThrow(/relative/);
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
    ).rejects.toThrow(/base URL/);
  });
});
