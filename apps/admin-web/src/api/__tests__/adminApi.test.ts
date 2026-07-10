import {
  APPLICATION_CONNECTION_SCHEMA_VERSION,
  APPLICATION_CREDENTIAL_ROTATION_SCHEMA_VERSION,
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  type ApplicationDetailsV1,
  CUSTOM_APPLICATION_SCHEMA_VERSION,
  INTEGRATION_GUIDE_SCHEMA_VERSION,
  type RotateApplicationCredentialResponseV1,
} from "@gitea-oidc/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAdminApplications,
  fetchAdminApplicationTemplates,
  rotateAdminApplicationSecret,
} from "../adminApi";

const application: ApplicationDetailsV1["application"] = {
  id: "app-1",
  name: "示例应用",
  slug: "example-app",
  status: "active",
  source: { kind: "custom", schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION },
  trustLevel: "third_party",
  consentPolicy: "explicit",
  environment: "development",
  version: 1,
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

const client: ApplicationDetailsV1["clients"][number] = {
  id: "oidc-client-1",
  applicationId: application.id,
  clientId: "example-client",
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

const applicationDetails: ApplicationDetailsV1 = {
  application,
  clients: [client],
  secrets: [
    {
      id: "secret-1",
      oidcClientId: client.id,
      keyId: "applications-v1",
      fingerprint: `hmac-sha256:${"a".repeat(24)}`,
      status: "active",
      deliveredAt: "2026-07-10T08:00:00.000Z",
      createdAt: "2026-07-10T08:00:00.000Z",
    },
  ],
};

const rotationResponse: RotateApplicationCredentialResponseV1 = {
  schemaVersion: CUSTOM_APPLICATION_SCHEMA_VERSION,
  application: { ...application, version: 2, updatedAt: "2026-07-10T09:00:00.000Z" },
  client,
  connection: {
    schemaVersion: APPLICATION_CONNECTION_SCHEMA_VERSION,
    applicationId: application.id,
    oidcClientId: client.id,
    issuer: "https://id.example.com",
    clientId: client.clientId,
    clientType: "confidential",
    clientAuthMethod: "client_secret_basic",
    redirectUris: client.redirectUris,
    postLogoutRedirectUris: client.postLogoutRedirectUris,
    scopes: client.allowedScopes,
    resources: client.allowedResources,
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
  },
  credentialDelivery: {
    kind: "direct",
    credential: {
      schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
      applicationId: application.id,
      oidcClientId: client.id,
      issuer: "https://id.example.com",
      clientId: client.clientId,
      kind: "client_secret",
      clientSecret: "one-time-rotated-secret",
    },
  },
  integrationGuide: {
    schemaVersion: INTEGRATION_GUIDE_SCHEMA_VERSION,
    title: "Node.js 接入",
    nodes: [{ kind: "paragraph", text: "使用新的 Client Secret 更新部署配置" }],
  },
};

const mockJsonResponse = (payload: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin application API contracts", () => {
  it("accepts a valid applications list through the shared contract", async () => {
    const fetchMock = mockJsonResponse([applicationDetails]);

    await expect(fetchAdminApplications()).resolves.toEqual([applicationDetails]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/applications",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("rejects a malformed template list through the shared contract", async () => {
    mockJsonResponse([
      {
        reference: { id: "gitea", version: 1 },
        name: "Gitea",
        description: "Gitea OIDC 模板",
        supportedVersions: [],
        form: {
          fields: [{ kind: "url", name: "baseUrl", label: "Base URL", required: true }],
        },
      },
    ]);

    await expect(fetchAdminApplicationTemplates()).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects an unexpected secret field before returning a rotation response to the UI", async () => {
    mockJsonResponse({
      ...rotationResponse,
      secret: "must-not-reach-ui",
    });

    await expect(
      rotateAdminApplicationSecret("app-1", {
        schemaVersion: APPLICATION_CREDENTIAL_ROTATION_SCHEMA_VERSION,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
