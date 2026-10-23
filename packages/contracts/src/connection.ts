import { z } from "zod";
import {
  addIssue,
  clientIdSchema,
  identifierSchema,
  issuerUrlSchema,
  redirectUriSchema,
  resourceSchema,
  scopeSchema,
  uniqueStringArraySchema,
} from "./schemaPrimitives.js";
import { APPLICATION_CONNECTION_SCHEMA_VERSION } from "./versions.js";

export const ApplicationConnectionV1Schema = z
  .object({
    schemaVersion: z.literal(APPLICATION_CONNECTION_SCHEMA_VERSION),
    applicationId: identifierSchema,
    oidcClientId: identifierSchema,
    issuer: issuerUrlSchema,
    clientId: clientIdSchema,
    clientType: z.enum(["confidential", "public"]),
    clientAuthMethod: z.enum(["client_secret_basic", "none"]),
    redirectUris: uniqueStringArraySchema(redirectUriSchema, 1),
    postLogoutRedirectUris: uniqueStringArraySchema(redirectUriSchema),
    scopes: uniqueStringArraySchema(scopeSchema, 1),
    resources: uniqueStringArraySchema(resourceSchema),
    flow: z.literal("authorization_code"),
    pkce: z
      .object({
        policy: z.enum(["required", "optional"]),
        methods: z.tuple([z.literal("S256")]),
      })
      .strict(),
    template: z
      .object({
        id: identifierSchema,
        version: z.number().int().positive(),
      })
      .strict()
      .optional(),
    capabilities: z
      .object({
        refreshToken: z.boolean(),
        providerApi: z.boolean(),
        resourceServer: z.boolean(),
      })
      .strict(),
    recommendedConnector: z
      .object({
        packageName: z.string().trim().min(1).max(214),
        minimumVersion: z.string().trim().min(1).max(64),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((connection, context) => {
    if (!connection.scopes.includes("openid")) {
      addIssue(context, ["scopes"], "OIDC 连接必须包含 openid scope");
    }

    if (connection.clientType === "public") {
      if (connection.clientAuthMethod !== "none") {
        addIssue(context, ["clientAuthMethod"], "public Client 必须使用 none 认证方式");
      }
      if (connection.pkce.policy !== "required") {
        addIssue(context, ["pkce", "policy"], "public Client 必须强制 PKCE");
      }
    } else if (connection.clientAuthMethod !== "client_secret_basic") {
      addIssue(
        context,
        ["clientAuthMethod"],
        "confidential Client 必须使用 client_secret_basic 认证方式",
      );
    }

    if (connection.capabilities.refreshToken !== connection.scopes.includes("offline_access")) {
      addIssue(
        context,
        ["capabilities", "refreshToken"],
        "refreshToken capability 必须与 offline_access scope 双向一致",
      );
    }

    if (connection.capabilities.resourceServer !== connection.resources.length > 0) {
      addIssue(
        context,
        ["capabilities", "resourceServer"],
        "resourceServer capability 必须与 resources 配置一致",
      );
    }
  });

export type ApplicationConnectionV1 = z.infer<typeof ApplicationConnectionV1Schema>;

/**
 * 校验可重复读取的连接描述。schema 使用 strict object，明文 Secret 或其他未知字段会被拒绝。
 */
export const parseApplicationConnectionV1 = (input: unknown): ApplicationConnectionV1 =>
  ApplicationConnectionV1Schema.parse(input);

export const safeParseApplicationConnectionV1 = (input: unknown) =>
  ApplicationConnectionV1Schema.safeParse(input);
