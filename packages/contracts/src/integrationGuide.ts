import { z } from "zod";
import { descriptionSchema } from "./schemaPrimitives.js";
import { INTEGRATION_GUIDE_SCHEMA_VERSION } from "./versions.js";

const guideTextSchema = z.string().trim().min(1).max(10_000);

/**
 * 仅描述由可信模板生成器产生的展示节点。生成器只能读取公开 connection 和 Secret 占位符；
 * 节点内容仍是不可信纯文本，渲染端必须转义，不能把 credential 或 setup code 写入节点。
 */
export const IntegrationGuideNodeV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("heading"),
      level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      text: guideTextSchema,
    })
    .strict(),
  z.object({ kind: z.literal("paragraph"), text: guideTextSchema }).strict(),
  z
    .object({
      kind: z.literal("field"),
      label: z.string().trim().min(1).max(200),
      value: z.string().max(10_000),
      description: descriptionSchema.optional(),
      copyable: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("code"),
      language: z.string().trim().min(1).max(64),
      code: z.string().min(1).max(50_000),
      caption: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("warning"), text: guideTextSchema }).strict(),
  z
    .object({
      kind: z.literal("steps"),
      items: z.tuple([guideTextSchema], guideTextSchema),
    })
    .strict(),
]);

export const IntegrationGuideV1Schema = z
  .object({
    schemaVersion: z.literal(INTEGRATION_GUIDE_SCHEMA_VERSION),
    title: z.string().trim().min(1).max(200),
    description: descriptionSchema.optional(),
    nodes: z.array(IntegrationGuideNodeV1Schema).min(1).max(200),
  })
  .strict();

export type IntegrationGuideNodeV1 = z.infer<typeof IntegrationGuideNodeV1Schema>;
/** 由可信生成器基于公开 connection 构建的结构化接入说明，不得包含任何真实凭据。 */
export type IntegrationGuideV1 = z.infer<typeof IntegrationGuideV1Schema>;

export const parseIntegrationGuideV1 = (input: unknown): IntegrationGuideV1 =>
  IntegrationGuideV1Schema.parse(input);

export const safeParseIntegrationGuideV1 = (input: unknown) =>
  IntegrationGuideV1Schema.safeParse(input);
