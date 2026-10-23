import { z } from "zod";
import {
  descriptionSchema,
  displayNameSchema,
  identifierSchema,
  portalUrlSchema,
  uriAllowedForEnvironment,
} from "./schemaPrimitives.js";

const safePublicPortalUrlSchema = portalUrlSchema.refine(
  (value) => uriAllowedForEnvironment(value, "development"),
  "门户 URL 仅允许 HTTPS 或 loopback HTTP",
);

/** 普通用户门户可见的最小应用投影，不包含 Client、状态或管理元数据。 */
export const PortalApplicationV1Schema = z
  .object({
    id: identifierSchema,
    name: displayNameSchema,
    description: descriptionSchema.optional(),
    iconUrl: safePublicPortalUrlSchema.optional(),
    launchUrl: safePublicPortalUrlSchema,
    order: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .readonly();

export const PortalApplicationListV1Schema = z.array(PortalApplicationV1Schema).readonly();

export type PortalApplicationV1 = z.infer<typeof PortalApplicationV1Schema>;
export type PortalApplicationListV1 = z.infer<typeof PortalApplicationListV1Schema>;

export const parsePortalApplicationV1 = (input: unknown): PortalApplicationV1 =>
  PortalApplicationV1Schema.parse(input);
export const safeParsePortalApplicationV1 = (input: unknown) =>
  PortalApplicationV1Schema.safeParse(input);
export const parsePortalApplicationListV1 = (input: unknown): PortalApplicationListV1 =>
  PortalApplicationListV1Schema.parse(input);
export const safeParsePortalApplicationListV1 = (input: unknown) =>
  PortalApplicationListV1Schema.safeParse(input);
