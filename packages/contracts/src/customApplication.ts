import { z } from "zod";
import {
  ApplicationConsentPolicyV1Schema,
  ApplicationEnvironmentV1Schema,
  ApplicationPortalInputV1Schema,
  ApplicationTrustLevelV1Schema,
  ApplicationV1Schema,
  OidcClientV1Schema,
} from "./application.js";
import { ApplicationConnectionV1Schema } from "./connection.js";
import { ApplicationCredentialV1Schema } from "./credential.js";
import { IntegrationGuideV1Schema } from "./integrationGuide.js";
import {
  addIssue,
  descriptionSchema,
  displayNameSchema,
  redirectUriSchema,
  resourceSchema,
  scopeSchema,
  slugSchema,
  uniqueStringArraySchema,
  unorderedStringArraysEqual,
  uriAllowedForEnvironment,
} from "./schemaPrimitives.js";
import {
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  CUSTOM_APPLICATION_SCHEMA_VERSION,
} from "./versions.js";

export const CustomApplicationInputV1Schema = z
  .object({
    name: displayNameSchema,
    slug: slugSchema.optional(),
    description: descriptionSchema.optional(),
    environment: ApplicationEnvironmentV1Schema,
    portal: ApplicationPortalInputV1Schema.optional(),
    owner: z.string().trim().min(1).max(320).optional(),
    trustLevel: ApplicationTrustLevelV1Schema.default("third_party"),
    consentPolicy: ApplicationConsentPolicyV1Schema.default("explicit"),
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
  });

export const CustomOidcClientInputV1Schema = z
  .object({
    clientType: z.enum(["confidential", "public"]),
    redirectUris: uniqueStringArraySchema(redirectUriSchema, 1),
    postLogoutRedirectUris: uniqueStringArraySchema(redirectUriSchema).default([]),
    scopes: uniqueStringArraySchema(scopeSchema, 1).default(["openid", "profile", "email"]),
    resources: uniqueStringArraySchema(resourceSchema).default([]),
    refreshToken: z.boolean().default(false),
    providerApi: z.boolean().default(false),
    resourceServer: z.boolean().default(false),
    pkcePolicy: z.enum(["required", "optional"]).default("required"),
  })
  .strict()
  .superRefine((client, context) => {
    if (!client.scopes.includes("openid")) {
      addIssue(context, ["scopes"], "OIDC Client 必须申请 openid scope");
    }
    if (client.refreshToken !== client.scopes.includes("offline_access")) {
      addIssue(
        context,
        ["refreshToken"],
        "refreshToken capability 必须与 offline_access scope 双向一致",
      );
    }
    if (client.resourceServer !== client.resources.length > 0) {
      addIssue(context, ["resourceServer"], "resourceServer capability 必须与 resources 配置一致");
    }
    if (client.clientType === "public" && client.pkcePolicy !== "required") {
      addIssue(context, ["pkcePolicy"], "public Client 必须强制 PKCE");
    }
  });

export const CreateCustomApplicationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(CUSTOM_APPLICATION_SCHEMA_VERSION),
    application: CustomApplicationInputV1Schema,
    client: CustomOidcClientInputV1Schema,
    credentialDelivery: z.literal("direct").default("direct"),
  })
  .strict()
  .superRefine((request, context) => {
    for (const [field, uris] of [
      ["redirectUris", request.client.redirectUris],
      ["postLogoutRedirectUris", request.client.postLogoutRedirectUris],
    ] as const) {
      uris.forEach((uri, index) => {
        if (!uriAllowedForEnvironment(uri, request.application.environment)) {
          addIssue(
            context,
            ["client", field, index],
            "生产和预发布环境必须使用 HTTPS；开发环境仅对 loopback URI 放宽 HTTP",
          );
        }
      });
    }

    if (request.application.portal !== undefined) {
      for (const field of ["launchUrl", "iconUrl"] as const) {
        const value = request.application.portal[field];
        if (
          value !== undefined &&
          !uriAllowedForEnvironment(value, request.application.environment)
        ) {
          addIssue(
            context,
            ["application", "portal", field],
            "生产和预发布环境必须使用 HTTPS；开发环境仅对 loopback URL 放宽 HTTP",
          );
        }
      }
    }
  });

export const DirectCredentialDeliveryV1Schema = z
  .object({
    kind: z.literal("direct"),
    credential: ApplicationCredentialV1Schema,
  })
  .strict();

export const CreateCustomApplicationResponseV1Schema = z
  .object({
    schemaVersion: z.literal(CUSTOM_APPLICATION_SCHEMA_VERSION),
    application: ApplicationV1Schema,
    client: OidcClientV1Schema,
    connection: ApplicationConnectionV1Schema,
    credentialDelivery: DirectCredentialDeliveryV1Schema,
    integrationGuide: IntegrationGuideV1Schema,
  })
  .strict()
  .superRefine((response, context) => {
    if (response.client.applicationId !== response.application.id) {
      addIssue(context, ["client", "applicationId"], "Client 必须属于响应中的 Application");
    }
    if (response.connection.applicationId !== response.application.id) {
      addIssue(context, ["connection", "applicationId"], "Connection 的 Application ID 不匹配");
    }
    if (response.connection.oidcClientId !== response.client.id) {
      addIssue(context, ["connection", "oidcClientId"], "Connection 的 OIDC Client ID 不匹配");
    }
    if (response.connection.clientId !== response.client.clientId) {
      addIssue(context, ["connection", "clientId"], "Connection 的 client_id 不匹配");
    }
    if (response.connection.clientType !== response.client.clientType) {
      addIssue(context, ["connection", "clientType"], "Connection 的 Client 类型不匹配");
    }
    if (response.connection.clientAuthMethod !== response.client.tokenEndpointAuthMethod) {
      addIssue(context, ["connection", "clientAuthMethod"], "Connection 的 Client 认证方式不匹配");
    }

    for (const [connectionField, clientField] of [
      ["redirectUris", "redirectUris"],
      ["postLogoutRedirectUris", "postLogoutRedirectUris"],
      ["scopes", "allowedScopes"],
      ["resources", "allowedResources"],
    ] as const) {
      if (
        !unorderedStringArraysEqual(
          response.connection[connectionField],
          response.client[clientField],
        )
      ) {
        addIssue(
          context,
          ["connection", connectionField],
          `Connection 的 ${connectionField} 与 Client 投影不匹配`,
        );
      }
    }

    if (response.connection.pkce.policy !== response.client.pkcePolicy) {
      addIssue(context, ["connection", "pkce", "policy"], "Connection 的 PKCE 策略不匹配");
    }
    if (response.connection.capabilities.providerApi !== response.client.capabilities.providerApi) {
      addIssue(
        context,
        ["connection", "capabilities", "providerApi"],
        "Connection 的 Provider API capability 不匹配",
      );
    }
    if (
      response.connection.capabilities.refreshToken !==
      response.client.grantTypes.includes("refresh_token")
    ) {
      addIssue(
        context,
        ["connection", "capabilities", "refreshToken"],
        "Connection 的 refresh token capability 不匹配",
      );
    }
    if (
      response.connection.capabilities.resourceServer !==
      response.client.allowedResources.length > 0
    ) {
      addIssue(
        context,
        ["connection", "capabilities", "resourceServer"],
        "Connection 的 resource server capability 不匹配",
      );
    }

    if (response.application.source.kind === "template") {
      if (
        response.connection.template?.id !== response.application.source.templateId ||
        response.connection.template.version !== response.application.source.templateVersion
      ) {
        addIssue(context, ["connection", "template"], "Connection 的模板版本不匹配");
      }
    } else if (response.connection.template) {
      addIssue(context, ["connection", "template"], "非模板应用不能携带模板引用");
    }

    response.client.redirectUris.forEach((uri, index) => {
      if (!uriAllowedForEnvironment(uri, response.application.environment)) {
        addIssue(
          context,
          ["client", "redirectUris", index],
          "响应中的 redirect URI 不符合应用环境安全策略",
        );
      }
    });
    response.client.postLogoutRedirectUris.forEach((uri, index) => {
      if (!uriAllowedForEnvironment(uri, response.application.environment)) {
        addIssue(
          context,
          ["client", "postLogoutRedirectUris", index],
          "响应中的 post logout URI 不符合应用环境安全策略",
        );
      }
    });

    const expectedKind = response.client.clientType === "public" ? "none" : "client_secret";
    if (response.credentialDelivery.credential.kind !== expectedKind) {
      addIssue(
        context,
        ["credentialDelivery", "credential", "kind"],
        "Credential 类型必须与 OIDC Client 类型一致",
      );
    }

    for (const field of ["applicationId", "oidcClientId", "issuer", "clientId"] as const) {
      if (response.credentialDelivery.credential[field] !== response.connection[field]) {
        addIssue(
          context,
          ["credentialDelivery", "credential", field],
          `Credential 的 ${field} 与 Connection 不匹配`,
        );
      }
    }

    if (response.credentialDelivery.credential.kind === "client_secret") {
      const publicPayloadJson = JSON.stringify({
        application: response.application,
        connection: response.connection,
        integrationGuide: response.integrationGuide,
      });
      const serializedSecret = JSON.stringify(
        response.credentialDelivery.credential.clientSecret,
      ).slice(1, -1);
      if (publicPayloadJson.includes(serializedSecret)) {
        addIssue(
          context,
          ["credentialDelivery", "credential", "clientSecret"],
          "client_secret 不能出现在公开 Application、Connection 或 IntegrationGuide 中",
        );
      }
    }
  });

export const AlreadyDeliveredCredentialV1Schema = z
  .object({ kind: z.literal("already_delivered") })
  .strict();

/**
 * 同一幂等请求的安全重放响应。它保留可重复读取的连接信息，但绝不再次返回 Secret。
 */
export const CreateCustomApplicationReceiptV1Schema = z
  .object({
    schemaVersion: z.literal(CUSTOM_APPLICATION_SCHEMA_VERSION),
    application: ApplicationV1Schema,
    client: OidcClientV1Schema,
    connection: ApplicationConnectionV1Schema,
    credentialDelivery: AlreadyDeliveredCredentialV1Schema,
    integrationGuide: IntegrationGuideV1Schema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const validation = CreateCustomApplicationResponseV1Schema.safeParse({
      ...receipt,
      credentialDelivery: {
        kind: "direct",
        credential:
          receipt.client.clientType === "public"
            ? {
                schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
                applicationId: receipt.connection.applicationId,
                oidcClientId: receipt.connection.oidcClientId,
                issuer: receipt.connection.issuer,
                clientId: receipt.connection.clientId,
                kind: "none",
              }
            : {
                schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
                applicationId: receipt.connection.applicationId,
                oidcClientId: receipt.connection.oidcClientId,
                issuer: receipt.connection.issuer,
                clientId: receipt.connection.clientId,
                kind: "client_secret",
                clientSecret: "receipt-validation-placeholder",
              },
      },
    });
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        if (issue.path.join(".") === "credentialDelivery.credential.clientSecret") {
          continue;
        }
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      }
    }
  });

export const CreateCustomApplicationOutcomeResponseV1Schema = z.union([
  CreateCustomApplicationResponseV1Schema,
  CreateCustomApplicationReceiptV1Schema,
]);

export type CustomApplicationInputV1 = z.input<typeof CustomApplicationInputV1Schema>;
export type NormalizedCustomApplicationInputV1 = z.output<typeof CustomApplicationInputV1Schema>;
export type CustomOidcClientInputV1 = z.input<typeof CustomOidcClientInputV1Schema>;
export type NormalizedCustomOidcClientInputV1 = z.output<typeof CustomOidcClientInputV1Schema>;
export type CreateCustomApplicationRequestV1 = z.input<
  typeof CreateCustomApplicationRequestV1Schema
>;
export type NormalizedCreateCustomApplicationRequestV1 = z.output<
  typeof CreateCustomApplicationRequestV1Schema
>;
export type DirectCredentialDeliveryV1 = z.infer<typeof DirectCredentialDeliveryV1Schema>;
export type CreateCustomApplicationResponseV1 = z.infer<
  typeof CreateCustomApplicationResponseV1Schema
>;
export type CreateCustomApplicationReceiptV1 = z.infer<
  typeof CreateCustomApplicationReceiptV1Schema
>;
export type CreateCustomApplicationOutcomeResponseV1 = z.infer<
  typeof CreateCustomApplicationOutcomeResponseV1Schema
>;

export const parseCreateCustomApplicationRequestV1 = (
  input: unknown,
): NormalizedCreateCustomApplicationRequestV1 =>
  CreateCustomApplicationRequestV1Schema.parse(input);

export const safeParseCreateCustomApplicationRequestV1 = (input: unknown) =>
  CreateCustomApplicationRequestV1Schema.safeParse(input);

export const parseCreateCustomApplicationResponseV1 = (
  input: unknown,
): CreateCustomApplicationResponseV1 => CreateCustomApplicationResponseV1Schema.parse(input);

export const safeParseCreateCustomApplicationResponseV1 = (input: unknown) =>
  CreateCustomApplicationResponseV1Schema.safeParse(input);

export const parseCreateCustomApplicationOutcomeResponseV1 = (
  input: unknown,
): CreateCustomApplicationOutcomeResponseV1 =>
  CreateCustomApplicationOutcomeResponseV1Schema.parse(input);

export const safeParseCreateCustomApplicationOutcomeResponseV1 = (input: unknown) =>
  CreateCustomApplicationOutcomeResponseV1Schema.safeParse(input);
