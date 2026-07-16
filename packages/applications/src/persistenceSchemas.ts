import { ApplicationTemplateSnapshotSchema } from "@gitea-oidc/application-templates";
import {
  ApplicationSecretSummaryV1Schema,
  ApplicationV1Schema,
  issuerUrlSchema,
  OidcClientV1Schema,
} from "@gitea-oidc/contracts";
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

export const StoredApplicationAggregateSchema = z
  .object({
    application: ApplicationV1Schema,
    connectionIssuer: issuerUrlSchema,
    clients: z.array(OidcClientV1Schema).length(1),
    secrets: z.array(encryptedApplicationSecretSchema),
    templateSnapshot: ApplicationTemplateSnapshotSchema.optional(),
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

    if (aggregate.application.source.kind === "template") {
      if (aggregate.templateSnapshot === undefined) {
        context.addIssue({
          code: "custom",
          path: ["templateSnapshot"],
          message: "模板应用必须持久化不可变模板快照",
        });
      } else if (
        aggregate.templateSnapshot.template.id !== aggregate.application.source.templateId ||
        aggregate.templateSnapshot.template.version !== aggregate.application.source.templateVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["templateSnapshot", "template"],
          message: "模板快照版本与 Application source 不一致",
        });
      } else {
        const resolution = aggregate.templateSnapshot.resolution;
        const client = aggregate.clients[0];
        const sameStringSet = (left: readonly string[], right: readonly string[]) =>
          left.length === right.length && left.every((value) => right.includes(value));
        if (resolution.issuer !== aggregate.connectionIssuer) {
          context.addIssue({
            code: "custom",
            path: ["templateSnapshot", "resolution", "issuer"],
            message: "模板快照 issuer 与 Connection issuer 不一致",
          });
        }
        if (
          resolution.application.environment !== aggregate.application.environment ||
          resolution.application.trustLevel !== aggregate.application.trustLevel ||
          resolution.application.consentPolicy !== aggregate.application.consentPolicy ||
          resolution.application.owner !== aggregate.application.owner
        ) {
          context.addIssue({
            code: "custom",
            path: ["templateSnapshot", "resolution", "application"],
            message: "模板快照的应用策略与持久化 Application 不一致",
          });
        }
        if (
          client === undefined ||
          resolution.client.clientType !== client.clientType ||
          resolution.client.tokenEndpointAuthMethod !== client.tokenEndpointAuthMethod ||
          !sameStringSet(resolution.client.grantTypes, client.grantTypes) ||
          !sameStringSet(resolution.client.responseTypes, client.responseTypes) ||
          !sameStringSet(resolution.client.redirectUris, client.redirectUris) ||
          !sameStringSet(resolution.client.postLogoutRedirectUris, client.postLogoutRedirectUris) ||
          !sameStringSet(resolution.client.allowedScopes, client.allowedScopes) ||
          !sameStringSet(resolution.client.allowedResources, client.allowedResources) ||
          resolution.client.pkcePolicy !== client.pkcePolicy ||
          resolution.client.capabilities.providerApi !== client.capabilities.providerApi ||
          resolution.client.capabilities.refreshToken !==
            client.grantTypes.includes("refresh_token") ||
          resolution.client.capabilities.resourceServer !== client.allowedResources.length > 0
        ) {
          context.addIssue({
            code: "custom",
            path: ["templateSnapshot", "resolution", "client"],
            message: "模板快照的 Client 投影与持久化 OIDC Client 不一致",
          });
        }
      }
    } else if (aggregate.templateSnapshot !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["templateSnapshot"],
        message: "非模板应用不能持久化模板快照",
      });
    }
  });

const auditSnapshotSchema = z
  .object({
    application: ApplicationV1Schema.optional(),
    clients: z.array(OidcClientV1Schema).optional(),
    secret: ApplicationSecretSummaryV1Schema.optional(),
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
      "client_secret.rotated",
      "client_secret.revoked",
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

export interface StoredApplicationAggregateMigration {
  aggregate: StoredApplicationAggregate;
  migrated: boolean;
}

/** 只在无版本元数据的旧数据库初始化时补齐创建当时由运行时提供的 issuer。 */
export function migrateStoredApplicationAggregate(
  value: string,
  connectionIssuer: string,
): StoredApplicationAggregateMigration {
  const parsed = parseJson(value, "Application aggregate");
  const current = StoredApplicationAggregateSchema.safeParse(parsed);
  if (current.success) {
    return { aggregate: current.data, migrated: false };
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    "connectionIssuer" in parsed
  ) {
    throw new ApplicationStorageCorruptionError("Application aggregate", {
      cause: current.error,
    });
  }
  const migrated = StoredApplicationAggregateSchema.safeParse({
    ...parsed,
    connectionIssuer,
  });
  if (!migrated.success) {
    throw new ApplicationStorageCorruptionError("Application aggregate", {
      cause: migrated.error,
    });
  }
  return { aggregate: migrated.data, migrated: true };
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
