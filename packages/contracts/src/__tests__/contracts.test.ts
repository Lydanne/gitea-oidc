import { describe, expect, it } from "vitest";
import {
  APPLICATION_CONNECTION_SCHEMA_VERSION,
  type ApplicationConnectionV1,
  type ApplicationV1,
  CUSTOM_APPLICATION_SCHEMA_VERSION,
  INTEGRATION_GUIDE_SCHEMA_VERSION,
  type IntegrationGuideV1,
  type OidcClientV1,
  parseApplicationConnectionV1,
  parseApplicationCredentialV1,
  parseCreateCustomApplicationRequestV1,
  safeParseApplicationConnectionV1,
  safeParseApplicationV1,
  safeParseCreateCustomApplicationOutcomeResponseV1,
  safeParseCreateCustomApplicationRequestV1,
  safeParseCreateCustomApplicationResponseV1,
  safeParseIntegrationGuideV1,
  safeParseOidcClientV1,
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
        kind: "client_secret",
        clientSecret: "one-time-secret-value",
      }),
    ).toEqual({ kind: "client_secret", clientSecret: "one-time-secret-value" });
    expect(parseApplicationCredentialV1({ kind: "none" })).toEqual({ kind: "none" });
  });
});

describe("custom application DTOs", () => {
  it("normalizes safe defaults for a custom application request", () => {
    const parsed = parseCreateCustomApplicationRequestV1({
      schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
      application: {
        name: "示例应用",
        environment: "development",
      },
      client: {
        clientType: "confidential",
        redirectUris: ["http://127.0.0.1:3000/oidc/callback"],
      },
    });

    expect(parsed.application).toMatchObject({
      trustLevel: "third_party",
      consentPolicy: "explicit",
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
        credential: { kind: "client_secret", clientSecret: "one-time-secret-value" },
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
      credentialDelivery: { kind: "direct", credential: { kind: "none" } },
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
        credential: { kind: "client_secret", clientSecret: "one-time-secret-value" },
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
        credential: { kind: "client_secret", clientSecret },
      },
      integrationGuide: {
        ...integrationGuide,
        nodes: [{ kind: "field", label: "Client Secret", value: clientSecret }],
      },
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

describe("ApplicationV1", () => {
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
