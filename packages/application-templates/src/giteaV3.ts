import {
  type ApplicationTemplateFormV1,
  type IntegrationGuideV1,
  IntegrationGuideV1Schema,
} from "@gitea-oidc/contracts";
import { z } from "zod";
import { GiteaTemplateContextV1Schema } from "./giteaV1.js";
import {
  GITEA_TEMPLATE_V2_FORM,
  type GiteaTemplateInputV2,
  GiteaTemplateInputV2Schema,
  GiteaTemplateV2,
  type ResolvedGiteaTemplateV2,
} from "./giteaV2.js";
import { createImmutableJsonSnapshot, type DeepReadonly } from "./jsonSnapshot.js";
import {
  APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION,
  type ApplicationTemplateDefinition,
  type ApplicationTemplatePreview,
  type ApplicationTemplateResolution,
  type ResolvedApplicationTemplate,
  type TemplateResolutionContext,
} from "./types.js";

export const GITEA_TEMPLATE_V3_VERSION = 3 as const;
export const GITEA_V3_SUPPORTED_VERSIONS = Object.freeze(["1.27"] as const);

const DEFAULT_EXTERNAL_ID_VALUE = "留空（默认使用 sub）";
const EXTERNAL_ID_CHANGE_WARNING =
  "外部 ID Claim 会决定 Gitea 的账号关联键；已有认证源改动该字段可能把同一用户识别为新账号。";
const EXTERNAL_ID_MANUAL_CONFIGURATION_WARNING =
  "Gitea 1.27 的 add-oauth 命令不能设置“外部 ID Claim 名称”；请在管理后台创建认证源，并在首次登录前完成该字段。";

const cloneFormField = (
  field: ApplicationTemplateFormV1["fields"][number],
): ApplicationTemplateFormV1["fields"][number] =>
  field.kind === "select"
    ? { ...field, options: field.options.map((option) => ({ ...option })) }
    : { ...field };

export const GITEA_TEMPLATE_V3_FORM: ApplicationTemplateFormV1 = {
  fields: GITEA_TEMPLATE_V2_FORM.fields.flatMap((readonlyField) => {
    const field = cloneFormField(readonlyField);
    if (field.name === "targetVersion" && field.kind === "select") {
      return [
        {
          ...field,
          defaultValue: "1.27",
          options: [{ label: "Gitea 1.27", value: "1.27" }],
        },
      ];
    }
    if (field.name === "sshPublicKeyClaimName") {
      return [
        field,
        {
          kind: "text" as const,
          name: "externalIdClaimName",
          label: "外部 ID Claim 名称（可选）",
          required: false,
          placeholder: "employee_id",
          description: "Gitea 1.27 新增。留空时使用稳定的 sub；已有认证源不要在升级时随意修改。",
        },
      ];
    }
    return [field];
  }),
};

const externalIdClaimNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim(), "字段不能包含首尾空白")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:/-]*$/u, "Claim 名称包含不安全字符");

const toV2CompatibleInput = (input: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const { externalIdClaimName: _externalIdClaimName, ...baseInput } = input;
  return { ...baseInput, targetVersion: "1.26" };
};

/** Gitea 1.27 继承 1.26 的认证源字段，并额外提供 External ID Claim。 */
const rawGiteaTemplateInputV3Schema = z
  .object({ externalIdClaimName: externalIdClaimNameSchema.optional() })
  .passthrough()
  .superRefine((input, context) => {
    if (input.targetVersion !== "1.27") {
      context.addIssue({
        code: "custom",
        path: ["targetVersion"],
        message: "gitea@3 仅支持 Gitea 1.27",
      });
    }
    if (input.externalIdClaimName === "sub") {
      context.addIssue({
        code: "custom",
        path: ["externalIdClaimName"],
        message: "使用默认 sub 时请留空，不要重复配置 External ID Claim",
      });
    }

    const baseInput = GiteaTemplateInputV2Schema.safeParse(toV2CompatibleInput(input));
    if (!baseInput.success) {
      for (const issue of baseInput.error.issues) {
        context.addIssue({ code: "custom", path: issue.path, message: issue.message });
      }
    }
  })
  .transform((input) => {
    const baseInput = GiteaTemplateInputV2Schema.parse(toV2CompatibleInput(input));
    return {
      ...baseInput,
      targetVersion: "1.27" as const,
      ...(input.externalIdClaimName ? { externalIdClaimName: input.externalIdClaimName } : {}),
    };
  });

export const GiteaTemplateInputV3Schema = rawGiteaTemplateInputV3Schema;
export type GiteaTemplateInputV3 = z.output<typeof GiteaTemplateInputV3Schema>;

const GiteaTemplateResolutionInputV3Schema = z
  .object({
    input: GiteaTemplateInputV3Schema,
    context: GiteaTemplateContextV1Schema,
  })
  .strict()
  .superRefine(({ input, context }, refinementContext) => {
    if (
      input.externalIdClaimName &&
      !Object.values(context.claimScopes ?? {}).some((claims) =>
        claims.includes(input.externalIdClaimName!),
      )
    ) {
      refinementContext.addIssue({
        code: "custom",
        path: ["input", "externalIdClaimName"],
        message: `${input.externalIdClaimName} 必须是当前 OIDC 部署实际提供的 Claim`,
      });
    }
  });

export interface ResolvedGiteaTemplateV3 extends ResolvedApplicationTemplate {
  readonly template: {
    readonly id: "gitea";
    readonly version: typeof GITEA_TEMPLATE_V3_VERSION;
  };
  readonly target: {
    readonly product: "gitea";
    readonly version: "1.27";
    readonly baseUrl: string;
    readonly authSourceName: string;
    readonly callbackUrl: string;
    readonly discoveryUrl: string;
    readonly groupClaimName?: string;
    readonly configuration: ResolvedGiteaTemplateV2["target"]["configuration"] & {
      readonly externalIdClaimName?: string;
    };
  };
}

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

const buildIntegrationGuide = (
  baseGuide: DeepReadonly<IntegrationGuideV1>,
  input: GiteaTemplateInputV3,
  scopes: readonly string[],
): IntegrationGuideV1 => {
  const nodes: IntegrationGuideV1["nodes"] = [];

  for (const node of baseGuide.nodes) {
    if (
      input.externalIdClaimName &&
      node.kind === "heading" &&
      node.text === "使用 Gitea CLI 配置"
    ) {
      break;
    }

    if (node.kind === "field" && node.label === "附加授权范围（Scopes）") {
      nodes.push({ ...node, value: scopes.join(",") });
    } else if (node.kind === "steps") {
      nodes.push({ ...node, items: [node.items[0]!, ...node.items.slice(1)] });
    } else {
      nodes.push({ ...node });
    }

    if (node.kind === "field" && node.label === "SSH 公钥声明名称") {
      nodes.push({
        kind: "field",
        label: "外部 ID Claim 名称（可选）",
        value: input.externalIdClaimName ?? DEFAULT_EXTERNAL_ID_VALUE,
        copyable: Boolean(input.externalIdClaimName),
      });
    }
  }

  if (input.externalIdClaimName) {
    nodes.push(
      { kind: "warning", text: EXTERNAL_ID_CHANGE_WARNING },
      { kind: "warning", text: EXTERNAL_ID_MANUAL_CONFIGURATION_WARNING },
    );
  }

  return IntegrationGuideV1Schema.parse({
    ...baseGuide,
    title: "Gitea 1.27 OIDC 接入说明",
    nodes,
  });
};

const buildResolution = (
  input: GiteaTemplateInputV3,
  context: z.infer<typeof GiteaTemplateContextV1Schema>,
): ResolvedGiteaTemplateV3 => {
  const baseResolution = GiteaTemplateV2.preview(
    toV2CompatibleInput(input as Readonly<Record<string, unknown>>) as GiteaTemplateInputV2,
    context,
  ).resolution;
  const scopes = [...baseResolution.client.allowedScopes];
  const externalIdScope = input.externalIdClaimName
    ? findClaimScope(input.externalIdClaimName, context.claimScopes ?? {})
    : undefined;
  if (externalIdScope && !scopes.includes(externalIdScope)) scopes.push(externalIdScope);

  const warnings = [...baseResolution.warnings];
  if (input.externalIdClaimName) {
    const cliWarningIndex = warnings.findIndex((warning) => warning.startsWith("Gitea CLI"));
    if (cliWarningIndex >= 0) warnings.splice(cliWarningIndex, 1);
    warnings.push(EXTERNAL_ID_CHANGE_WARNING, EXTERNAL_ID_MANUAL_CONFIGURATION_WARNING);
  }

  return {
    ...baseResolution,
    template: { id: "gitea", version: GITEA_TEMPLATE_V3_VERSION },
    target: {
      ...baseResolution.target,
      version: "1.27",
      configuration: {
        ...baseResolution.target.configuration,
        ...(input.externalIdClaimName ? { externalIdClaimName: input.externalIdClaimName } : {}),
      },
    },
    client: {
      ...baseResolution.client,
      responseTypes: ["code"],
      allowedScopes: scopes,
    },
    integrationGuide: buildIntegrationGuide(baseResolution.integrationGuide, input, scopes),
    warnings,
  };
};

const previewGiteaV3 = (
  input: unknown,
  context: TemplateResolutionContext,
): ApplicationTemplatePreview<GiteaTemplateInputV3, ResolvedGiteaTemplateV3> => {
  const parsed = GiteaTemplateResolutionInputV3Schema.parse({ input, context });
  return Object.freeze({
    template: Object.freeze({ id: "gitea", version: GITEA_TEMPLATE_V3_VERSION }),
    normalizedInput: createImmutableJsonSnapshot(parsed.input),
    resolution: createImmutableJsonSnapshot(buildResolution(parsed.input, parsed.context)),
  });
};

const resolveGiteaV3 = (
  input: unknown,
  context: TemplateResolutionContext,
): ApplicationTemplateResolution<GiteaTemplateInputV3, ResolvedGiteaTemplateV3> => {
  const preview = previewGiteaV3(input, context);
  const snapshot = createImmutableJsonSnapshot({
    schemaVersion: APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION,
    template: { id: "gitea", version: GITEA_TEMPLATE_V3_VERSION },
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

export const GiteaTemplateV3: ApplicationTemplateDefinition<
  GiteaTemplateInputV3,
  ResolvedGiteaTemplateV3
> = Object.freeze({
  id: "gitea",
  version: GITEA_TEMPLATE_V3_VERSION,
  name: "Gitea",
  description: "为 Gitea 1.27 生成包含 External ID Claim 安全约束的 OpenID Connect 配置。",
  supportedVersions: Object.freeze([...GITEA_V3_SUPPORTED_VERSIONS]),
  form: GITEA_TEMPLATE_V3_FORM,
  inputSchema: GiteaTemplateInputV3Schema,
  preview: previewGiteaV3,
  resolve: resolveGiteaV3,
});
