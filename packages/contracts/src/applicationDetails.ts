import { z } from "zod";
import { ApplicationV1Schema, OidcClientV1Schema } from "./application.js";
import { addIssue, unorderedStringArraysEqual } from "./schemaPrimitives.js";

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const ApplicationSecretSummaryV1Schema = z
  .object({
    id: z.string().min(1).max(512),
    oidcClientId: z.string().min(1).max(512),
    keyId: z.string().min(1).max(128),
    fingerprint: z.string().regex(/^hmac-sha256:[a-f0-9]{24}$/u),
    status: z.enum(["active", "revoked", "expired"]),
    deliveredAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.optional(),
  })
  .strict();

/** V1 明确采用一个 Application 对应一个 OIDC Client。 */
export const ApplicationDetailsV1Schema = z
  .object({
    application: ApplicationV1Schema,
    clients: z.array(OidcClientV1Schema).length(1),
    secrets: z.array(ApplicationSecretSummaryV1Schema),
  })
  .strict()
  .superRefine((details, context) => {
    const client = details.clients[0];
    if (client.applicationId !== details.application.id) {
      addIssue(context, ["clients", 0, "applicationId"], "Client 不属于当前 Application");
    }
    const activeSecrets = details.secrets.filter((secret) => secret.status === "active");
    if (activeSecrets.length > 1 || (client.clientType === "public" && activeSecrets.length > 0)) {
      addIssue(context, ["secrets"], "V1 只允许 confidential Client 拥有一个 active Secret");
    }
    details.secrets.forEach((secret, index) => {
      if (secret.oidcClientId !== client.id) {
        addIssue(context, ["secrets", index, "oidcClientId"], "Secret 不属于当前 Client");
      }
    });
    if (
      (details.application.status === "active") !== (client.status === "active") ||
      (details.application.status === "disabled" && client.status !== "disabled")
    ) {
      addIssue(context, ["clients", 0, "status"], "Application 与 Client 状态不一致");
    }
    if (!unorderedStringArraysEqual(client.responseTypes, ["code"])) {
      addIssue(context, ["clients", 0, "responseTypes"], "V1 Client 必须使用 code response type");
    }
  });

export const ApplicationDetailsListV1Schema = z.array(ApplicationDetailsV1Schema);

export type ApplicationSecretSummaryV1 = z.infer<typeof ApplicationSecretSummaryV1Schema>;
export type ApplicationDetailsV1 = z.infer<typeof ApplicationDetailsV1Schema>;

export const parseApplicationDetailsV1 = (input: unknown): ApplicationDetailsV1 =>
  ApplicationDetailsV1Schema.parse(input);

export const safeParseApplicationDetailsV1 = (input: unknown) =>
  ApplicationDetailsV1Schema.safeParse(input);

export const parseApplicationDetailsListV1 = (input: unknown): ApplicationDetailsV1[] =>
  ApplicationDetailsListV1Schema.parse(input);
