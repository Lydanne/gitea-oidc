import { describe, expect, it } from "vitest";
import type { ApplicationForm } from "../../types/admin";
import { buildCustomApplicationRequest } from "../applicationForm";

const createForm = (overrides: Partial<ApplicationForm> = {}): ApplicationForm => ({
  name: "开发工具",
  slug: "developer-tool",
  environment: "development",
  clientType: "confidential",
  redirectUris: "http://127.0.0.2:3000/callback",
  postLogoutRedirectUris: "http://127.0.0.2:3000/",
  scopes: "openid profile email",
  refreshToken: false,
  ...overrides,
});

describe("application form", () => {
  it("复用共享 contract 接受完整 IPv4 loopback 网段", () => {
    const request = buildCustomApplicationRequest(createForm());

    expect(request.client.redirectUris).toEqual(["http://127.0.0.2:3000/callback"]);
    expect(request.client.postLogoutRedirectUris).toEqual(["http://127.0.0.2:3000/"]);
  });

  it("同时拒绝登录回调和登出回跳中的非 loopback HTTP 地址", () => {
    expect(() =>
      buildCustomApplicationRequest(
        createForm({ redirectUris: "http://app.example.com/callback" }),
      ),
    ).toThrow("HTTP redirect URI 仅允许 loopback 地址");
    expect(() =>
      buildCustomApplicationRequest(
        createForm({ postLogoutRedirectUris: "http://app.example.com/" }),
      ),
    ).toThrow("HTTP redirect URI 仅允许 loopback 地址");
  });

  it("规范化列表并为 Refresh Token 自动添加 offline_access", () => {
    const request = buildCustomApplicationRequest(
      createForm({
        redirectUris: "http://localhost:3000/callback, http://localhost:3000/callback",
        postLogoutRedirectUris: "",
        scopes: "openid,profile",
        refreshToken: true,
      }),
    );

    expect(request.client.redirectUris).toEqual(["http://localhost:3000/callback"]);
    expect(request.client.postLogoutRedirectUris).toEqual([]);
    expect(request.client.scopes).toEqual(["openid", "profile", "offline_access"]);
  });
});
