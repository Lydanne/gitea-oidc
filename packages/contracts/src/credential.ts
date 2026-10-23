import { z } from "zod";
import {
  clientIdSchema,
  hasNoControlCharacters,
  identifierSchema,
  isoDateTimeSchema,
  issuerUrlSchema,
} from "./schemaPrimitives.js";
import { APPLICATION_CREDENTIAL_SCHEMA_VERSION } from "./versions.js";

const clientSecretSchema = z
  .string()
  .min(16)
  .max(512)
  .refine((value) => value === value.trim(), "client_secret 不能包含首尾空白")
  .refine((value) => !/\s/u.test(value), "client_secret 不能包含空白字符")
  .refine(hasNoControlCharacters, "client_secret 不能包含控制字符");

const credentialBindingSchema = {
  schemaVersion: z.literal(APPLICATION_CREDENTIAL_SCHEMA_VERSION),
  applicationId: identifierSchema,
  oidcClientId: identifierSchema,
  issuer: issuerUrlSchema,
  clientId: clientIdSchema,
} as const;

export const ApplicationCredentialV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      ...credentialBindingSchema,
      kind: z.literal("client_secret"),
      clientSecret: clientSecretSchema,
      expiresAt: isoDateTimeSchema.optional(),
    })
    .strict(),
  z.object({ ...credentialBindingSchema, kind: z.literal("none") }).strict(),
]);

export type ApplicationCredentialV1 = z.infer<typeof ApplicationCredentialV1Schema>;

export const parseApplicationCredentialV1 = (input: unknown): ApplicationCredentialV1 =>
  ApplicationCredentialV1Schema.parse(input);

export const safeParseApplicationCredentialV1 = (input: unknown) =>
  ApplicationCredentialV1Schema.safeParse(input);
