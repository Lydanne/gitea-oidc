import { safeParseIntegrationGuideV1 } from "@gitea-oidc/contracts";
import { describe, expect, it } from "vitest";
import {
  GITEA_TEMPLATE_V3_FORM,
  GiteaTemplateInputV2Schema,
  GiteaTemplateInputV3Schema,
  GiteaTemplateV3,
} from "../index.js";

const productionInput = {
  giteaBaseUrl: "https://git.example.com",
  authSourceName: "company-sso",
  targetVersion: "1.27",
  environment: "production",
} as const;

const context = {
  issuer: "https://id.example.com/oidc",
  claimScopes: {
    openid: ["sub"],
    profile: ["name", "email", "groups"],
    email: ["email", "email_verified"],
    identity: ["employee_id"],
  },
} as const;

const findCli = (
  nodes: ReturnType<typeof GiteaTemplateV3.resolve>["resolution"]["integrationGuide"]["nodes"],
) => {
  const node = nodes.find((candidate) => candidate.kind === "code");
  return node?.kind === "code" ? node.code : "";
};

describe("GiteaTemplateV3", () => {
  it("publishes Gitea 1.27 as the only target of the new template version", () => {
    const targetVersion = GITEA_TEMPLATE_V3_FORM.fields.find(
      (field) => field.name === "targetVersion",
    );
    const externalIdClaimName = GITEA_TEMPLATE_V3_FORM.fields.find(
      (field) => field.name === "externalIdClaimName",
    );

    expect(targetVersion).toMatchObject({
      kind: "select",
      defaultValue: "1.27",
      options: [{ label: "Gitea 1.27", value: "1.27" }],
    });
    expect(externalIdClaimName).toMatchObject({
      kind: "text",
      label: "外部 ID Claim 名称（可选，仅支持 sub）",
      placeholder: "sub",
    });
    expect(GiteaTemplateInputV3Schema.safeParse(productionInput).success).toBe(true);
    expect(
      GiteaTemplateInputV3Schema.safeParse({ ...productionInput, targetVersion: "1.26" }).success,
    ).toBe(false);
  });

  it("keeps sub as the default external identity and preserves the safe CLI path", () => {
    const result = GiteaTemplateV3.resolve(productionInput, context);
    const guide = result.resolution.integrationGuide;

    expect(result.template).toEqual({ id: "gitea", version: 3 });
    expect(result.normalizedInput).not.toHaveProperty("externalIdClaimName");
    expect(result.resolution.target).toMatchObject({
      version: "1.27",
      configuration: {
        skipLocalTwoFactor: false,
        groupTeamMapRemoval: false,
        syncEnabled: true,
        active: true,
      },
    });
    expect(result.resolution.target.configuration).not.toHaveProperty("externalIdClaimName");
    expect(result.resolution.client.allowedScopes).toEqual(["openid", "profile", "email"]);
    expect(guide.nodes).toContainEqual({
      kind: "field",
      label: "外部 ID Claim 名称（可选）",
      value: "留空（默认使用 sub）",
      copyable: false,
    });
    expect(findCli(guide.nodes)).toContain("gitea admin auth add-oauth");
    expect(safeParseIntegrationGuideV1(guide).success).toBe(true);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });

  it("allows explicit sub without changing the identity scope and omits the CLI shortcut", () => {
    const result = GiteaTemplateV3.resolve(
      { ...productionInput, externalIdClaimName: "sub" },
      { issuer: context.issuer },
    );

    expect(result.normalizedInput.externalIdClaimName).toBe("sub");
    expect(result.resolution.target.configuration.externalIdClaimName).toBe("sub");
    expect(result.resolution.client.allowedScopes).toEqual(["openid", "profile", "email"]);
    expect(findCli(result.resolution.integrationGuide.nodes)).toBe("");
    expect(result.resolution.integrationGuide.nodes).toContainEqual({
      kind: "field",
      label: "附加授权范围（Scopes）",
      value: "openid,profile,email",
      copyable: true,
    });
    expect(result.resolution.integrationGuide.nodes).toContainEqual({
      kind: "field",
      label: "外部 ID Claim 名称（可选）",
      value: "sub",
      copyable: true,
    });
    expect(result.resolution.warnings.join(" ")).toContain("账号关联语义等价");
    expect(result.resolution.warnings.join(" ")).toContain("首次登录前");
    expect(result.snapshot.normalizedInput.externalIdClaimName).toBe("sub");
    expect(result.snapshot.resolution.target.configuration.externalIdClaimName).toBe("sub");
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });

  it.each([
    ["employee ID claim", { ...productionInput, externalIdClaimName: "employee_id" }],
    ["shared status claim", { ...productionInput, externalIdClaimName: "status" }],
    ["array groups claim", { ...productionInput, externalIdClaimName: "groups" }],
    ["unsafe claim", { ...productionInput, externalIdClaimName: "employee$(id)" }],
    ["unknown field", { ...productionInput, unexpected: true }],
  ])("rejects %s", (_name, input) => {
    expect(GiteaTemplateInputV3Schema.safeParse(input).success).toBe(false);
  });

  it("rejects another external identity claim even when the deployment exposes it", () => {
    expect(() =>
      GiteaTemplateV3.resolve({ ...productionInput, externalIdClaimName: "employee_id" }, context),
    ).toThrow();
  });

  it("does not widen the historical gitea@2 input contract", () => {
    expect(
      GiteaTemplateInputV2Schema.safeParse({ ...productionInput, targetVersion: "1.26" }).success,
    ).toBe(true);
    expect(GiteaTemplateInputV2Schema.safeParse(productionInput).success).toBe(false);
    expect(
      GiteaTemplateInputV2Schema.safeParse({
        ...productionInput,
        targetVersion: "1.26",
        externalIdClaimName: "employee_id",
      }).success,
    ).toBe(false);
  });
});
