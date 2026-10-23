import { describe, expect, it, vi } from "vitest";
import { ApplicationClientAdapter } from "../ApplicationClientAdapter.js";

describe("ApplicationClientAdapter", () => {
  it("只向 oidc-provider 返回协议元数据和 PKCE 策略", async () => {
    const source = {
      findByClientId: vi.fn().mockResolvedValue({
        client_id: "app_client_1",
        client_secret: "one-time-secret",
        client_name: "内部工单",
        token_endpoint_auth_method: "client_secret_basic",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        redirect_uris: ["https://app.example.com/callback"],
        post_logout_redirect_uris: ["https://app.example.com/"],
        scope: "openid profile offline_access",
        pkce_policy: "required",
        application_id: "must-not-project",
        capabilities: { providerApi: false },
      }),
    };
    const adapter = new ApplicationClientAdapter(source);

    await expect(adapter.find("app_client_1")).resolves.toEqual({
      client_id: "app_client_1",
      client_secret: "one-time-secret",
      client_name: "内部工单",
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: ["https://app.example.com/callback"],
      post_logout_redirect_uris: ["https://app.example.com/"],
      scope: "openid profile offline_access",
      require_pkce: true,
    });
    expect(source.findByClientId).toHaveBeenCalledWith("app_client_1");
  });

  it("返回 undefined 且拒绝绕过应用域写入 Client", async () => {
    const adapter = new ApplicationClientAdapter({
      findByClientId: vi.fn().mockResolvedValue(undefined),
    });

    await expect(adapter.find("missing")).resolves.toBeUndefined();
    await expect(adapter.findByUid("uid")).resolves.toBeUndefined();
    await expect(adapter.findByUserCode("code")).resolves.toBeUndefined();
    await expect(adapter.upsert("id", {})).rejects.toThrow(/ApplicationService/);
    await expect(adapter.destroy("id")).rejects.toThrow(/ApplicationService/);
  });
});
