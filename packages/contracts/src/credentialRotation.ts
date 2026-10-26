import { z } from "zod";
import { CreateCustomApplicationResponseV1Schema } from "./customApplication.js";
import { APPLICATION_CREDENTIAL_ROTATION_SCHEMA_VERSION } from "./versions.js";

export const RotateApplicationCredentialRequestV1Schema = z
  .object({
    schemaVersion: z.literal(APPLICATION_CREDENTIAL_ROTATION_SCHEMA_VERSION),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const RotateApplicationCredentialResponseV1Schema =
  CreateCustomApplicationResponseV1Schema.superRefine((response, context) => {
    if (response.application.source.kind === "system") {
      context.addIssue({
        code: "custom",
        path: ["application", "source"],
        message: "system Application 不能通过管理 API 轮换凭据",
      });
    }
    if (
      response.client.clientType !== "confidential" ||
      response.credentialDelivery.credential.kind !== "client_secret"
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialDelivery", "credential"],
        message: "只有 confidential Client 可以轮换 Client Secret",
      });
    }
  });

export type RotateApplicationCredentialRequestV1 = z.infer<
  typeof RotateApplicationCredentialRequestV1Schema
>;
export type RotateApplicationCredentialResponseV1 = z.infer<
  typeof RotateApplicationCredentialResponseV1Schema
>;

export const parseRotateApplicationCredentialRequestV1 = (input: unknown) =>
  RotateApplicationCredentialRequestV1Schema.parse(input);

export const safeParseRotateApplicationCredentialRequestV1 = (input: unknown) =>
  RotateApplicationCredentialRequestV1Schema.safeParse(input);

export const parseRotateApplicationCredentialResponseV1 = (input: unknown) =>
  RotateApplicationCredentialResponseV1Schema.parse(input);

export const safeParseRotateApplicationCredentialResponseV1 = (input: unknown) =>
  RotateApplicationCredentialResponseV1Schema.safeParse(input);
