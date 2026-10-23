import { safeParseIntegrationGuideV1 } from "@x-oidc/contracts";
import { describe, expect, it } from "vitest";
import {
  GITEA_CLIENT_ID_PLACEHOLDER,
  GITEA_CLIENT_SECRET_PLACEHOLDER,
  GiteaTemplateInputV2Schema,
  GiteaTemplateV2,
} from "../index.js";

const productionInput = {
  giteaBaseUrl: "https://git.example.com",
  authSourceName: "company-sso",
  targetVersion: "1.26",
  environment: "production",
} as const;

const context = {
  issuer: "https://id.example.com/oidc",
  claimScopes: {
    openid: ["sub"],
    profile: ["name", "email", "groups", "tenant"],
    email: ["email", "email_verified"],
    ssh: ["sshpubkey"],
  },
} as const;

const findCli = (
  nodes: ReturnType<typeof GiteaTemplateV2.resolve>["resolution"]["integrationGuide"]["nodes"],
) => {
  const node = nodes.find((candidate) => candidate.kind === "code");
  return node?.kind === "code" ? node.code : "";
};

describe("GiteaTemplateV2", () => {
  it("defaults operational switches while preserving the versioned v2 reference", () => {
    const result = GiteaTemplateV2.resolve(productionInput, context);

    expect(result.template).toEqual({ id: "gitea", version: 2 });
    expect(result.normalizedInput).toMatchObject({
      skipLocalTwoFactor: false,
      groupTeamMapRemoval: false,
      syncEnabled: true,
      active: true,
    });
    expect(result.resolution.target.configuration).toEqual({
      skipLocalTwoFactor: false,
      groupTeamMapRemoval: false,
      syncEnabled: true,
      active: true,
    });
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });

  it("generates every supported OAuth field and the matching Gitea CLI flags", () => {
    const result = GiteaTemplateV2.resolve(
      {
        ...productionInput,
        iconUrl: "https://git.example.com/assets/sso.svg",
        skipLocalTwoFactor: true,
        fullNameClaimName: "name",
        sshPublicKeyClaimName: "sshpubkey",
        requiredClaimName: "tenant",
        requiredClaimValue: "engineering",
        groupClaimName: "groups",
        adminGroup: "Default/Administrators",
        restrictedGroup: "Default/Restricted",
        groupTeamMap: '{"Default/Developers":{"engineering":["Reviewers","Developers"]}}',
        groupTeamMapRemoval: true,
        syncEnabled: true,
        active: true,
      },
      context,
    );
    const guide = result.resolution.integrationGuide;
    const cli = findCli(guide.nodes);
    const labels = guide.nodes
      .filter((node) => node.kind === "field")
      .map((node) => (node.kind === "field" ? node.label : ""));

    expect(safeParseIntegrationGuideV1(guide).success).toBe(true);
    expect(labels).toEqual(
      expect.arrayContaining([
        "认证类型",
        "认证名称",
        "OAuth2 提供程序",
        "客户端 ID",
        "客户端密钥",
        "图标 URL",
        "OpenID 连接自动发现 URL",
        "跳过本地两步验证",
        "附加授权范围（Scopes）",
        "全名声明名称",
        "SSH 公钥声明名称",
        "必须填写 Claim 声明的名称",
        "必须填写 Claim 声明的值",
        "用户组 Claim 声明名称",
        "管理员用户组 Claim 值",
        "受限用户组 Claim 值",
        "组到组织团队映射",
        "从已同步团队移除用户",
        "启用用户同步",
        "该认证源已经启用",
      ]),
    );
    expect(result.normalizedInput.groupTeamMap).toBe(
      '{"Default/Developers":{"engineering":["Developers","Reviewers"]}}',
    );
    expect(result.resolution.client.allowedScopes).toEqual(["openid", "profile", "email", "ssh"]);
    expect(cli).toContain("--icon-url 'https://git.example.com/assets/sso.svg'");
    expect(cli).toContain("--skip-local-2fa");
    expect(cli).toContain("--full-name-claim-name 'name'");
    expect(cli).toContain("--ssh-public-key-claim-name 'sshpubkey'");
    expect(cli).toContain("--required-claim-name 'tenant'");
    expect(cli).toContain("--required-claim-value 'engineering'");
    expect(cli).toContain("--group-claim-name 'groups'");
    expect(cli).toContain("--admin-group 'Default/Administrators'");
    expect(cli).toContain("--restricted-group 'Default/Restricted'");
    expect(cli).toContain("--group-team-map-removal");
    expect(cli).not.toContain(GITEA_CLIENT_ID_PLACEHOLDER);
    expect(cli).not.toContain(GITEA_CLIENT_SECRET_PLACEHOLDER);
    expect(guide.nodes).toContainEqual({
      kind: "field",
      label: "启用用户同步",
      value: "勾选",
    });
    expect(guide.nodes).toContainEqual({
      kind: "field",
      label: "附加授权范围（Scopes）",
      value: "openid,profile,email,ssh",
      copyable: true,
    });
    expect(guide.nodes).toContainEqual({
      kind: "field",
      label: "该认证源已经启用",
      value: "勾选",
    });
  });

  it("omits the unsafe CLI shortcut when the requested source must remain inactive", () => {
    const result = GiteaTemplateV2.resolve(
      { ...productionInput, active: false, syncEnabled: false },
      context,
    );

    expect(findCli(result.resolution.integrationGuide.nodes)).toBe("");
    expect(result.resolution.integrationGuide.nodes).toContainEqual(
      expect.objectContaining({
        kind: "warning",
        text: expect.stringContaining("直接创建启用状态"),
      }),
    );
  });

  it("supports 1.24 fields while enforcing the 1.25 claim capability boundary", () => {
    expect(
      GiteaTemplateInputV2Schema.safeParse({
        ...productionInput,
        targetVersion: "1.24",
        groupClaimName: "groups",
        adminGroup: "Default/Administrators",
      }).success,
    ).toBe(true);
    expect(
      GiteaTemplateInputV2Schema.safeParse({
        ...productionInput,
        targetVersion: "1.24",
        fullNameClaimName: "name",
      }).success,
    ).toBe(false);
    expect(
      GiteaTemplateInputV2Schema.safeParse({
        ...productionInput,
        targetVersion: "1.25",
        fullNameClaimName: "name",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["required claim without value", { ...productionInput, requiredClaimName: "tenant" }],
    ["admin group without group claim", { ...productionInput, adminGroup: "Admins" }],
    [
      "team removal without mapping",
      { ...productionInput, groupClaimName: "groups", groupTeamMapRemoval: true },
    ],
    [
      "invalid group map",
      { ...productionInput, groupClaimName: "groups", groupTeamMap: "not-json" },
    ],
    [
      "reserved group map key",
      {
        ...productionInput,
        groupClaimName: "groups",
        groupTeamMap: '{"__proto__":{"engineering":["Developers"]}}',
      },
    ],
    [
      "insecure production icon",
      { ...productionInput, iconUrl: "http://git.example.com/icon.svg" },
    ],
  ])("rejects %s", (_name, input) => {
    expect(GiteaTemplateInputV2Schema.safeParse(input).success).toBe(false);
  });

  it("rejects configured claims that the current deployment does not expose", () => {
    expect(() =>
      GiteaTemplateV2.resolve(
        { ...productionInput, requiredClaimName: "missing", requiredClaimValue: "yes" },
        context,
      ),
    ).toThrow();
  });

  it("shell-quotes configurable claim values", () => {
    const result = GiteaTemplateV2.resolve(
      {
        ...productionInput,
        requiredClaimName: "tenant",
        requiredClaimValue: "engineering'$(id)",
      },
      context,
    );
    const cli = findCli(result.resolution.integrationGuide.nodes);

    expect(cli).toContain(`--required-claim-value 'engineering'"'"'$(id)'`);
    expect(cli).not.toContain("engineering'$(id)\n");
  });
});
