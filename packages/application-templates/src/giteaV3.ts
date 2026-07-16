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
const EXTERNAL_ID_SUB_WARNING =
  "外部 ID Claim 仅支持稳定且唯一的 sub；显式填写 sub 与留空使用默认 sub 的账号关联语义等价。";
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
          label: "外部 ID Claim 名称（可选，仅支持 sub）",
          required: false,
          placeholder: "sub",
          description: "建议留空，Gitea 默认使用稳定的 sub；如需显式配置，只能填写 sub。",
        },
      ];
    }
    return [field];
  }),
};

const externalIdClaimNameSchema = z.literal("sub", {
  error: "外部 ID Claim 名称仅支持 sub",
});

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
  .strict();

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
      readonly externalIdClaimName?: "sub";
    };
  };
}

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
      { kind: "warning", text: EXTERNAL_ID_SUB_WARNING },
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

  const warnings = [...baseResolution.warnings];
  if (input.externalIdClaimName) {
    const cliWarningIndex = warnings.findIndex((warning) => warning.startsWith("Gitea CLI"));
    if (cliWarningIndex >= 0) warnings.splice(cliWarningIndex, 1);
    warnings.push(EXTERNAL_ID_SUB_WARNING, EXTERNAL_ID_MANUAL_CONFIGURATION_WARNING);
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
