import type { ApplicationTemplateSummaryV1 } from "@x-oidc/contracts";
import { describe, expect, it } from "vitest";
import type { ApplicationForm, TemplateApplicationForm } from "../../types/admin";
import {
  buildCustomApplicationRequest,
  buildTemplateApplicationRequest,
  toSafePortalLaunchUrl,
} from "../applicationForm";

const createForm = (overrides: Partial<ApplicationForm> = {}): ApplicationForm => ({
  name: "开发工具",
  slug: "developer-tool",
  environment: "development",
  clientType: "confidential",
  redirectUris: "http://127.0.0.2:3000/callback",
  postLogoutRedirectUris: "http://127.0.0.2:3000/",
  scopes: "openid profile email",
  refreshToken: false,
  portal: { enabled: false, launchUrl: "", iconUrl: "", order: 0 },
  ...overrides,
});

const template: ApplicationTemplateSummaryV1 = {
  reference: { id: "gitea", version: 1 },
  name: "Gitea",
  description: "Gitea OpenID Connect 接入模板",
  supportedVersions: ["1.27"],
  form: {
    fields: [
      {
        name: "baseUrl",
        label: "Gitea 地址",
        kind: "url",
        required: true,
      },
    ],
  },
};

const createTemplateForm = (
  overrides: Partial<TemplateApplicationForm> = {},
): TemplateApplicationForm => ({
  name: "研发 Gitea",
  slug: "engineering-gitea",
  templateKey: "gitea@1",
  templateInput: { baseUrl: "https://git.example.com" },
  portal: { enabled: false, launchUrl: "", iconUrl: "", order: 0 },
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

  it("仅在启用时写入用户门户配置", () => {
    expect(buildCustomApplicationRequest(createForm()).application.portal).toBeUndefined();

    const request = buildCustomApplicationRequest(
      createForm({
        portal: {
          enabled: true,
          launchUrl: "  http://127.0.0.1:3000/?from=portal  ",
          iconUrl: "  http://127.0.0.1:3000/icon.png  ",
          order: 20,
        },
      }),
    );

    expect(request.application.portal).toEqual({
      enabled: true,
      launchUrl: "http://127.0.0.1:3000/?from=portal",
      iconUrl: "http://127.0.0.1:3000/icon.png",
      order: 20,
    });
  });

  it("门户启用时要求入口 URL 和有效排序值", () => {
    expect(() =>
      buildCustomApplicationRequest(
        createForm({ portal: { enabled: true, launchUrl: "", iconUrl: "", order: 0 } }),
      ),
    ).toThrow("门户入口 URL 不能为空");
    expect(() =>
      buildCustomApplicationRequest(
        createForm({
          portal: {
            enabled: true,
            launchUrl: "http://127.0.0.1:3000/",
            iconUrl: "",
            order: 1.5,
          },
        }),
      ),
    ).toThrow("门户排序值");
  });

  it("在模板创建请求中写入用户门户配置", () => {
    const request = buildTemplateApplicationRequest(
      createTemplateForm({
        portal: {
          enabled: true,
          launchUrl: "https://git.example.com/",
          iconUrl: "",
          order: 10,
        },
      }),
      template,
    );

    expect(request.application.portal).toEqual({
      enabled: true,
      launchUrl: "https://git.example.com/",
      order: 10,
    });
  });

  it("为门户入口链接拒绝非 HTTP(S)、凭据和 fragment", () => {
    expect(toSafePortalLaunchUrl("https://app.example.com/path?from=admin")).toBe(
      "https://app.example.com/path?from=admin",
    );
    expect(toSafePortalLaunchUrl("javascript:alert(1)")).toBeNull();
    expect(toSafePortalLaunchUrl("https://user:pass@app.example.com/")).toBeNull();
    expect(toSafePortalLaunchUrl("https://app.example.com/#private")).toBeNull();
    expect(toSafePortalLaunchUrl("http://app.example.com/", "development")).toBeNull();
    expect(toSafePortalLaunchUrl("http://127.0.0.2:3000/", "development")).toBe(
      "http://127.0.0.2:3000/",
    );
  });
});
