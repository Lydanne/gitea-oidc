import { describe, expect, it } from "vitest";
import {
  APPLICATION_CONNECTION_SCHEMA_VERSION,
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  type ApplicationConnectionV1,
  ApplicationTemplateSummaryV1Schema,
  type ApplicationV1,
  CUSTOM_APPLICATION_SCHEMA_VERSION,
  INTEGRATION_GUIDE_SCHEMA_VERSION,
  type IntegrationGuideV1,
  type OidcClientV1,
  parseApplicationConnectionV1,
  parseApplicationCredentialV1,
  parseApplicationDetailsListV1,
  parseCreateCustomApplicationRequestV1,
  parseCreateTemplateApplicationRequestV1,
  parsePortalApplicationListV1,
  parsePreviewApplicationTemplateRequestV1,
  parseRotateApplicationCredentialRequestV1,
  safeParseApplicationConnectionV1,
  safeParseApplicationDetailsV1,
  safeParseApplicationV1,
  safeParseCreateCustomApplicationOutcomeResponseV1,
  safeParseCreateCustomApplicationRequestV1,
  safeParseCreateCustomApplicationResponseV1,
  safeParseCreateTemplateApplicationOutcomeResponseV1,
  safeParseCreateTemplateApplicationRequestV1,
  safeParseIntegrationGuideV1,
  safeParseOidcClientV1,
  safeParsePortalApplicationV1,
  safeParseRotateApplicationCredentialRequestV1,
  safeParseRotateApplicationCredentialResponseV1,
} from "../index.js";

const application: ApplicationV1 = {
  id: "app_01",
  name: "示例应用",
  slug: "example-app",
  status: "active",
  source: { kind: "custom", schemaVersion: 1 },
  trustLevel: "third_party",
  consentPolicy: "explicit",
  environment: "development",
  version: 1,
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

const client: OidcClientV1 = {
  id: "oidc_client_01",
  applicationId: application.id,
  clientId: "client_01",
  clientType: "confidential",
  tokenEndpointAuthMethod: "client_secret_basic",
  grantTypes: ["authorization_code"],
  responseTypes: ["code"],
  redirectUris: ["http://127.0.0.1:3000/oidc/callback"],
  postLogoutRedirectUris: [],
  allowedScopes: ["openid", "profile", "email"],
  allowedResources: [],
  pkcePolicy: "required",
  capabilities: { providerApi: false },
  status: "active",
};

const connection: ApplicationConnectionV1 = {
  schemaVersion: APPLICATION_CONNECTION_SCHEMA_VERSION,
  applicationId: application.id,
  oidcClientId: client.id,
  issuer: "https://id.example.com",
  clientId: client.clientId,
  clientType: "confidential",
  clientAuthMethod: "client_secret_basic",
  redirectUris: client.redirectUris,
  postLogoutRedirectUris: [],
  scopes: client.allowedScopes,
  resources: [],
  flow: "authorization_code",
  pkce: { policy: "required", methods: ["S256"] },
  capabilities: {
    refreshToken: false,
    providerApi: false,
    resourceServer: false,
  },
  recommendedConnector: {
    packageName: "@gitea-oidc/node",
    minimumVersion: "0.1.0",
  },
};

const credentialBinding = {
  schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  applicationId: connection.applicationId,
  oidcClientId: connection.oidcClientId,
  issuer: connection.issuer,
  clientId: connection.clientId,
} as const;

const credential = {
  ...credentialBinding,
  kind: "client_secret" as const,
  clientSecret: "one-time-secret-value",
};

const integrationGuide: IntegrationGuideV1 = {
  schemaVersion: INTEGRATION_GUIDE_SCHEMA_VERSION,
  title: "Node.js 接入",
  nodes: [
    { kind: "heading", level: 2, text: "配置环境变量" },
    { kind: "field", label: "Issuer", value: connection.issuer, copyable: true },
    { kind: "code", language: "dotenv", code: "OIDC_ISSUER=https://id.example.com" },
    { kind: "steps", items: ["安装连接器", "配置回调路由"] },
  ],
};

describe("ApplicationConnectionV1", () => {
  it("parses a repeatable connection without credentials", () => {
    const parsed = parseApplicationConnectionV1(connection);

    expect(parsed).toEqual(connection);
    expect(JSON.stringify(parsed)).not.toContain("clientSecret");
  });

  it("rejects a client secret at the top level instead of stripping it silently", () => {
    const result = safeParseApplicationConnectionV1({
      ...connection,
      clientSecret: "must-not-leak",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown fields in nested connection objects", () => {
    const result = safeParseApplicationConnectionV1({
      ...connection,
      capabilities: {
        ...connection.capabilities,
        secret: "must-not-leak",
      },
    });

    expect(result.success).toBe(false);
  });

  it("enforces public Client authentication and PKCE invariants", () => {
    const result = safeParseApplicationConnectionV1({
      ...connection,
      clientType: "public",
      clientAuthMethod: "client_secret_basic",
      pkce: { policy: "optional", methods: ["S256"] },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["non-HTTP issuer", { issuer: "javascript:alert(1)" }],
    ["issuer userinfo", { issuer: "https://user:password@id.example.com" }],
    ["issuer fragment", { issuer: "https://id.example.com/#fragment" }],
    ["issuer wildcard", { issuer: "https://*.example.com" }],
    ["non-loopback HTTP issuer", { issuer: "http://id.example.com" }],
    ["non-loopback HTTP callback", { redirectUris: ["http://app.example.com/callback"] }],
    ["callback fragment", { redirectUris: ["https://app.example.com/callback#fragment"] }],
    ["callback query", { redirectUris: ["https://app.example.com/callback?tenant=one"] }],
    [
      "post logout callback query",
      { postLogoutRedirectUris: ["https://app.example.com/signed-out?tenant=one"] },
    ],
    ["callback userinfo", { redirectUris: ["https://user@app.example.com/callback"] }],
    ["callback wildcard", { redirectUris: ["https://*.example.com/callback"] }],
    ["trimmed callback", { redirectUris: [" https://app.example.com/callback"] }],
    ["client_id control character", { clientId: "client\nspoof" }],
    ["trimmed scope", { scopes: ["openid "] }],
  ])("rejects %s", (_name, override) => {
    expect(safeParseApplicationConnectionV1({ ...connection, ...override }).success).toBe(false);
  });

  it("keeps refresh capability and offline_access scope bidirectionally aligned", () => {
    expect(
      safeParseApplicationConnectionV1({
        ...connection,
        scopes: [...connection.scopes, "offline_access"],
      }).success,
    ).toBe(false);
    expect(
      safeParseApplicationConnectionV1({
        ...connection,
        capabilities: { ...connection.capabilities, refreshToken: true },
      }).success,
    ).toBe(false);
  });
});

describe("ApplicationCredentialV1", () => {
  it("keeps one-time credentials separate from connection metadata", () => {
    expect(
      parseApplicationCredentialV1({
        ...credential,
      }),
    ).toEqual(credential);
    expect(parseApplicationCredentialV1({ ...credentialBinding, kind: "none" })).toEqual({
      ...credentialBinding,
      kind: "none",
    });
  });

  it("rejects a bare client secret without connection binding", () => {
    expect(() =>
      parseApplicationCredentialV1({
        kind: "client_secret",
        clientSecret: "one-time-secret-value",
      }),
    ).toThrow();
  });
});

describe("ApplicationDetailsV1", () => {
  const secret = {
    id: "secret-1",
    oidcClientId: client.id,
    keyId: "applications-v1",
    fingerprint: `hmac-sha256:${"a".repeat(24)}`,
    status: "active" as const,
    deliveredAt: "2026-07-10T08:00:00.000Z",
    createdAt: "2026-07-10T08:00:00.000Z",
  };

  it("parses the shared single-Client management response", () => {
    expect(
      parseApplicationDetailsListV1([{ application, clients: [client], secrets: [secret] }]),
    ).toEqual([{ application, clients: [client], secrets: [secret] }]);
  });

  it("rejects multiple Clients, foreign Secrets and public active Secrets", () => {
    expect(
      safeParseApplicationDetailsV1({
        application,
        clients: [client, { ...client, id: "client-2", clientId: "client-2" }],
        secrets: [secret],
      }).success,
    ).toBe(false);
    expect(
      safeParseApplicationDetailsV1({
        application,
        clients: [client],
        secrets: [{ ...secret, oidcClientId: "foreign-client" }],
      }).success,
    ).toBe(false);
    expect(
      safeParseApplicationDetailsV1({
        application,
        clients: [
          {
            ...client,
            clientType: "public",
            tokenEndpointAuthMethod: "none",
          },
        ],
        secrets: [secret],
      }).success,
    ).toBe(false);
  });
});

describe("custom application DTOs", () => {
  it("normalizes safe defaults for a custom application request", () => {
    const parsed = parseCreateCustomApplicationRequestV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application: {
        name: "示例应用",
        environment: "development",
        portal: {
          launchUrl: "http://127.0.0.1:3000/?from=portal",
        },
      },
      client: {
        clientType: "confidential",
        redirectUris: ["http://127.0.0.1:3000/oidc/callback"],
      },
    });

    expect(parsed.application).toMatchObject({
      trustLevel: "third_party",
      consentPolicy: "explicit",
      portal: {
        enabled: true,
        launchUrl: "http://127.0.0.1:3000/?from=portal",
        order: 0,
      },
    });
    expect(parsed.client).toMatchObject({
      scopes: ["openid", "profile", "email"],
      refreshToken: false,
      resourceServer: false,
      pkcePolicy: "required",
    });
    expect(parsed.credentialDelivery).toBe("direct");
  });

  it.each([
    ["production HTTP launch URL", "production", { launchUrl: "http://127.0.0.1:3000" }],
    [
      "staging HTTP icon URL",
      "staging",
      { launchUrl: "https://app.example.com", iconUrl: "http://127.0.0.1/icon.png" },
    ],
    ["development non-loopback HTTP", "development", { launchUrl: "http://app.example.com" }],
    ["non-HTTP launch URL", "development", { launchUrl: "javascript:alert(1)" }],
    ["launch URL credentials", "production", { launchUrl: "https://user:pass@app.example.com" }],
    ["launch URL fragment", "production", { launchUrl: "https://app.example.com/#private" }],
  ])("rejects portal %s", (_name, environment, portal) => {
    expect(
      safeParseCreateCustomApplicationRequestV1({
        schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
        application: { name: "示例应用", environment, portal },
        client: {
          clientType: "confidential",
          redirectUris: [
            environment === "development"
              ? "http://127.0.0.1:3000/oidc/callback"
              : "https://app.example.com/oidc/callback",
          ],
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["production loopback HTTP", "production", "http://127.0.0.1:3000/callback"],
    ["staging loopback HTTP", "staging", "http://127.0.0.1:3000/callback"],
    ["development non-loopback HTTP", "development", "http://app.example.com/callback"],
  ])("rejects %s", (_name, environment, redirectUri) => {
    const result = safeParseCreateCustomApplicationRequestV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application: { name: "示例应用", environment },
      client: { clientType: "confidential", redirectUris: [redirectUri] },
    });

    expect(result.success).toBe(false);
  });

  it("does not advertise the unfinished setup code protocol", () => {
    expect(
      safeParseCreateCustomApplicationRequestV1({
        schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
        application: { name: "示例应用", environment: "development" },
        client: {
          clientType: "confidential",
          redirectUris: ["http://127.0.0.1:3000/oidc/callback"],
        },
        credentialDelivery: "setup_code",
      }).success,
    ).toBe(false);
  });

  it("accepts a consistent direct-delivery response", () => {
    const result = safeParseCreateCustomApplicationResponseV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application,
      client,
      connection,
      credentialDelivery: {
        kind: "direct",
        credential,
      },
      integrationGuide,
    });

    expect(result.success).toBe(true);
  });

  it("rejects mismatched aggregate identifiers and credential kinds", () => {
    const result = safeParseCreateCustomApplicationResponseV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application,
      client: { ...client, applicationId: "another-app" },
      connection,
      credentialDelivery: {
        kind: "direct",
        credential: { ...credentialBinding, kind: "none" },
      },
      integrationGuide,
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["client auth method", { clientAuthMethod: "none" }],
    ["redirect URIs", { redirectUris: ["https://different.example.com/callback"] }],
    ["post logout URIs", { postLogoutRedirectUris: ["https://app.example.com/logout"] }],
    ["scopes", { scopes: ["openid", "email"] }],
    ["resources", { resources: ["https://api.example.com"] }],
    ["PKCE", { pkce: { policy: "optional", methods: ["S256"] } }],
    [
      "provider API capability",
      { capabilities: { ...connection.capabilities, providerApi: true } },
    ],
  ])("rejects a response with inconsistent %s", (_name, connectionOverride) => {
    const result = safeParseCreateCustomApplicationResponseV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application,
      client,
      connection: { ...connection, ...connectionOverride },
      credentialDelivery: {
        kind: "direct",
        credential,
      },
      integrationGuide,
    });

    expect(result.success).toBe(false);
  });

  it.each([
    "one-time-secret-value",
    'one"time-secret-value',
  ])("rejects client secret %s copied into the public integration guide", (clientSecret) => {
    const result = safeParseCreateCustomApplicationResponseV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application,
      client,
      connection,
      credentialDelivery: {
        kind: "direct",
        credential: { ...credential, clientSecret },
      },
      integrationGuide: {
        ...integrationGuide,
        nodes: [{ kind: "field", label: "Client Secret", value: clientSecret }],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a credential bound to another connection", () => {
    const result = safeParseCreateCustomApplicationResponseV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application,
      client,
      connection,
      credentialDelivery: {
        kind: "direct",
        credential: { ...credential, oidcClientId: "another-client" },
      },
      integrationGuide,
    });

    expect(result.success).toBe(false);
  });

  it("rejects setup code delivery in a V1 response", () => {
    const result = safeParseCreateCustomApplicationResponseV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application,
      client,
      connection,
      credentialDelivery: {
        kind: "setup_code",
        setupCode: "a".repeat(32),
        expiresAt: "2025-01-01T00:00:00Z",
      },
      integrationGuide,
    });

    expect(result.success).toBe(false);
  });

  it("accepts an idempotent replay receipt without returning a credential", () => {
    const result = safeParseCreateCustomApplicationOutcomeResponseV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application,
      client,
      connection,
      credentialDelivery: { kind: "already_delivered" },
      integrationGuide,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.stringify(result.data)).not.toContain("clientSecret");
    }
  });
});

describe("credential rotation DTOs", () => {
  it("requires an exact schema version and optimistic application version", () => {
    expect(
      parseRotateApplicationCredentialRequestV1({
        schemaVersion: 1,
        expectedVersion: 2,
      }),
    ).toEqual({ schemaVersion: 1, expectedVersion: 2 });
    expect(
      safeParseRotateApplicationCredentialRequestV1({
        schemaVersion: 1,
        expectedVersion: 2,
        clientSecret: "must-not-be-accepted",
      }).success,
    ).toBe(false);
    expect(
      safeParseRotateApplicationCredentialRequestV1({
        schemaVersion: 99,
        expectedVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("accepts only confidential non-system direct-delivery responses", () => {
    expect(
      safeParseRotateApplicationCredentialResponseV1({
        schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
        application,
        client,
        connection,
        credentialDelivery: { kind: "direct", credential },
        integrationGuide,
      }).success,
    ).toBe(true);
    expect(
      safeParseRotateApplicationCredentialResponseV1({
        schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
        application: { ...application, source: { kind: "system" } },
        client,
        connection,
        credentialDelivery: { kind: "direct", credential },
        integrationGuide,
      }).success,
    ).toBe(false);
    expect(
      safeParseRotateApplicationCredentialResponseV1({
        schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
        application,
        client: {
          ...client,
          clientType: "public",
          tokenEndpointAuthMethod: "none",
          pkcePolicy: "required",
        },
        connection: {
          ...connection,
          clientType: "public",
          clientAuthMethod: "none",
        },
        credentialDelivery: {
          kind: "direct",
          credential: { ...credentialBinding, kind: "none" },
        },
        integrationGuide,
      }).success,
    ).toBe(false);
  });
});

describe("ApplicationV1", () => {
  it("keeps legacy records compatible and validates portal URLs against environment", () => {
    expect(safeParseApplicationV1(application).success).toBe(true);
    expect(
      safeParseApplicationV1({
        ...application,
        environment: "production",
        portal: {
          enabled: true,
          launchUrl: "https://app.example.com/?from=portal",
          iconUrl: "https://cdn.example.com/app.svg",
          order: 10,
        },
      }).success,
    ).toBe(true);
    expect(
      safeParseApplicationV1({
        ...application,
        environment: "production",
        portal: {
          enabled: true,
          launchUrl: "http://127.0.0.1:3000",
          order: 10,
        },
      }).success,
    ).toBe(false);
  });

  it("does not expose arbitrary template input or snapshots", () => {
    expect(
      safeParseApplicationV1({
        ...application,
        templateInput: { clientSecret: "must-not-leak" },
      }).success,
    ).toBe(false);
    expect(
      safeParseApplicationV1({
        ...application,
        templateSnapshot: { credential: "must-not-leak" },
      }).success,
    ).toBe(false);
  });
});

describe("template application DTOs", () => {
  it("parses an exact template reference and JSON-safe input", () => {
    const parsed = parseCreateTemplateApplicationRequestV1({
      schemaVersion: 1,
      template: { id: "gitea", version: 1 },
      application: {
        name: "研发 Gitea",
        portal: { launchUrl: "https://git.example.com", order: 20 },
      },
      templateInput: {
        giteaBaseUrl: "https://git.example.com",
        targetVersion: "1.26",
      },
    });

    expect(parsed).toMatchObject({
      template: { id: "gitea", version: 1 },
      application: {
        portal: { enabled: true, launchUrl: "https://git.example.com", order: 20 },
      },
      credentialDelivery: "direct",
    });
    expect(
      parsePreviewApplicationTemplateRequestV1({
        schemaVersion: 1,
        template: { id: "gitea", version: 1 },
        templateInput: parsed.templateInput,
      }),
    ).toMatchObject({ template: { id: "gitea", version: 1 } });
  });

  it("validates a generic immutable form descriptor", () => {
    expect(
      ApplicationTemplateSummaryV1Schema.safeParse({
        reference: { id: "gitea", version: 1 },
        name: "Gitea",
        description: "Gitea OIDC 模板",
        supportedVersions: ["1.26"],
        form: {
          fields: [
            { kind: "url", name: "baseUrl", label: "Base URL", required: true },
            {
              kind: "select",
              name: "version",
              label: "版本",
              required: true,
              options: [{ label: "1.26", value: "1.26" }],
            },
            {
              kind: "textarea",
              name: "groupTeamMap",
              label: "组到团队映射",
              required: false,
              rows: 5,
            },
            {
              kind: "checkbox",
              name: "syncEnabled",
              label: "启用用户同步",
              required: true,
              defaultValue: true,
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects prototype-pollution keys and non-JSON template input", () => {
    expect(
      safeParseCreateTemplateApplicationRequestV1({
        schemaVersion: 1,
        template: { id: "gitea", version: 1 },
        application: { name: "研发 Gitea" },
        templateInput: JSON.parse('{"__proto__":{"polluted":true}}'),
      }).success,
    ).toBe(false);
    expect(
      safeParseCreateTemplateApplicationRequestV1({
        schemaVersion: 1,
        template: { id: "gitea", version: 1 },
        application: { name: "研发 Gitea" },
        templateInput: { callback: () => undefined },
      }).success,
    ).toBe(false);
  });

  it("requires template source and matching connection reference in the response", () => {
    const templateApplication = {
      ...application,
      source: { kind: "template" as const, templateId: "gitea", templateVersion: 1 },
    };
    const templateConnection = {
      ...connection,
      template: { id: "gitea", version: 1 },
    };
    const valid = safeParseCreateTemplateApplicationOutcomeResponseV1({
      schemaVersion: 1,
      application: templateApplication,
      client,
      connection: templateConnection,
      credentialDelivery: {
        kind: "direct",
        credential,
      },
      integrationGuide,
    });
    expect(valid.success).toBe(true);

    expect(
      safeParseCreateTemplateApplicationOutcomeResponseV1({
        schemaVersion: 1,
        application,
        client,
        connection,
        credentialDelivery: { kind: "direct", credential },
        integrationGuide,
      }).success,
    ).toBe(false);
  });
});

describe("PortalApplicationV1", () => {
  it("returns a strict readonly minimal projection", () => {
    const parsed = parsePortalApplicationListV1([
      {
        id: "app_01",
        name: "示例应用",
        description: "门户描述",
        iconUrl: "https://cdn.example.com/app.svg",
        launchUrl: "https://app.example.com/?from=portal",
        order: 10,
      },
    ]);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed[0])).toBe(true);
    expect(parsed[0]).toEqual({
      id: "app_01",
      name: "示例应用",
      description: "门户描述",
      iconUrl: "https://cdn.example.com/app.svg",
      launchUrl: "https://app.example.com/?from=portal",
      order: 10,
    });
    expect(
      safeParsePortalApplicationV1({
        ...parsed[0],
        clientId: "must-not-leak",
      }).success,
    ).toBe(false);
    expect(
      safeParsePortalApplicationV1({
        ...parsed[0],
        launchUrl: "http://app.example.com",
      }).success,
    ).toBe(false);
  });
});

describe("IntegrationGuideV1", () => {
  it("accepts only structured, render-inert node kinds", () => {
    expect(safeParseIntegrationGuideV1(integrationGuide).success).toBe(true);
    expect(
      safeParseIntegrationGuideV1({
        ...integrationGuide,
        nodes: [{ kind: "html", html: "<script>alert(1)</script>" }],
      }).success,
    ).toBe(false);
  });
});

describe("OidcClientV1", () => {
  it("rejects a public Client without PKCE", () => {
    const result = safeParseOidcClientV1({
      ...client,
      clientType: "public",
      tokenEndpointAuthMethod: "none",
      pkcePolicy: "optional",
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate grant types", () => {
    expect(
      safeParseOidcClientV1({
        ...client,
        grantTypes: ["authorization_code", "authorization_code"],
      }).success,
    ).toBe(false);
  });

  it("keeps refresh_token and offline_access bidirectionally aligned", () => {
    expect(
      safeParseOidcClientV1({
        ...client,
        grantTypes: ["authorization_code", "refresh_token"],
      }).success,
    ).toBe(false);
    expect(
      safeParseOidcClientV1({
        ...client,
        allowedScopes: [...client.allowedScopes, "offline_access"],
      }).success,
    ).toBe(false);
  });
});
