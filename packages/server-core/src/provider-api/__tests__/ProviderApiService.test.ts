import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryProviderTokenRepository } from "../../repositories/MemoryProviderTokenRepository.js";
import type { ProviderApiClient } from "../../types/providerApi.js";
import { ProviderApiService } from "../ProviderApiService.js";

describe("ProviderApiService", () => {
  let requestMock: ReturnType<typeof vi.fn>;
  let probeMock: ReturnType<typeof vi.fn>;
  let tokenRepository: MemoryProviderTokenRepository;
  let service: ProviderApiService;

  beforeEach(() => {
    requestMock = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });
    probeMock = vi.fn().mockResolvedValue("valid");
    tokenRepository = new MemoryProviderTokenRepository();
    service = new ProviderApiService({
      adminGroups: ["x-oidc-admins"],
      tokenRepository,
    });
    service.registerClient({
      provider: "feishu",
      baseUrl: "https://open.feishu.cn/open-apis",
      request: requestMock,
      getUserToken: vi.fn(),
      getAppToken: vi.fn(),
      refreshUserToken: vi.fn(),
      probeToken: probeMock,
    } as ProviderApiClient);
  });

  it("allows users to call their own user-token request", async () => {
    await service.request(
      "feishu",
      {
        method: "GET",
        path: "/authen/v1/user_info",
        tokenKind: "user",
        operation: "authen.user_info",
      },
      { userId: "user-1", groups: [] },
    );

    expect(requestMock).toHaveBeenCalled();
  });

  it("requires admin permission for app-token requests", async () => {
    await expect(
      service.request(
        "feishu",
        {
          method: "GET",
          path: "/contact/v3/users",
          tokenKind: "app",
          operation: "contact.user.get",
        },
        { userId: "user-1", groups: [] },
      ),
    ).rejects.toThrow(/admin/);
  });

  it("allows configured admin group to call app-token requests", async () => {
    await service.request(
      "feishu",
      { method: "GET", path: "/contact/v3/users", tokenKind: "app", operation: "contact.user.get" },
      { userId: "user-1", groups: ["x-oidc-admins"] },
    );

    expect(requestMock).toHaveBeenCalled();
  });

  it("requires admin permission for cross-user requests", async () => {
    await expect(
      service.request(
        "feishu",
        {
          method: "GET",
          path: "/authen/v1/user_info",
          tokenKind: "user",
          ownerId: "user-2",
          operation: "authen.user_info",
        },
        { userId: "user-1", groups: [] },
      ),
    ).rejects.toThrow(/admin/);
  });

  it("rejects invalid request bodies before calling the provider client", async () => {
    await expect(
      service.request("feishu", undefined as any, { userId: "user-1", groups: [] }),
    ).rejects.toThrow(/body must be an object/);

    await expect(
      service.request(
        "feishu",
        { tokenKind: "user", operation: "" },
        { userId: "user-1", groups: [] },
      ),
    ).rejects.toThrow(/operation is required/);

    await expect(
      service.request(
        "feishu",
        { tokenKind: "tenant" as any, operation: "authen.user_info" },
        { userId: "user-1", groups: [] },
      ),
    ).rejects.toThrow(/tokenKind must be user or app/);

    await expect(
      service.request(
        "feishu",
        {
          tokenKind: "user",
          operation: "authen.user_info",
          query: "user_id_type=open_id" as any,
        },
        { userId: "user-1", groups: [] },
      ),
    ).rejects.toThrow(/query must be an object/);

    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not probe locally revoked provider tokens", async () => {
    await tokenRepository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "revoked-app-token",
      status: "revoked",
    });

    await expect(service.probeToken("feishu", "app", "default")).resolves.toBe("revoked");

    expect(probeMock).not.toHaveBeenCalled();
  });
});
