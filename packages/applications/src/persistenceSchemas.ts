import { ApplicationV1Schema, OidcClientV1Schema } from "@gitea-oidc/contracts";
import { z } from "zod";
import { ApplicationStorageCorruptionError } from "./errors.js";
import type {
  ApplicationAuditEvent,
  ApplicationIdempotencyRecord,
  StoredApplicationAggregate,
} from "./types.js";

const isoDateTimeSchema = z.string().datetime({ offset: true });

const encryptedApplicationSecretSchema = z
  .object({
    id: z.string().min(1),
    oidcClientId: z.string().min(1),
    ciphertext: z.string().min(1),
    iv: z.string().min(1),
    authTag: z.string().min(1),
    keyId: z.string().min(1).max(128),
    fingerprint: z.string().regex(/^hmac-sha256:[a-f0-9]{24}$/),
    status: z.enum(["active", "revoked", "expired"]),
    deliveredAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.optional(),
  })
  .strict();

const secretSummarySchema = encryptedApplicationSecretSchema.omit({
  ciphertext: true,
  iv: true,
  authTag: true,
});

export const StoredApplicationAggregateSchema = z
  .object({
    application: ApplicationV1Schema,
    clients: z.array(OidcClientV1Schema).min(1),
    secrets: z.array(encryptedApplicationSecretSchema),
  })
  .strict()
  .superRefine((aggregate, context) => {
    for (const [index, client] of aggregate.clients.entries()) {
      if (client.applicationId !== aggregate.application.id) {
        context.addIssue({
          code: "custom",
          path: ["clients", index, "applicationId"],
          message: "Client 不属于当前 Application",
        });
      }
    }
    const clientIds = new Set(aggregate.clients.map((client) => client.id));
    for (const [index, secret] of aggregate.secrets.entries()) {
      if (!clientIds.has(secret.oidcClientId)) {
        context.addIssue({
          code: "custom",
          path: ["secrets", index, "oidcClientId"],
          message: "Secret 不属于当前 Application 的 Client",
        });
      }
    }
  });

const auditSnapshotSchema = z
  .object({
    application: ApplicationV1Schema.optional(),
    clients: z.array(OidcClientV1Schema).optional(),
    secret: secretSummarySchema.optional(),
  })
  .strict();

export const ApplicationAuditEventSchema = z
  .object({
    id: z.string().min(1),
    applicationId: z.string().min(1),
    type: z.enum([
      "application.created",
      "application.imported",
      "application.disable_started",
      "application.enabled",
      "application.disabled",
      "client_secret.created",
    ]),
    actor: z
      .object({
        type: z.enum(["system", "user"]),
        id: z.string().min(1).optional(),
      })
      .strict(),
    before: auditSnapshotSchema.optional(),
    after: auditSnapshotSchema.optional(),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

export const ApplicationIdempotencyRecordSchema = z
  .object({
    keyHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    applicationId: z.string().min(1),
    createdAt: isoDateTimeSchema,
  })
  .strict();

function parseJson(value: string, recordType: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new ApplicationStorageCorruptionError(recordType, { cause: error });
  }
}

function parseWithSchema<T>(value: string, recordType: string, schema: z.ZodType<T>): T {
  const result = schema.safeParse(parseJson(value, recordType));
  if (!result.success) {
    throw new ApplicationStorageCorruptionError(recordType, { cause: result.error });
  }
  return result.data;
}

export function parseStoredApplicationAggregate(value: string): StoredApplicationAggregate {
  return parseWithSchema(value, "Application aggregate", StoredApplicationAggregateSchema);
}

export function parseApplicationAuditEvent(value: string): ApplicationAuditEvent {
  return parseWithSchema(value, "audit event", ApplicationAuditEventSchema);
}

export function parseApplicationIdempotencyRecord(value: unknown): ApplicationIdempotencyRecord {
  const result = ApplicationIdempotencyRecordSchema.safeParse(value);
  if (!result.success) {
    throw new ApplicationStorageCorruptionError("idempotency record", { cause: result.error });
  }
  return result.data;
}
