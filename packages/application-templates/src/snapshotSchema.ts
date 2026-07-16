import {
  ApplicationConsentPolicyV1Schema,
  ApplicationEnvironmentV1Schema,
  ApplicationTemplateReferenceV1Schema,
  ApplicationTrustLevelV1Schema,
  IntegrationGuideV1Schema,
  issuerUrlSchema,
  redirectUriSchema,
  resourceSchema,
  scopeSchema,
  uniqueStringArraySchema,
} from "@x-oidc/contracts";
import { z } from "zod";
import { APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION } from "./types.js";

export const ResolvedApplicationTemplateSchema = z
  .object({
    schemaVersion: z.literal(1),
    template: ApplicationTemplateReferenceV1Schema,
    issuer: issuerUrlSchema,
    application: z
      .object({
        environment: ApplicationEnvironmentV1Schema,
        owner: z.string().trim().min(1).max(320).optional(),
        trustLevel: ApplicationTrustLevelV1Schema,
        consentPolicy: ApplicationConsentPolicyV1Schema,
      })
      .strict(),
    target: z.record(z.string().min(1).max(128), z.json()),
    client: z
      .object({
        clientType: z.enum(["confidential", "public"]),
        tokenEndpointAuthMethod: z.enum(["client_secret_basic", "none"]),
        grantTypes: uniqueStringArraySchema(z.enum(["authorization_code", "refresh_token"]), 1),
        responseTypes: z.tuple([z.literal("code")]),
        redirectUris: uniqueStringArraySchema(redirectUriSchema, 1),
        postLogoutRedirectUris: uniqueStringArraySchema(redirectUriSchema),
        allowedScopes: uniqueStringArraySchema(scopeSchema, 1),
        allowedResources: uniqueStringArraySchema(resourceSchema),
        pkcePolicy: z.enum(["required", "optional"]),
        capabilities: z
          .object({
            refreshToken: z.boolean(),
            providerApi: z.boolean(),
            resourceServer: z.boolean(),
          })
          .strict(),
      })
      .strict()
      .superRefine((client, context) => {
        if (!client.allowedScopes.includes("openid")) {
          context.addIssue({ code: "custom", path: ["allowedScopes"], message: "必须包含 openid" });
        }
        const refreshEnabled = client.grantTypes.includes("refresh_token");
        if (
          refreshEnabled !== client.capabilities.refreshToken ||
          refreshEnabled !== client.allowedScopes.includes("offline_access")
        ) {
          context.addIssue({
            code: "custom",
            path: ["capabilities", "refreshToken"],
            message: "Refresh Token 能力、grant 与 scope 不一致",
          });
        }
        if (client.capabilities.resourceServer !== client.allowedResources.length > 0) {
          context.addIssue({
            code: "custom",
            path: ["capabilities", "resourceServer"],
            message: "Resource Server 能力与 resources 不一致",
          });
        }
        if (
          client.clientType === "public" &&
          (client.tokenEndpointAuthMethod !== "none" || client.pkcePolicy !== "required")
        ) {
          context.addIssue({
            code: "custom",
            path: ["clientType"],
            message: "public Client 必须使用 none 认证并强制 PKCE",
          });
        }
        if (
          client.clientType === "confidential" &&
          client.tokenEndpointAuthMethod !== "client_secret_basic"
        ) {
          context.addIssue({
            code: "custom",
            path: ["tokenEndpointAuthMethod"],
            message: "confidential Client 必须使用 client_secret_basic",
          });
        }
      }),
    integrationGuide: IntegrationGuideV1Schema,
    warnings: z.array(z.string().trim().min(1).max(10_000)),
  })
  .strict();

export const ApplicationTemplateSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION),
    template: ApplicationTemplateReferenceV1Schema,
    normalizedInput: z.record(z.string().min(1).max(128), z.json()),
    resolution: ResolvedApplicationTemplateSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.template.id !== snapshot.resolution.template.id ||
      snapshot.template.version !== snapshot.resolution.template.version
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolution", "template"],
        message: "模板快照引用与解析结果不一致",
      });
    }
  });

/** 持久化入口始终按 schemaVersion 分派；新增 V2 时保留 V1 分支和迁移 fixture。 */
export const ApplicationTemplateSnapshotSchema = z.discriminatedUnion("schemaVersion", [
  ApplicationTemplateSnapshotV1Schema,
]);

export type ParsedApplicationTemplateSnapshot = z.infer<typeof ApplicationTemplateSnapshotSchema>;

export const parseApplicationTemplateSnapshot = (
  input: unknown,
): ParsedApplicationTemplateSnapshot => ApplicationTemplateSnapshotSchema.parse(input);
