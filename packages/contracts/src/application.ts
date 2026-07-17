import { z } from "zod";
import {
  addIssue,
  clientIdSchema,
  descriptionSchema,
  displayNameSchema,
  identifierSchema,
  isoDateTimeSchema,
  portalUrlSchema,
  redirectUriSchema,
  resourceSchema,
  scopeSchema,
  slugSchema,
  uniqueStringArraySchema,
  uriAllowedForEnvironment,
} from "./schemaPrimitives.js";
import { CUSTOM_APPLICATION_SCHEMA_VERSION } from "./versions.js";

export const ApplicationStatusV1Schema = z.enum([
  "draft",
  "active",
  "disabling",
  "disabled",
  "deleted",
]);
export const ApplicationEnvironmentV1Schema = z.enum(["development", "staging", "production"]);
export const ApplicationTrustLevelV1Schema = z.enum(["first_party", "third_party"]);
export const ApplicationConsentPolicyV1Schema = z.enum(["explicit", "skip_for_trusted"]);

export const ApplicationPortalV1Schema = z
  .object({
    enabled: z.boolean(),
    launchUrl: portalUrlSchema,
    iconUrl: portalUrlSchema.optional(),
    order: z.number().int().min(0).max(1_000_000),
  })
  .strict();

/** 创建请求允许省略安全默认值，持久化的 ApplicationPortalV1 始终是完整对象。 */
export const ApplicationPortalInputV1Schema = z
  .object({
    enabled: z.boolean().default(true),
    launchUrl: portalUrlSchema,
    iconUrl: portalUrlSchema.optional(),
    order: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

export const ApplicationSourceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("template"),
      templateId: identifierSchema,
      templateVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      schemaVersion: z.literal(CUSTOM_APPLICATION_SCHEMA_VERSION),
    })
    .strict(),
  z.object({ kind: z.literal("system") }).strict(),
]);

export const ApplicationV1Schema = z
  .object({
    id: identifierSchema,
    name: displayNameSchema,
    slug: slugSchema,
    description: descriptionSchema.optional(),
    status: ApplicationStatusV1Schema,
    source: ApplicationSourceV1Schema,
    trustLevel: ApplicationTrustLevelV1Schema,
    consentPolicy: ApplicationConsentPolicyV1Schema,
    environment: ApplicationEnvironmentV1Schema,
    portal: ApplicationPortalV1Schema.optional(),
    owner: z.string().trim().min(1).max(320).optional(),
    version: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((application, context) => {
    if (
      application.consentPolicy === "skip_for_trusted" &&
      application.trustLevel !== "first_party"
    ) {
      addIssue(
        context,
        ["consentPolicy"],
        "只有 first_party 应用可以使用 skip_for_trusted consent 策略",
      );
    }

    if (application.portal !== undefined) {
      for (const field of ["launchUrl", "iconUrl"] as const) {
        const value = application.portal[field];
        if (value !== undefined && !uriAllowedForEnvironment(value, application.environment)) {
          addIssue(
            context,
            ["portal", field],
            "生产和预发布环境必须使用 HTTPS；开发环境仅对 loopback URL 放宽 HTTP",
          );
        }
      }
    }
  });

export const OidcClientV1Schema = z
  .object({
    id: identifierSchema,
    applicationId: identifierSchema,
    clientId: clientIdSchema,
    clientType: z.enum(["confidential", "public"]),
    tokenEndpointAuthMethod: z.enum(["client_secret_basic", "none"]),
    grantTypes: uniqueStringArraySchema(z.enum(["authorization_code", "refresh_token"]), 1),
    responseTypes: z.tuple([z.literal("code")]),
    redirectUris: uniqueStringArraySchema(redirectUriSchema, 1),
    postLogoutRedirectUris: uniqueStringArraySchema(redirectUriSchema),
    allowedScopes: uniqueStringArraySchema(scopeSchema, 1),
    allowedResources: uniqueStringArraySchema(resourceSchema),
    pkcePolicy: z.enum(["required", "optional"]),
    capabilities: z.object({ providerApi: z.boolean() }).strict(),
    status: z.enum(["active", "disabled"]),
  })
  .strict()
  .superRefine((client, context) => {
    if (!client.grantTypes.includes("authorization_code")) {
      addIssue(context, ["grantTypes"], "OIDC Client 必须启用 authorization_code grant");
    }
    if (!client.allowedScopes.includes("openid")) {
      addIssue(context, ["allowedScopes"], "OIDC Client 必须允许 openid scope");
    }
    if (
      client.grantTypes.includes("refresh_token") !==
      client.allowedScopes.includes("offline_access")
    ) {
      addIssue(context, ["grantTypes"], "refresh_token grant 必须与 offline_access scope 双向一致");
    }

    if (client.clientType === "public") {
      if (client.tokenEndpointAuthMethod !== "none") {
        addIssue(context, ["tokenEndpointAuthMethod"], "public Client 必须使用 none 认证方式");
      }
      if (client.pkcePolicy !== "required") {
        addIssue(context, ["pkcePolicy"], "public Client 必须强制 PKCE");
      }
    } else if (client.tokenEndpointAuthMethod !== "client_secret_basic") {
      addIssue(
        context,
        ["tokenEndpointAuthMethod"],
        "confidential Client 必须使用 client_secret_basic 认证方式",
      );
    }
  });

export type ApplicationStatusV1 = z.infer<typeof ApplicationStatusV1Schema>;
export type ApplicationEnvironmentV1 = z.infer<typeof ApplicationEnvironmentV1Schema>;
export type ApplicationTrustLevelV1 = z.infer<typeof ApplicationTrustLevelV1Schema>;
export type ApplicationConsentPolicyV1 = z.infer<typeof ApplicationConsentPolicyV1Schema>;
export type ApplicationPortalV1 = z.infer<typeof ApplicationPortalV1Schema>;
export type ApplicationPortalInputV1 = z.input<typeof ApplicationPortalInputV1Schema>;
export type NormalizedApplicationPortalInputV1 = z.output<typeof ApplicationPortalInputV1Schema>;
export type ApplicationSourceV1 = z.infer<typeof ApplicationSourceV1Schema>;
export type ApplicationV1 = z.infer<typeof ApplicationV1Schema>;
export type OidcClientV1 = z.infer<typeof OidcClientV1Schema>;

export const parseApplicationV1 = (input: unknown): ApplicationV1 =>
  ApplicationV1Schema.parse(input);
export const safeParseApplicationV1 = (input: unknown) => ApplicationV1Schema.safeParse(input);
export const parseOidcClientV1 = (input: unknown): OidcClientV1 => OidcClientV1Schema.parse(input);
export const safeParseOidcClientV1 = (input: unknown) => OidcClientV1Schema.safeParse(input);
