import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryProviderTokenRepository } from "../../repositories/MemoryProviderTokenRepository";
import type { ProviderApiClient } from "../../types/providerApi";
import { ProviderApiService } from "../ProviderApiService";

describe("ProviderApiService", () => {
  let requestMock: ReturnType<typeof vi.fn>;
  let service: ProviderApiService;

  beforeEach(() => {
    requestMock = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });
    service = new ProviderApiService({
      adminGroups: ["Owners"],
      tokenRepository: new MemoryProviderTokenRepository(),
    });
    service.registerClient({
      provider: "feishu",
      baseUrl: "https://open.feishu.cn/open-apis",
      request: requestMock,
      getUserToken: vi.fn(),
      getAppToken: vi.fn(),
      refreshUserToken: vi.fn(),
      probeToken: vi.fn(),
    } as ProviderApiClient);
  });

  it("allows users to call their own user-token request", async () => {
    await service.request(
      "feishu",
      { method: "GET", path: "/authen/v1/user_info", tokenKind: "user" },
      { userId: "user-1", groups: [] },
    );

    expect(requestMock).toHaveBeenCalled();
  });

  it("requires admin permission for app-token requests", async () => {
    await expect(
      service.request(
        "feishu",
        { method: "GET", path: "/contact/v3/users", tokenKind: "app" },
        { userId: "user-1", groups: [] },
      ),
    ).rejects.toThrow(/admin/);
  });

  it("allows Owners group to call app-token requests", async () => {
    await service.request(
      "feishu",
      { method: "GET", path: "/contact/v3/users", tokenKind: "app" },
      { userId: "user-1", groups: ["Owners"] },
    );

    expect(requestMock).toHaveBeenCalled();
  });

  it("requires admin permission for cross-user requests", async () => {
    await expect(
      service.request(
        "feishu",
        { method: "GET", path: "/authen/v1/user_info", tokenKind: "user", ownerId: "user-2" },
        { userId: "user-1", groups: [] },
      ),
    ).rejects.toThrow(/admin/);
  });
});
