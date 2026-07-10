import { z } from "zod";
import { hasNoControlCharacters, isoDateTimeSchema } from "./schemaPrimitives.js";

const clientSecretSchema = z
  .string()
  .min(16)
  .max(512)
  .refine((value) => value === value.trim(), "client_secret 不能包含首尾空白")
  .refine((value) => !/\s/u.test(value), "client_secret 不能包含空白字符")
  .refine(hasNoControlCharacters, "client_secret 不能包含控制字符");

export const ApplicationCredentialV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("client_secret"),
      clientSecret: clientSecretSchema,
      expiresAt: isoDateTimeSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);

export type ApplicationCredentialV1 = z.infer<typeof ApplicationCredentialV1Schema>;

export const parseApplicationCredentialV1 = (input: unknown): ApplicationCredentialV1 =>
  ApplicationCredentialV1Schema.parse(input);

export const safeParseApplicationCredentialV1 = (input: unknown) =>
  ApplicationCredentialV1Schema.safeParse(input);
