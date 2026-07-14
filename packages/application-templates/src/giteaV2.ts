import {
  type ApplicationTemplateFormV1,
  INTEGRATION_GUIDE_SCHEMA_VERSION,
  type IntegrationGuideV1,
  IntegrationGuideV1Schema,
} from "@gitea-oidc/contracts";
import { z } from "zod";
import {
  GITEA_CLIENT_ID_PLACEHOLDER,
  GITEA_CLIENT_SECRET_PLACEHOLDER,
  GITEA_SUPPORTED_VERSIONS,
  GITEA_TEMPLATE_FORM,
  GiteaTemplateContextV1Schema,
  type GiteaTemplateInputV1,
  GiteaTemplateInputV1Schema,
  GiteaTemplateV1,
} from "./giteaV1.js";
import { createImmutableJsonSnapshot } from "./jsonSnapshot.js";
import {
  APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION,
  type ApplicationTemplateDefinition,
  type ApplicationTemplatePreview,
  type ApplicationTemplateResolution,
  type ResolvedApplicationTemplate,
  type TemplateResolutionContext,
} from "./types.js";

export const GITEA_TEMPLATE_V2_VERSION = 2 as const;

export const GITEA_TEMPLATE_V2_FORM: ApplicationTemplateFormV1 = {
  fields: [
    ...GITEA_TEMPLATE_FORM.fields,
    {
      kind: "url",
      name: "iconUrl",
      label: "图标 URL",
      required: false,
      placeholder: "https://git.example.com/assets/sso.svg",
    },
    {
      kind: "checkbox",
      name: "skipLocalTwoFactor",
      label: "跳过本地两步验证",
      required: true,
      defaultValue: false,
      description: "仅在上游身份提供方已经强制执行多因素认证时启用。",
    },
    {
      kind: "text",
      name: "fullNameClaimName",
      label: "全名声明名称",
      required: false,
      placeholder: "name",
      description: "Gitea 1.25 及以上支持。",
    },
    {
      kind: "text",
      name: "sshPublicKeyClaimName",
      label: "SSH 公钥声明名称",
      required: false,
      placeholder: "sshpubkey",
      description: "Gitea 1.25 及以上支持，且 OIDC Provider 必须实际提供该 Claim。",
    },
    {
      kind: "text",
      name: "requiredClaimName",
      label: "必须填写 Claim 声明的名称",
      required: false,
      placeholder: "tenant",
      description: "与“必须填写 Claim 声明的值”成对配置。",
    },
    {
      kind: "text",
      name: "requiredClaimValue",
      label: "必须填写 Claim 声明的值",
      required: false,
      placeholder: "engineering",
      description: "仅允许 Claim 值完全匹配的用户登录。",
    },
    {
      kind: "text",
      name: "adminGroup",
      label: "管理员用户组 Claim 值",
      required: false,
      placeholder: "Default/Administrators",
      description: "需要同时配置用户组 Claim 声明名称。",
    },
    {
      kind: "text",
      name: "restrictedGroup",
      label: "受限用户组 Claim 值",
      required: false,
      placeholder: "Default/Restricted",
      description: "需要同时配置用户组 Claim 声明名称。",
    },
    {
      kind: "textarea",
      name: "groupTeamMap",
      label: "组到组织团队映射",
      required: false,
      rows: 5,
      placeholder: '{"Default/Developers":{"engineering":["Developers","Reviewers"]}}',
      description: "填写 Gitea 接受的 JSON：组 Claim 值 -> 组织 -> 团队名称数组。",
    },
    {
      kind: "checkbox",
      name: "groupTeamMapRemoval",
      label: "从已同步团队移除用户",
      required: true,
      defaultValue: false,
      description: "启用后，Gitea 会按组映射自动移除不再匹配的团队成员。",
    },
    {
      kind: "checkbox",
      name: "syncEnabled",
      label: "启用用户同步",
      required: true,
      defaultValue: true,
      description: "Gitea CLI 不提供对应参数，使用 CLI 创建后仍需在管理后台确认。",
    },
    {
      kind: "checkbox",
      name: "active",
      label: "该认证源已经启用",
      required: true,
      defaultValue: true,
      description: "Gitea CLI 创建的 OAuth2 认证源默认启用。",
    },
  ],
};

const exactString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), "字段不能包含首尾空白")
    .refine(
      (value) =>
        Array.from(value).every((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint > 31 && (codePoint < 127 || codePoint > 159);
        }),
      "字段不能包含控制字符",
    );

const claimNameSchema = exactString(255).regex(
  /^[A-Za-z0-9][A-Za-z0-9._~:/-]*$/u,
  "Claim 名称包含不安全字符",
);
const claimValueSchema = exactString(1024);
const mappingKeySchema = exactString(255).refine(
  (value) => !["__proto__", "constructor", "prototype"].includes(value),
  "组映射包含保留字段",
);
const groupTeamMapValueSchema = z
  .record(
    mappingKeySchema,
    z
      .record(
        mappingKeySchema,
        z
          .array(exactString(255))
          .min(1)
          .max(100)
          .refine((teams) => new Set(teams).size === teams.length, "团队名称不能重复"),
      )
      .refine((organizations) => Object.keys(organizations).length > 0, "组织映射不能为空"),
  )
  .refine((groups) => Object.keys(groups).length > 0, "组映射不能为空");

type GroupTeamMap = z.infer<typeof groupTeamMapValueSchema>;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortGroupTeamMap = (mapping: GroupTeamMap): GroupTeamMap =>
  Object.fromEntries(
    Object.entries(mapping)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([group, organizations]) => [
        group,
        Object.fromEntries(
          Object.entries(organizations)
            .sort(([left], [right]) => compareStrings(left, right))
            .map(([organization, teams]) => [organization, [...teams].sort(compareStrings)]),
        ),
      ]),
  );

const groupTeamMapSchema = exactString(10_000)
  .superRefine((value, context) => {
    try {
      const parsed = groupTeamMapValueSchema.safeParse(JSON.parse(value));
      if (!parsed.success) {
        context.addIssue({ code: "custom", message: "组到组织团队映射格式无效" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "组到组织团队映射必须是有效 JSON" });
    }
  })
  .transform((value) => {
    const parsed = groupTeamMapValueSchema.parse(JSON.parse(value));
    return JSON.stringify(sortGroupTeamMap(parsed));
  });

const pickV1Input = (input: {
  giteaBaseUrl: unknown;
  authSourceName: unknown;
  targetVersion: unknown;
  environment: unknown;
  owner?: unknown;
  groupClaimName?: unknown;
}): unknown => ({
  giteaBaseUrl: input.giteaBaseUrl,
  authSourceName: input.authSourceName,
  targetVersion: input.targetVersion,
  environment: input.environment,
  ...(input.owner !== undefined ? { owner: input.owner } : {}),
  ...(input.groupClaimName !== undefined ? { groupClaimName: input.groupClaimName } : {}),
});

const rawGiteaTemplateInputV2Schema = z
  .object({
    giteaBaseUrl: z.unknown(),
    authSourceName: z.unknown(),
    targetVersion: z.unknown(),
    environment: z.unknown(),
    owner: z.unknown().optional(),
    groupClaimName: z.unknown().optional(),
    iconUrl: exactString(2048).optional(),
    skipLocalTwoFactor: z.boolean().default(false),
    fullNameClaimName: claimNameSchema.optional(),
    sshPublicKeyClaimName: claimNameSchema.optional(),
    requiredClaimName: claimNameSchema.optional(),
    requiredClaimValue: claimValueSchema.optional(),
    adminGroup: claimValueSchema.optional(),
    restrictedGroup: claimValueSchema.optional(),
    groupTeamMap: groupTeamMapSchema.optional(),
    groupTeamMapRemoval: z.boolean().default(false),
    syncEnabled: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((input, context) => {
    const baseInput = GiteaTemplateInputV1Schema.safeParse(pickV1Input(input));
    if (!baseInput.success) {
      for (const issue of baseInput.error.issues) {
        context.addIssue({ code: "custom", path: issue.path, message: issue.message });
      }
      return;
    }

    if (input.iconUrl) {
      try {
        const iconUrl = new URL(input.iconUrl);
        if (
          (iconUrl.protocol !== "https:" && iconUrl.protocol !== "http:") ||
          iconUrl.username ||
          iconUrl.password
        ) {
          throw new Error("invalid icon URL");
        }
        if (baseInput.data.environment !== "development" && iconUrl.protocol !== "https:") {
          context.addIssue({
            code: "custom",
            path: ["iconUrl"],
            message: "生产和预发布环境的图标 URL 必须使用 HTTPS",
          });
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["iconUrl"],
          message: "图标 URL 必须是绝对 HTTP(S) URL且不能包含用户凭据",
        });
      }
    }

    if (
      baseInput.data.targetVersion === "1.24" &&
      (input.fullNameClaimName || input.sshPublicKeyClaimName)
    ) {
      context.addIssue({
        code: "custom",
        path: [input.fullNameClaimName ? "fullNameClaimName" : "sshPublicKeyClaimName"],
        message: "全名和 SSH 公钥 Claim 需要 Gitea 1.25 或更高版本",
      });
    }
    if (Boolean(input.requiredClaimName) !== Boolean(input.requiredClaimValue)) {
      context.addIssue({
        code: "custom",
        path: [input.requiredClaimName ? "requiredClaimValue" : "requiredClaimName"],
        message: "必须同时配置 Required Claim 的名称和值",
      });
    }
    if (
      !baseInput.data.groupClaimName &&
      (input.adminGroup || input.restrictedGroup || input.groupTeamMap || input.groupTeamMapRemoval)
    ) {
      context.addIssue({
        code: "custom",
        path: ["groupClaimName"],
        message: "管理员组、受限组和组织团队映射需要先配置 Group Claim Name",
      });
    }
    if (input.groupTeamMapRemoval && !input.groupTeamMap) {
      context.addIssue({
        code: "custom",
        path: ["groupTeamMapRemoval"],
        message: "启用团队成员移除前必须配置组到组织团队映射",
      });
    }
  })
  .transform((input) => {
    const baseInput = GiteaTemplateInputV1Schema.parse(pickV1Input(input));
    return {
      ...baseInput,
      skipLocalTwoFactor: input.skipLocalTwoFactor,
      groupTeamMapRemoval: input.groupTeamMapRemoval,
      syncEnabled: input.syncEnabled,
      active: input.active,
      ...(input.iconUrl ? { iconUrl: input.iconUrl } : {}),
      ...(input.fullNameClaimName ? { fullNameClaimName: input.fullNameClaimName } : {}),
      ...(input.sshPublicKeyClaimName
        ? { sshPublicKeyClaimName: input.sshPublicKeyClaimName }
        : {}),
      ...(input.requiredClaimName ? { requiredClaimName: input.requiredClaimName } : {}),
      ...(input.requiredClaimValue ? { requiredClaimValue: input.requiredClaimValue } : {}),
      ...(input.adminGroup ? { adminGroup: input.adminGroup } : {}),
      ...(input.restrictedGroup ? { restrictedGroup: input.restrictedGroup } : {}),
      ...(input.groupTeamMap ? { groupTeamMap: input.groupTeamMap } : {}),
    };
  });

export const GiteaTemplateInputV2Schema = rawGiteaTemplateInputV2Schema;
export type GiteaTemplateInputV2 = z.output<typeof GiteaTemplateInputV2Schema>;

const GiteaTemplateResolutionInputV2Schema = z
  .object({
    input: GiteaTemplateInputV2Schema,
    context: GiteaTemplateContextV1Schema,
  })
  .strict()
  .superRefine(({ input, context }, refinementContext) => {
    const claims = [
      ["groupClaimName", input.groupClaimName],
      ["fullNameClaimName", input.fullNameClaimName],
      ["sshPublicKeyClaimName", input.sshPublicKeyClaimName],
      ["requiredClaimName", input.requiredClaimName],
    ] as const;

    for (const [field, claim] of claims) {
      if (
        claim &&
        !Object.values(context.claimScopes ?? {}).some((scopeClaims) => scopeClaims.includes(claim))
      ) {
        refinementContext.addIssue({
          code: "custom",
          path: ["input", field],
          message: `${claim} 必须是当前 OIDC 部署实际提供的 Claim`,
        });
      }
    }
  });

export interface ResolvedGiteaTemplateV2 extends ResolvedApplicationTemplate {
  readonly template: {
    readonly id: "gitea";
    readonly version: typeof GITEA_TEMPLATE_V2_VERSION;
  };
  readonly target: {
    readonly product: "gitea";
    readonly version: (typeof GITEA_SUPPORTED_VERSIONS)[number];
    readonly baseUrl: string;
    readonly authSourceName: string;
    readonly callbackUrl: string;
    readonly discoveryUrl: string;
    readonly groupClaimName?: string;
    readonly configuration: {
      readonly iconUrl?: string;
      readonly skipLocalTwoFactor: boolean;
      readonly fullNameClaimName?: string;
      readonly sshPublicKeyClaimName?: string;
      readonly requiredClaimName?: string;
      readonly requiredClaimValue?: string;
      readonly adminGroup?: string;
      readonly restrictedGroup?: string;
      readonly groupTeamMap?: string;
      readonly groupTeamMapRemoval: boolean;
      readonly syncEnabled: boolean;
      readonly active: boolean;
    };
  };
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const buildGiteaCliCommand = (
  input: GiteaTemplateInputV2,
  discoveryUrl: string,
  scopes: readonly string[],
): string => {
  const argumentsList = [
    `--name ${shellQuote(input.authSourceName)}`,
    "--provider openidConnect",
    '--key "$GITEA_OIDC_CLIENT_ID"',
    '--secret "$GITEA_OIDC_CLIENT_SECRET"',
    `--auto-discover-url ${shellQuote(discoveryUrl)}`,
    `--scopes ${shellQuote(scopes.join(","))}`,
    ...(input.iconUrl ? [`--icon-url ${shellQuote(input.iconUrl)}`] : []),
    ...(input.skipLocalTwoFactor ? ["--skip-local-2fa"] : []),
    ...(input.sshPublicKeyClaimName
      ? [`--ssh-public-key-claim-name ${shellQuote(input.sshPublicKeyClaimName)}`]
      : []),
    ...(input.fullNameClaimName
      ? [`--full-name-claim-name ${shellQuote(input.fullNameClaimName)}`]
      : []),
    ...(input.requiredClaimName
      ? [`--required-claim-name ${shellQuote(input.requiredClaimName)}`]
      : []),
    ...(input.requiredClaimValue
      ? [`--required-claim-value ${shellQuote(input.requiredClaimValue)}`]
      : []),
    ...(input.groupClaimName ? [`--group-claim-name ${shellQuote(input.groupClaimName)}`] : []),
    ...(input.adminGroup ? [`--admin-group ${shellQuote(input.adminGroup)}`] : []),
    ...(input.restrictedGroup ? [`--restricted-group ${shellQuote(input.restrictedGroup)}`] : []),
    ...(input.groupTeamMap ? [`--group-team-map ${shellQuote(input.groupTeamMap)}`] : []),
    ...(input.groupTeamMapRemoval ? ["--group-team-map-removal"] : []),
  ];

  return ["gitea admin auth add-oauth", ...argumentsList]
    .map(
      (line, index, lines) =>
        `${index === 0 ? line : `  ${line}`}${index < lines.length - 1 ? " \\" : ""}`,
    )
    .join("\n");
};

const fieldValue = (value?: string): string => value ?? "留空";
const checkedValue = (value: boolean): string => (value ? "勾选" : "不勾选");

const buildIntegrationGuide = (
  input: GiteaTemplateInputV2,
  callbackUrl: string,
  postLogoutRedirectUrl: string,
  discoveryUrl: string,
  scopes: readonly string[],
): IntegrationGuideV1 => {
  const nodes: IntegrationGuideV1["nodes"] = [
    { kind: "heading", level: 2, text: "在 Gitea 管理后台配置" },
    {
      kind: "paragraph",
      text: "进入站点管理的认证源页面，新增 OAuth2 认证源并按以下字段填写。",
    },
    { kind: "field", label: "认证类型", value: "OAuth2" },
    { kind: "field", label: "OAuth2 提供程序", value: "OpenID Connect" },
    { kind: "field", label: "认证名称", value: input.authSourceName, copyable: true },
    {
      kind: "field",
      label: "客户端 ID",
      value: GITEA_CLIENT_ID_PLACEHOLDER,
      copyable: true,
    },
    {
      kind: "field",
      label: "客户端密钥",
      value: GITEA_CLIENT_SECRET_PLACEHOLDER,
      copyable: true,
    },
    { kind: "field", label: "图标 URL", value: fieldValue(input.iconUrl) },
    {
      kind: "field",
      label: "OpenID 连接自动发现 URL",
      value: discoveryUrl,
      copyable: true,
    },
    {
      kind: "field",
      label: "跳过本地两步验证",
      value: checkedValue(input.skipLocalTwoFactor),
    },
    {
      kind: "field",
      label: "附加授权范围（Scopes）",
      value: scopes.join(","),
      copyable: true,
    },
    {
      kind: "field",
      label: "全名声明名称",
      value: fieldValue(input.fullNameClaimName),
    },
    {
      kind: "field",
      label: "SSH 公钥声明名称",
      value: fieldValue(input.sshPublicKeyClaimName),
    },
    {
      kind: "field",
      label: "必须填写 Claim 声明的名称",
      value: fieldValue(input.requiredClaimName),
    },
    {
      kind: "field",
      label: "必须填写 Claim 声明的值",
      value: fieldValue(input.requiredClaimValue),
    },
    {
      kind: "field",
      label: "用户组 Claim 声明名称",
      value: fieldValue(input.groupClaimName),
    },
    {
      kind: "field",
      label: "管理员用户组 Claim 值",
      value: fieldValue(input.adminGroup),
    },
    {
      kind: "field",
      label: "受限用户组 Claim 值",
      value: fieldValue(input.restrictedGroup),
    },
    {
      kind: "field",
      label: "组到组织团队映射",
      value: fieldValue(input.groupTeamMap),
      copyable: Boolean(input.groupTeamMap),
    },
    {
      kind: "field",
      label: "从已同步团队移除用户",
      value: checkedValue(input.groupTeamMapRemoval),
    },
    {
      kind: "field",
      label: "启用用户同步",
      value: checkedValue(input.syncEnabled),
    },
    {
      kind: "field",
      label: "该认证源已经启用",
      value: checkedValue(input.active),
    },
    { kind: "field", label: "Callback URL", value: callbackUrl, copyable: true },
    {
      kind: "field",
      label: "Post Logout Redirect URI",
      value: postLogoutRedirectUrl,
      copyable: true,
    },
    {
      kind: "warning",
      text: "Gitea 当前未验证在授权请求中发送 code_challenge；在上游兼容性得到验证前，不能把 PKCE 设为 required。",
    },
  ];

  if (input.active) {
    nodes.push(
      { kind: "heading", level: 2, text: "使用 Gitea CLI 配置" },
      {
        kind: "code",
        language: "bash",
        code: buildGiteaCliCommand(input, discoveryUrl, scopes),
        caption: "在 Gitea 运行环境中执行",
      },
      {
        kind: "warning",
        text: "执行前在可信的 Gitea 主机上临时设置 GITEA_OIDC_CLIENT_ID 和 GITEA_OIDC_CLIENT_SECRET 环境变量，执行后立即清除；不要把真实凭据替换进命令文本、脚本、日志或工单。",
      },
      {
        kind: "warning",
        text: `Gitea add-oauth 命令不会设置“启用用户同步”；执行后仍需在管理后台将该项调整为“${checkedValue(input.syncEnabled)}”。`,
      },
    );
  } else {
    nodes.push({
      kind: "warning",
      text: "Gitea add-oauth 命令会直接创建启用状态的认证源，因此本配置不生成 CLI 命令；请在管理后台创建未启用的认证源。",
    });
  }

  return IntegrationGuideV1Schema.parse({
    schemaVersion: INTEGRATION_GUIDE_SCHEMA_VERSION,
    title: `Gitea ${input.targetVersion} OIDC 接入说明`,
    description: "使用内置 OpenID Connect 认证源接入 Gitea OIDC。",
    nodes,
  });
};

const toV1Input = (input: GiteaTemplateInputV2): GiteaTemplateInputV1 => ({
  giteaBaseUrl: input.giteaBaseUrl,
  authSourceName: input.authSourceName,
  targetVersion: input.targetVersion,
  environment: input.environment,
  ...(input.owner ? { owner: input.owner } : {}),
  ...(input.groupClaimName ? { groupClaimName: input.groupClaimName } : {}),
});

const scopePreference = ["openid", "profile", "email"];

const findClaimScope = (
  claim: string,
  claimScopes: Readonly<Record<string, readonly string[]>>,
): string | undefined =>
  Object.entries(claimScopes)
    .filter(([, claims]) => claims.includes(claim))
    .map(([scope]) => scope)
    .sort((left, right) => {
      const leftPreference = scopePreference.indexOf(left);
      const rightPreference = scopePreference.indexOf(right);
      if (leftPreference >= 0 || rightPreference >= 0) {
        return (
          (leftPreference < 0 ? Number.MAX_SAFE_INTEGER : leftPreference) -
          (rightPreference < 0 ? Number.MAX_SAFE_INTEGER : rightPreference)
        );
      }
      return left.localeCompare(right);
    })[0];

const buildResolution = (
  input: GiteaTemplateInputV2,
  context: z.infer<typeof GiteaTemplateContextV1Schema>,
): ResolvedGiteaTemplateV2 => {
  const baseResolution = GiteaTemplateV1.preview(toV1Input(input), context).resolution;
  const claimScopes = context.claimScopes ?? {};
  const scopes = [...baseResolution.client.allowedScopes];
  for (const claim of [
    input.fullNameClaimName,
    input.sshPublicKeyClaimName,
    input.requiredClaimName,
  ]) {
    const scope = claim ? findClaimScope(claim, claimScopes) : undefined;
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  }

  const configuration = {
    skipLocalTwoFactor: input.skipLocalTwoFactor,
    groupTeamMapRemoval: input.groupTeamMapRemoval,
    syncEnabled: input.syncEnabled,
    active: input.active,
    ...(input.iconUrl ? { iconUrl: input.iconUrl } : {}),
    ...(input.fullNameClaimName ? { fullNameClaimName: input.fullNameClaimName } : {}),
    ...(input.sshPublicKeyClaimName ? { sshPublicKeyClaimName: input.sshPublicKeyClaimName } : {}),
    ...(input.requiredClaimName ? { requiredClaimName: input.requiredClaimName } : {}),
    ...(input.requiredClaimValue ? { requiredClaimValue: input.requiredClaimValue } : {}),
    ...(input.adminGroup ? { adminGroup: input.adminGroup } : {}),
    ...(input.restrictedGroup ? { restrictedGroup: input.restrictedGroup } : {}),
    ...(input.groupTeamMap ? { groupTeamMap: input.groupTeamMap } : {}),
  };
  const postLogoutRedirectUrl =
    baseResolution.client.postLogoutRedirectUris[0] ?? `${input.giteaBaseUrl}/`;
  const warnings = [...baseResolution.warnings];
  if (input.skipLocalTwoFactor) {
    warnings.push("跳过本地两步验证只适用于上游身份提供方已强制执行多因素认证的场景。");
  }
  if (input.groupTeamMapRemoval) {
    warnings.push("团队成员自动移除会根据组映射修改现有团队成员关系，上线前必须验证映射结果。");
  }
  warnings.push(
    input.active
      ? "Gitea CLI 不会设置用户同步开关，使用命令创建后必须在管理后台确认该字段。"
      : "Gitea CLI 会直接创建启用状态的认证源，本配置已省略 CLI 命令。",
  );

  return {
    ...baseResolution,
    template: { id: "gitea", version: GITEA_TEMPLATE_V2_VERSION },
    target: {
      ...baseResolution.target,
      configuration,
    },
    client: {
      ...baseResolution.client,
      responseTypes: ["code"],
      allowedScopes: scopes,
    },
    integrationGuide: buildIntegrationGuide(
      input,
      baseResolution.target.callbackUrl,
      postLogoutRedirectUrl,
      baseResolution.target.discoveryUrl,
      scopes,
    ),
    warnings,
  };
};

const previewGiteaV2 = (
  input: unknown,
  context: TemplateResolutionContext,
): ApplicationTemplatePreview<GiteaTemplateInputV2, ResolvedGiteaTemplateV2> => {
  const parsed = GiteaTemplateResolutionInputV2Schema.parse({ input, context });
  return Object.freeze({
    template: Object.freeze({ id: "gitea", version: GITEA_TEMPLATE_V2_VERSION }),
    normalizedInput: createImmutableJsonSnapshot(parsed.input),
    resolution: createImmutableJsonSnapshot(buildResolution(parsed.input, parsed.context)),
  });
};

const resolveGiteaV2 = (
  input: unknown,
  context: TemplateResolutionContext,
): ApplicationTemplateResolution<GiteaTemplateInputV2, ResolvedGiteaTemplateV2> => {
  const preview = previewGiteaV2(input, context);
  const snapshot = createImmutableJsonSnapshot({
    schemaVersion: APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION,
    template: { id: "gitea", version: GITEA_TEMPLATE_V2_VERSION },
    normalizedInput: preview.normalizedInput,
    resolution: preview.resolution,
  });

  return Object.freeze({
    template: snapshot.template,
    normalizedInput: snapshot.normalizedInput,
    resolution: snapshot.resolution,
    snapshot,
  });
};

export const GiteaTemplateV2: ApplicationTemplateDefinition<
  GiteaTemplateInputV2,
  ResolvedGiteaTemplateV2
> = Object.freeze({
  id: "gitea",
  version: GITEA_TEMPLATE_V2_VERSION,
  name: "Gitea",
  description: "为 Gitea 1.24、1.25 和 1.26 生成完整的 OpenID Connect 认证源配置。",
  supportedVersions: Object.freeze([...GITEA_SUPPORTED_VERSIONS]),
  form: GITEA_TEMPLATE_V2_FORM,
  inputSchema: GiteaTemplateInputV2Schema,
  preview: previewGiteaV2,
  resolve: resolveGiteaV2,
});
