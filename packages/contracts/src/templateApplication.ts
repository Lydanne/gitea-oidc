import { z } from "zod";
import {
  ApplicationEnvironmentV1Schema,
  ApplicationPortalInputV1Schema,
  ApplicationTrustLevelV1Schema,
} from "./application.js";
import {
  CreateCustomApplicationReceiptV1Schema,
  CreateCustomApplicationResponseV1Schema,
} from "./customApplication.js";
import { IntegrationGuideV1Schema } from "./integrationGuide.js";
import {
  descriptionSchema,
  displayNameSchema,
  identifierSchema,
  issuerUrlSchema,
  redirectUriSchema,
  resourceSchema,
  scopeSchema,
  slugSchema,
  uniqueStringArraySchema,
} from "./schemaPrimitives.js";
import { TEMPLATE_APPLICATION_SCHEMA_VERSION } from "./versions.js";

export const ApplicationTemplateReferenceV1Schema = z
  .object({
    id: identifierSchema,
    version: z.number().int().positive(),
  })
  .strict();

const TemplateFormFieldBaseV1Schema = z.object({
  name: identifierSchema,
  label: z.string().trim().min(1).max(200),
  required: z.boolean(),
  description: descriptionSchema.optional(),
});

const StringTemplateFormFieldBaseV1Schema = TemplateFormFieldBaseV1Schema.extend({
  defaultValue: z.string().max(10_000).optional(),
});

export const ApplicationTemplateFormFieldV1Schema = z.discriminatedUnion("kind", [
  StringTemplateFormFieldBaseV1Schema.extend({
    kind: z.literal("text"),
    placeholder: z.string().max(2048).optional(),
  }).strict(),
  StringTemplateFormFieldBaseV1Schema.extend({
    kind: z.literal("url"),
    placeholder: z.string().max(2048).optional(),
  }).strict(),
  StringTemplateFormFieldBaseV1Schema.extend({
    kind: z.literal("select"),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(200),
            value: z.string().min(1).max(2048),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .superRefine((options, context) => {
        if (new Set(options.map((option) => option.value)).size !== options.length) {
          context.addIssue({ code: "custom", message: "模板选项值不能重复" });
        }
      }),
  }).strict(),
  StringTemplateFormFieldBaseV1Schema.extend({
    kind: z.literal("textarea"),
    placeholder: z.string().max(2048).optional(),
    rows: z.number().int().min(2).max(20).optional(),
  }).strict(),
  TemplateFormFieldBaseV1Schema.extend({
    kind: z.literal("checkbox"),
    defaultValue: z.boolean().optional(),
  }).strict(),
]);

export const ApplicationTemplateFormV1Schema = z
  .object({
    fields: z.array(ApplicationTemplateFormFieldV1Schema).min(1).max(32),
  })
  .strict()
  .superRefine((form, context) => {
    if (new Set(form.fields.map((field) => field.name)).size !== form.fields.length) {
      context.addIssue({ code: "custom", path: ["fields"], message: "模板表单字段名不能重复" });
    }
  });

export const ApplicationTemplateSummaryV1Schema = z
  .object({
    reference: ApplicationTemplateReferenceV1Schema,
    name: displayNameSchema,
    description: descriptionSchema,
    supportedVersions: z.array(z.string().trim().min(1).max(64)).min(1),
    form: ApplicationTemplateFormV1Schema,
  })
  .strict();

const TemplateApplicationIdentityV1Schema = z
  .object({
    name: displayNameSchema,
    slug: slugSchema.optional(),
    description: descriptionSchema.optional(),
    portal: ApplicationPortalInputV1Schema.optional(),
  })
  .strict();

const TemplateInputV1Schema = z
  .unknown()
  .superRefine((input, context) => {
    if (
      input !== null &&
      typeof input === "object" &&
      Object.getOwnPropertyNames(input).some(
        (key) => key === "__proto__" || key === "constructor" || key === "prototype",
      )
    ) {
      context.addIssue({ code: "custom", message: "模板输入包含保留字段" });
    }
  })
  .pipe(z.record(z.string().min(1).max(128), z.json()))
  .refine((input) => Object.keys(input).length <= 64, "模板输入字段不能超过 64 个")
  .readonly();

/**
 * 模板输入保持 JSON 通用形态，具体字段由所选模板的精确版本再次校验。
 * wire contract 不允许类实例、函数或其他不可持久化值进入模板快照。
 */
export const CreateTemplateApplicationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(TEMPLATE_APPLICATION_SCHEMA_VERSION),
    template: ApplicationTemplateReferenceV1Schema,
    application: TemplateApplicationIdentityV1Schema,
    templateInput: TemplateInputV1Schema,
    credentialDelivery: z.literal("direct").default("direct"),
  })
  .strict();

export const PreviewApplicationTemplateRequestV1Schema = z
  .object({
    schemaVersion: z.literal(TEMPLATE_APPLICATION_SCHEMA_VERSION),
    template: ApplicationTemplateReferenceV1Schema,
    templateInput: TemplateInputV1Schema,
  })
  .strict();

export const ApplicationTemplatePreviewV1Schema = z
  .object({
    schemaVersion: z.literal(TEMPLATE_APPLICATION_SCHEMA_VERSION),
    template: ApplicationTemplateReferenceV1Schema,
    issuer: issuerUrlSchema,
    normalizedInput: z.record(z.string().min(1).max(128), z.json()),
    application: z
      .object({
        environment: ApplicationEnvironmentV1Schema,
        trustLevel: ApplicationTrustLevelV1Schema,
        consentPolicy: z.enum(["explicit", "skip_for_trusted"]),
        owner: z.string().trim().min(1).max(320).optional(),
      })
      .strict(),
    client: z
      .object({
        clientType: z.enum(["confidential", "public"]),
        redirectUris: uniqueStringArraySchema(redirectUriSchema, 1),
        postLogoutRedirectUris: uniqueStringArraySchema(redirectUriSchema),
        scopes: uniqueStringArraySchema(scopeSchema, 1),
        resources: uniqueStringArraySchema(resourceSchema),
        pkcePolicy: z.enum(["required", "optional"]),
        capabilities: z
          .object({
            refreshToken: z.boolean(),
            providerApi: z.boolean(),
            resourceServer: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    integrationGuide: IntegrationGuideV1Schema,
    warnings: z.array(z.string().trim().min(1).max(10_000)),
  })
  .strict();

export const CreateTemplateApplicationResponseV1Schema =
  CreateCustomApplicationResponseV1Schema.superRefine((response, context) => {
    if (response.application.source.kind !== "template") {
      context.addIssue({
        code: "custom",
        path: ["application", "source"],
        message: "模板创建响应必须引用精确模板版本",
      });
    }
  });

export const CreateTemplateApplicationReceiptV1Schema =
  CreateCustomApplicationReceiptV1Schema.superRefine((response, context) => {
    if (response.application.source.kind !== "template") {
      context.addIssue({
        code: "custom",
        path: ["application", "source"],
        message: "模板创建回执必须引用精确模板版本",
      });
    }
  });

export const CreateTemplateApplicationOutcomeResponseV1Schema = z.union([
  CreateTemplateApplicationResponseV1Schema,
  CreateTemplateApplicationReceiptV1Schema,
]);

export type ApplicationTemplateReferenceV1 = z.infer<typeof ApplicationTemplateReferenceV1Schema>;
export type ApplicationTemplateFormFieldV1 = z.infer<typeof ApplicationTemplateFormFieldV1Schema>;
export type ApplicationTemplateFormV1 = z.infer<typeof ApplicationTemplateFormV1Schema>;
export type ApplicationTemplateSummaryV1 = z.infer<typeof ApplicationTemplateSummaryV1Schema>;
export type TemplateInputJsonValueV1 =
  | null
  | boolean
  | number
  | string
  | readonly TemplateInputJsonValueV1[]
  | { readonly [key: string]: TemplateInputJsonValueV1 };
export type CreateTemplateApplicationRequestV1 = Omit<
  z.input<typeof CreateTemplateApplicationRequestV1Schema>,
  "templateInput"
> & {
  templateInput: Readonly<Record<string, TemplateInputJsonValueV1>>;
};
export type NormalizedCreateTemplateApplicationRequestV1 = z.output<
  typeof CreateTemplateApplicationRequestV1Schema
>;
export type PreviewApplicationTemplateRequestV1 = Omit<
  z.input<typeof PreviewApplicationTemplateRequestV1Schema>,
  "templateInput"
> & {
  templateInput: Readonly<Record<string, TemplateInputJsonValueV1>>;
};
export type NormalizedPreviewApplicationTemplateRequestV1 = z.output<
  typeof PreviewApplicationTemplateRequestV1Schema
>;
export type ApplicationTemplatePreviewV1 = z.infer<typeof ApplicationTemplatePreviewV1Schema>;
export type CreateTemplateApplicationResponseV1 = z.infer<
  typeof CreateTemplateApplicationResponseV1Schema
>;
export type CreateTemplateApplicationReceiptV1 = z.infer<
  typeof CreateTemplateApplicationReceiptV1Schema
>;
export type CreateTemplateApplicationOutcomeResponseV1 = z.infer<
  typeof CreateTemplateApplicationOutcomeResponseV1Schema
>;

export const parseCreateTemplateApplicationRequestV1 = (
  input: unknown,
): NormalizedCreateTemplateApplicationRequestV1 =>
  CreateTemplateApplicationRequestV1Schema.parse(input);

export const safeParseCreateTemplateApplicationRequestV1 = (input: unknown) =>
  CreateTemplateApplicationRequestV1Schema.safeParse(input);

export const parsePreviewApplicationTemplateRequestV1 = (
  input: unknown,
): NormalizedPreviewApplicationTemplateRequestV1 =>
  PreviewApplicationTemplateRequestV1Schema.parse(input);

export const safeParsePreviewApplicationTemplateRequestV1 = (input: unknown) =>
  PreviewApplicationTemplateRequestV1Schema.safeParse(input);

export const parseCreateTemplateApplicationOutcomeResponseV1 = (
  input: unknown,
): CreateTemplateApplicationOutcomeResponseV1 =>
  CreateTemplateApplicationOutcomeResponseV1Schema.parse(input);

export const safeParseCreateTemplateApplicationOutcomeResponseV1 = (input: unknown) =>
  CreateTemplateApplicationOutcomeResponseV1Schema.safeParse(input);
