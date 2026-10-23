import {
  ApplicationEnvironmentV1Schema,
  type ApplicationTemplateFormV1,
  INTEGRATION_GUIDE_SCHEMA_VERSION,
  type IntegrationGuideV1,
  IntegrationGuideV1Schema,
  issuerUrlSchema,
  scopeSchema,
} from "@x-oidc/contracts";
import { z } from "zod";
import { createImmutableJsonSnapshot } from "./jsonSnapshot.js";
import {
  APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION,
  type ApplicationTemplateDefinition,
  type ApplicationTemplatePreview,
  type ApplicationTemplateResolution,
  type ResolvedApplicationTemplate,
  type TemplateResolutionContext,
} from "./types.js";

export const GITEA_TEMPLATE_ID = "gitea" as const;
export const GITEA_TEMPLATE_VERSION = 1 as const;
export const GITEA_SUPPORTED_VERSIONS = Object.freeze(["1.24", "1.25", "1.26"] as const);
export const GITEA_CLIENT_ID_PLACEHOLDER = "<X_OIDC_CLIENT_ID>" as const;
export const GITEA_CLIENT_SECRET_PLACEHOLDER = "<X_OIDC_CLIENT_SECRET>" as const;
export const GITEA_TEMPLATE_FORM: ApplicationTemplateFormV1 = {
  fields: [
    {
      kind: "url",
      name: "giteaBaseUrl",
      label: "Gitea Base URL",
      required: true,
      placeholder: "https://git.example.com",
      description: "模板会据此生成 Gitea 的固定 OAuth2 Callback URL。",
    },
    {
      kind: "text",
      name: "authSourceName",
      label: "认证源名称",
      required: true,
      defaultValue: "company-sso",
      placeholder: "company-sso",
    },
    {
      kind: "select",
      name: "targetVersion",
      label: "Gitea 版本",
      required: true,
      defaultValue: GITEA_SUPPORTED_VERSIONS.at(-1),
      options: GITEA_SUPPORTED_VERSIONS.map((version) => ({
        label: `Gitea ${version}`,
        value: version,
      })),
    },
    {
      kind: "select",
      name: "environment",
      label: "运行环境",
      required: true,
      defaultValue: "production",
      options: [
        { label: "开发环境", value: "development" },
        { label: "预发布环境", value: "staging" },
        { label: "生产环境", value: "production" },
      ],
    },
    {
      kind: "text",
      name: "owner",
      label: "负责人",
      required: false,
      placeholder: "platform@example.com",
    },
    {
      kind: "text",
      name: "groupClaimName",
      label: "Group Claim Name",
      required: false,
      placeholder: "groups",
      description: "填写服务端实际提供的 group claim；模板会自动选择承载它的 scope。",
    },
  ],
};

const PKCE_COMPATIBILITY_WARNING =
  "Gitea 当前未验证在授权请求中发送 code_challenge；在上游兼容性得到验证前，不能把 PKCE 设为 required。";

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

const authSourceNameSchema = exactString(64).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  "authSourceName 只能使用小写字母、数字和单个连字符",
);

const groupClaimNameSchema = exactString(255).regex(
  /^[A-Za-z0-9][A-Za-z0-9._~:/-]*$/u,
  "groupClaimName 包含不安全字符",
);

const ownerSchema = exactString(320);

const parseGiteaBaseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) <= 255)
  );
};

const normalizeBaseUrl = (value: string): string => {
  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/u, "");
  return pathname ? `${url.origin}${pathname}` : url.origin;
};

const rawGiteaTemplateInputV1Schema = z
  .object({
    giteaBaseUrl: exactString(2048),
    authSourceName: authSourceNameSchema,
    targetVersion: z.enum(GITEA_SUPPORTED_VERSIONS),
    environment: ApplicationEnvironmentV1Schema,
    owner: ownerSchema.optional(),
    groupClaimName: groupClaimNameSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.giteaBaseUrl.includes("\\") || input.giteaBaseUrl.includes("*")) {
      context.addIssue({
        code: "custom",
        path: ["giteaBaseUrl"],
        message: "Gitea Base URL 不能包含反斜杠或通配符",
      });
      return;
    }

    const url = parseGiteaBaseUrl(input.giteaBaseUrl);
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
      context.addIssue({
        code: "custom",
        path: ["giteaBaseUrl"],
        message: "Gitea Base URL 必须是绝对 HTTP(S) URL",
      });
      return;
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({
        code: "custom",
        path: ["giteaBaseUrl"],
        message: "Gitea Base URL 不能包含 userinfo、query 或 fragment",
      });
    }
    if (url.protocol === "http:") {
      if (input.environment !== "development" || !isLoopbackHostname(url.hostname)) {
        context.addIssue({
          code: "custom",
          path: ["giteaBaseUrl"],
          message: "只有 development 环境的 loopback Gitea 才允许使用 HTTP",
        });
      }
    }
  })
  .transform((input) => ({
    giteaBaseUrl: normalizeBaseUrl(input.giteaBaseUrl),
    authSourceName: input.authSourceName,
    targetVersion: input.targetVersion,
    environment: input.environment,
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.groupClaimName ? { groupClaimName: input.groupClaimName } : {}),
  }));

export const GiteaTemplateInputV1Schema = rawGiteaTemplateInputV1Schema;
export type GiteaTemplateInputV1 = z.output<typeof GiteaTemplateInputV1Schema>;

export const GiteaTemplateContextV1Schema = z
  .object({
    issuer: issuerUrlSchema,
    claimScopes: z.record(scopeSchema, z.array(exactString(255))).optional(),
  })
  .strict();

export type GiteaTemplateContextV1 = z.infer<typeof GiteaTemplateContextV1Schema>;

const GiteaTemplateResolutionInputV1Schema = z
  .object({
    input: GiteaTemplateInputV1Schema,
    context: GiteaTemplateContextV1Schema,
  })
  .strict()
  .superRefine(({ input, context }, refinementContext) => {
    const issuer = new URL(context.issuer);
    if (input.environment !== "development" && issuer.protocol !== "https:") {
      refinementContext.addIssue({
        code: "custom",
        path: ["context", "issuer"],
        message: "生产和预发布环境的 issuer 必须使用 HTTPS",
      });
    }
    if (
      input.groupClaimName &&
      !Object.values(context.claimScopes ?? {}).some((claims) =>
        claims.includes(input.groupClaimName!),
      )
    ) {
      refinementContext.addIssue({
        code: "custom",
        path: ["input", "groupClaimName"],
        message: "Group Claim Name 必须是当前 OIDC 部署实际提供的 claim",
      });
    }
  });

export interface ResolvedGiteaTemplateV1 extends ResolvedApplicationTemplate {
  readonly template: {
    readonly id: typeof GITEA_TEMPLATE_ID;
    readonly version: typeof GITEA_TEMPLATE_VERSION;
  };
  readonly target: {
    readonly product: typeof GITEA_TEMPLATE_ID;
    readonly version: (typeof GITEA_SUPPORTED_VERSIONS)[number];
    readonly baseUrl: string;
    readonly authSourceName: string;
    readonly callbackUrl: string;
    readonly discoveryUrl: string;
    readonly groupClaimName?: string;
  };
}

const buildCallbackUrl = (input: GiteaTemplateInputV1): string =>
  `${input.giteaBaseUrl}/user/oauth2/${input.authSourceName}/callback`;

const buildPostLogoutRedirectUrl = (input: GiteaTemplateInputV1): string =>
  `${input.giteaBaseUrl}/`;

const buildDiscoveryUrl = (issuer: string): string =>
  `${issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`;

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const buildGiteaCliCommand = (
  input: GiteaTemplateInputV1,
  discoveryUrl: string,
  scopes: readonly string[],
): string => {
  const lines = [
    "gitea admin auth add-oauth \\",
    `  --name ${shellQuote(input.authSourceName)} \\`,
    "  --provider openidConnect \\",
    '  --key "$X_OIDC_CLIENT_ID" \\',
    '  --secret "$X_OIDC_CLIENT_SECRET" \\',
    `  --auto-discover-url ${shellQuote(discoveryUrl)} \\`,
    `  --scopes ${shellQuote(scopes.join(","))}${input.groupClaimName ? " \\" : ""}`,
  ];

  if (input.groupClaimName) {
    lines.push(`  --group-claim-name ${shellQuote(input.groupClaimName)}`);
  }
  return lines.join("\n");
};

const buildIntegrationGuide = (
  input: GiteaTemplateInputV1,
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
    { kind: "field", label: "OAuth2 Provider", value: "OpenID Connect" },
    { kind: "field", label: "认证名称", value: input.authSourceName, copyable: true },
    {
      kind: "field",
      label: "Client ID (Key)",
      value: GITEA_CLIENT_ID_PLACEHOLDER,
      copyable: true,
    },
    {
      kind: "field",
      label: "Client Secret",
      value: GITEA_CLIENT_SECRET_PLACEHOLDER,
      copyable: true,
    },
    {
      kind: "field",
      label: "OpenID Connect Auto Discovery URL",
      value: discoveryUrl,
      copyable: true,
    },
    { kind: "field", label: "Scopes", value: scopes.join(" "), copyable: true },
    { kind: "field", label: "Callback URL", value: callbackUrl, copyable: true },
    {
      kind: "field",
      label: "Post Logout Redirect URI",
      value: postLogoutRedirectUrl,
      copyable: true,
    },
    ...(input.groupClaimName
      ? [
          {
            kind: "field" as const,
            label: "Group Claim Name",
            value: input.groupClaimName,
            copyable: true,
          },
        ]
      : []),
    { kind: "warning", text: PKCE_COMPATIBILITY_WARNING },
    { kind: "heading", level: 2, text: "使用 Gitea CLI 配置" },
    {
      kind: "code",
      language: "bash",
      code: buildGiteaCliCommand(input, discoveryUrl, scopes),
      caption: "在 Gitea 运行环境中执行",
    },
    {
      kind: "warning",
      text: "执行前在可信的 Gitea 主机上临时设置 X_OIDC_CLIENT_ID 和 X_OIDC_CLIENT_SECRET 环境变量，执行后立即清除；不要把真实凭据替换进命令文本、脚本、日志或工单。",
    },
  ];

  return IntegrationGuideV1Schema.parse({
    schemaVersion: INTEGRATION_GUIDE_SCHEMA_VERSION,
    title: `Gitea ${input.targetVersion} OIDC 接入说明`,
    description: "使用内置 OpenID Connect 认证源接入 X OIDC。",
    nodes,
  });
};

const buildResolution = (
  input: GiteaTemplateInputV1,
  context: GiteaTemplateContextV1,
): ResolvedGiteaTemplateV1 => {
  const callbackUrl = buildCallbackUrl(input);
  const postLogoutRedirectUrl = buildPostLogoutRedirectUrl(input);
  const discoveryUrl = buildDiscoveryUrl(context.issuer);
  const baseScopes = ["openid", "profile", "email"];
  const groupScope = input.groupClaimName
    ? Object.entries(context.claimScopes ?? {})
        .filter(([, claims]) => claims.includes(input.groupClaimName!))
        .map(([scope]) => scope)
        .sort((left, right) => {
          const leftPreference = baseScopes.indexOf(left);
          const rightPreference = baseScopes.indexOf(right);
          if (leftPreference >= 0 || rightPreference >= 0) {
            return (
              (leftPreference < 0 ? Number.MAX_SAFE_INTEGER : leftPreference) -
              (rightPreference < 0 ? Number.MAX_SAFE_INTEGER : rightPreference)
            );
          }
          return left.localeCompare(right);
        })[0]
    : undefined;
  const scopes = [
    ...baseScopes,
    ...(groupScope && !baseScopes.includes(groupScope) ? [groupScope] : []),
  ];

  return {
    schemaVersion: 1,
    template: { id: GITEA_TEMPLATE_ID, version: GITEA_TEMPLATE_VERSION },
    issuer: context.issuer,
    application: {
      environment: input.environment,
      ...(input.owner ? { owner: input.owner } : {}),
      trustLevel: "third_party",
      consentPolicy: "explicit",
    },
    target: {
      product: GITEA_TEMPLATE_ID,
      version: input.targetVersion,
      baseUrl: input.giteaBaseUrl,
      authSourceName: input.authSourceName,
      callbackUrl,
      discoveryUrl,
      ...(input.groupClaimName ? { groupClaimName: input.groupClaimName } : {}),
    },
    client: {
      clientType: "confidential",
      tokenEndpointAuthMethod: "client_secret_basic",
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      redirectUris: [callbackUrl],
      postLogoutRedirectUris: [postLogoutRedirectUrl],
      allowedScopes: scopes,
      allowedResources: [],
      pkcePolicy: "optional",
      capabilities: {
        refreshToken: false,
        providerApi: false,
        resourceServer: false,
      },
    },
    integrationGuide: buildIntegrationGuide(
      input,
      callbackUrl,
      postLogoutRedirectUrl,
      discoveryUrl,
      scopes,
    ),
    warnings: [PKCE_COMPATIBILITY_WARNING],
  };
};

const resolveGitea = (
  input: unknown,
  context: TemplateResolutionContext,
): ApplicationTemplateResolution<GiteaTemplateInputV1, ResolvedGiteaTemplateV1> => {
  const preview = previewGitea(input, context);
  const snapshot = createImmutableJsonSnapshot({
    schemaVersion: APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION,
    template: { id: GITEA_TEMPLATE_ID, version: GITEA_TEMPLATE_VERSION },
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

const previewGitea = (
  input: unknown,
  context: TemplateResolutionContext,
): ApplicationTemplatePreview<GiteaTemplateInputV1, ResolvedGiteaTemplateV1> => {
  const parsed = GiteaTemplateResolutionInputV1Schema.parse({ input, context });
  return Object.freeze({
    template: Object.freeze({ id: GITEA_TEMPLATE_ID, version: GITEA_TEMPLATE_VERSION }),
    normalizedInput: createImmutableJsonSnapshot(parsed.input),
    resolution: createImmutableJsonSnapshot(buildResolution(parsed.input, parsed.context)),
  });
};

export const GiteaTemplateV1: ApplicationTemplateDefinition<
  GiteaTemplateInputV1,
  ResolvedGiteaTemplateV1
> = Object.freeze({
  id: GITEA_TEMPLATE_ID,
  version: GITEA_TEMPLATE_VERSION,
  name: "Gitea",
  description: "为 Gitea 1.24、1.25 和 1.26 生成 OpenID Connect 认证源配置。",
  supportedVersions: Object.freeze([...GITEA_SUPPORTED_VERSIONS]),
  form: GITEA_TEMPLATE_FORM,
  inputSchema: GiteaTemplateInputV1Schema,
  preview: previewGitea,
  resolve: resolveGitea,
});
