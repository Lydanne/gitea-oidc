import { safeParseIntegrationGuideV1 } from "@x-oidc/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GITEA_CLIENT_ID_PLACEHOLDER,
  GITEA_CLIENT_SECRET_PLACEHOLDER,
  GITEA_SUPPORTED_VERSIONS,
  GiteaTemplateInputV1Schema,
  GiteaTemplateV1,
} from "../index.js";

const developmentInput = {
  giteaBaseUrl: "http://127.0.0.1:3000/gitea/",
  authSourceName: "company-sso",
  targetVersion: "1.26",
  environment: "development",
  owner: "platform@example.com",
} as const;

const context = {
  issuer: "https://id.example.com/oidc",
  claimScopes: {
    openid: ["sub"],
    profile: ["name", "email", "groups"],
    email: ["email", "email_verified"],
  },
} as const;

describe("GiteaTemplateV1", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a versioned Gitea client without enabling unsupported protocol features", () => {
    const result = GiteaTemplateV1.resolve(developmentInput, context);

    expect(result.template).toEqual({ id: "gitea", version: 1 });
    expect(result.normalizedInput.giteaBaseUrl).toBe("http://127.0.0.1:3000/gitea");
    expect(result.resolution).toMatchObject({
      application: {
        environment: "development",
        owner: "platform@example.com",
        trustLevel: "third_party",
        consentPolicy: "explicit",
      },
      issuer: "https://id.example.com/oidc",
      target: {
        product: "gitea",
        version: "1.26",
        callbackUrl: "http://127.0.0.1:3000/gitea/user/oauth2/company-sso/callback",
        discoveryUrl: "https://id.example.com/oidc/.well-known/openid-configuration",
      },
      client: {
        clientType: "confidential",
        tokenEndpointAuthMethod: "client_secret_basic",
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
        redirectUris: ["http://127.0.0.1:3000/gitea/user/oauth2/company-sso/callback"],
        postLogoutRedirectUris: ["http://127.0.0.1:3000/gitea/"],
        allowedScopes: ["openid", "profile", "email"],
        pkcePolicy: "optional",
        capabilities: {
          refreshToken: false,
          providerApi: false,
          resourceServer: false,
        },
      },
    });
    expect(result.resolution.warnings.join(" ")).toContain("code_challenge");
  });

  it("uses the deployment scope that actually carries the configured group claim", () => {
    const result = GiteaTemplateV1.resolve(
      {
        ...developmentInput,
        groupClaimName: "groups",
      },
      context,
    );
    const guide = result.resolution.integrationGuide;
    const cliNode = guide.nodes.find((node) => node.kind === "code");

    expect(result.resolution.client.allowedScopes).toEqual(["openid", "profile", "email"]);
    expect(guide.nodes).toContainEqual(
      expect.objectContaining({
        kind: "field",
        label: "Group Claim Name",
        value: "groups",
      }),
    );
    expect(cliNode?.kind === "code" ? cliNode.code : "").toContain("--group-claim-name 'groups'");
  });

  it("adds a custom scope when it is the only scope carrying the group claim", () => {
    const result = GiteaTemplateV1.resolve(
      { ...developmentInput, groupClaimName: "departments" },
      {
        ...context,
        claimScopes: { ...context.claimScopes, organization: ["departments"] },
      },
    );

    expect(result.resolution.client.allowedScopes).toEqual([
      "openid",
      "profile",
      "email",
      "organization",
    ]);
  });

  it("rejects a group claim that the deployment does not expose", () => {
    expect(() =>
      GiteaTemplateV1.resolve({ ...developmentInput, groupClaimName: "missing" }, context),
    ).toThrow();
  });

  it("builds an inert structured guide with credential placeholders only", () => {
    const result = GiteaTemplateV1.resolve(developmentInput, context);
    const guide = result.resolution.integrationGuide;
    const serialized = JSON.stringify(guide);
    const cliNode = guide.nodes.find((node) => node.kind === "code");
    const cli = cliNode?.kind === "code" ? cliNode.code : "";

    expect(safeParseIntegrationGuideV1(guide).success).toBe(true);
    expect(guide.nodes.every((node) => node.kind !== ("html" as never))).toBe(true);
    expect(serialized).toContain(GITEA_CLIENT_ID_PLACEHOLDER);
    expect(serialized).toContain(GITEA_CLIENT_SECRET_PLACEHOLDER);
    expect(guide.nodes).toContainEqual({
      kind: "field",
      label: "Post Logout Redirect URI",
      value: "http://127.0.0.1:3000/gitea/",
      copyable: true,
    });
    expect(cli).toContain("gitea admin auth add-oauth");
    expect(cli).toContain("--provider openidConnect");
    expect(cli).toContain("--auto-discover-url");
    expect(cli).toContain("--scopes 'openid,profile,email'");
    expect(cli).toContain('--key "$X_OIDC_CLIENT_ID"');
    expect(cli).toContain('--secret "$X_OIDC_CLIENT_SECRET"');
    expect(cli).not.toContain(GITEA_CLIENT_SECRET_PLACEHOLDER);
    expect(cli).not.toContain("real-client-id");
    expect(cli).not.toContain("real-client-secret");
  });

  it("shell-quotes discovery URLs instead of interpolating URL characters as commands", () => {
    const result = GiteaTemplateV1.resolve(developmentInput, {
      issuer: "https://id.example.com/tenant'oops;still-path",
    });
    const cliNode = result.resolution.integrationGuide.nodes.find((node) => node.kind === "code");
    const cli = cliNode?.kind === "code" ? cliNode.code : "";

    expect(cli).toContain("'https://id.example.com/tenant'\"'\"'oops;still-path/.well-known");
    expect(cli).not.toContain(";still-path/.well-known/openid-configuration\n");
  });

  it("never accepts a credential as template input or resolution context", () => {
    expect(
      GiteaTemplateInputV1Schema.safeParse({
        ...developmentInput,
        clientSecret: "real-client-secret",
      }).success,
    ).toBe(false);
    expect(() =>
      GiteaTemplateV1.resolve(developmentInput, {
        ...context,
        clientSecret: "real-client-secret",
      } as never),
    ).toThrow();
  });

  it("creates a recursively frozen JSON snapshot", () => {
    const result = GiteaTemplateV1.resolve(developmentInput, context);

    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.normalizedInput)).toBe(true);
    expect(Object.isFrozen(result.snapshot.resolution.client.allowedScopes)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.snapshot))).toEqual(result.snapshot);
    expect(() => {
      (result.snapshot.normalizedInput as { authSourceName: string }).authSourceName = "changed";
    }).toThrow();
  });

  it("does not perform network requests while previewing or resolving", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    GiteaTemplateV1.preview(developmentInput, context);
    GiteaTemplateV1.resolve(developmentInput, context);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(GITEA_SUPPORTED_VERSIONS)("supports the declared Gitea %s line", (targetVersion) => {
    expect(
      GiteaTemplateInputV1Schema.safeParse({ ...developmentInput, targetVersion }).success,
    ).toBe(true);
  });

  it("publishes an immutable supported-version declaration", () => {
    expect(Object.isFrozen(GITEA_SUPPORTED_VERSIONS)).toBe(true);
    expect(() => {
      (GITEA_SUPPORTED_VERSIONS as unknown as string[]).push("1.27");
    }).toThrow();
  });

  it.each([
    ["unsupported version", { ...developmentInput, targetVersion: "1.23" }],
    ["unsafe auth source", { ...developmentInput, authSourceName: "sso; rm -rf /" }],
    ["production HTTP", { ...developmentInput, environment: "production" }],
    [
      "non-loopback development HTTP",
      { ...developmentInput, giteaBaseUrl: "http://gitea.example.com" },
    ],
    [
      "URL credentials",
      { ...developmentInput, giteaBaseUrl: "https://user:password@gitea.example.com" },
    ],
    ["URL query", { ...developmentInput, giteaBaseUrl: "https://gitea.example.com?tenant=one" }],
    ["unsafe group claim", { ...developmentInput, groupClaimName: "groups$(id)" }],
  ])("rejects %s", (_name, input) => {
    expect(GiteaTemplateInputV1Schema.safeParse(input).success).toBe(false);
  });

  it("rejects a loopback HTTP issuer outside development", () => {
    expect(() =>
      GiteaTemplateV1.resolve(
        {
          ...developmentInput,
          environment: "production",
          giteaBaseUrl: "https://gitea.example.com",
        },
        { issuer: "http://127.0.0.1:3000" },
      ),
    ).toThrow();
  });
});
