import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ApplicationSecretEncryptor,
  ApplicationService,
  SqliteApplicationRepository,
} from "@gitea-oidc/applications";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OidcAdapterFactory } from "../adapters/OidcAdapterFactory.js";
import type { GiteaOidcConfig, ResolvedGiteaOidcConfig } from "../config.js";
import { AuthCoordinator } from "../core/AuthCoordinator.js";
import {
  cleanupServerResources,
  createIdentityServer,
  isAdminPublicFilePath,
  isMainModulePath,
  resolveCorsOrigin,
  setInteractionSecurityHeaders,
  start,
  validateRuntimeConfig,
} from "../server.js";
import { MemoryStateStore } from "../stores/MemoryStateStore.js";

const createValidRuntimeConfig = (): ResolvedGiteaOidcConfig => ({
  server: {
    host: "0.0.0.0",
    port: 3000,
    url: "https://id.example.com",
    trustProxy: false,
    corsOrigins: ["https://app.example.com"],
  },
  logging: {
    enabled: true,
    level: "info",
  },
  oidc: {
    issuer: "https://id.example.com/oidc",
    cookieKeys: ["A".repeat(32), "B".repeat(32)],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
    claims: {
      openid: ["sub"],
      profile: ["name", "email", "groups", "roles", "status"],
      email: ["email", "email_verified"],
      provider_api: [],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
    },
  },
  clients: [
    {
      client_id: "web-app",
      client_secret: "client-secret-value-1234567890",
      redirect_uris: ["https://app.example.com/callback", "https://id.example.com/admin/callback"],
      post_logout_redirect_uris: ["https://app.example.com/"],
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],
  auth: {
    userRepository: {
      type: "sqlite",
      sqlite: { dbPath: "./users.db" },
    },
    providers: {
      local: {
        enabled: true,
        displayName: "Local",
        config: {
          passwordFile: "/etc/gitea-oidc/htpasswd",
          passwordFormat: "bcrypt",
        },
      },
    },
  },
  admin: {
    enabled: true,
    basePath: "/admin",
    allowedGroups: ["gitea-oidc-admins"],
    sessionTtlSeconds: 3600,
  },
  providerApi: {
    enabled: true,
    tokenEncryptionKey: "P".repeat(32),
    refreshSkewSeconds: 300,
    probeIntervalSeconds: 300,
    requestTimeoutMs: 10000,
    responseBodyLimitBytes: 1048576,
    sdkProxy: true,
    allowedClientIds: ["web-app"],
    providers: {
      feishu: {
        enabled: false,
        baseUrl: "https://open.feishu.cn/open-apis",
        allowedOperations: ["authen.user_info"],
        defaultAppOwnerId: "default",
      },
    },
  },
  applications: {
    enabled: false,
    clientSource: "config",
    repository: { type: "sqlite", sqlite: { dbPath: "./applications.db" } },
    secretEncryption: { keyId: "applications-v1", masterKey: "" },
  },
  adapter: {
    type: "sqlite",
    sqlite: { dbPath: "./oidc.db" },
  },
  jwks: {
    filePath: "./jwks.json",
    keyId: "default-key",
  },
});

const DYNAMIC_REDIRECT_URI = "https://app.example.com/callback";
const DYNAMIC_POST_LOGOUT_REDIRECT_URI = "https://app.example.com/";

function createTestMasterKey(): Buffer {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
}

async function seedDynamicApplication(tempDir: string) {
  const applicationsDbPath = join(tempDir, "applications.db");
  const masterKey = createTestMasterKey();
  const repository = new SqliteApplicationRepository({
    dbPath: applicationsDbPath,
    connectionIssuer: "https://id.example.com/oidc",
  });
  try {
    const service = new ApplicationService({
      repository,
      secretEncryptor: new ApplicationSecretEncryptor({
        keyId: "applications-v1",
        masterKey,
      }),
      issuer: "https://id.example.com/oidc",
      supportedScopes: ["openid", "profile", "email", "offline_access"],
    });
    const created = await service.createCustomApplication(
      {
        schemaVersion: 1,
        application: {
          name: "动态测试应用",
          slug: "dynamic-test-app",
          environment: "production",
        },
        client: {
          clientType: "confidential",
          redirectUris: [DYNAMIC_REDIRECT_URI],
          postLogoutRedirectUris: [DYNAMIC_POST_LOGOUT_REDIRECT_URI],
          scopes: ["openid", "profile", "email"],
          pkcePolicy: "required",
        },
        credentialDelivery: "direct",
      },
      { idempotencyKey: "dynamic-client-test-create" },
    );
    return { applicationsDbPath, created, masterKey };
  } finally {
    await repository.close();
  }
}

function configureDynamicApplications(
  config: ResolvedGiteaOidcConfig,
  fixture: Awaited<ReturnType<typeof seedDynamicApplication>>,
  tempDir: string,
): void {
  config.auth.userRepository = { type: "memory", memory: {} };
  config.admin.enabled = false;
  config.providerApi.enabled = false;
  config.adapter = { type: "sqlite", sqlite: { dbPath: join(tempDir, "oidc.db") } };
  config.applications = {
    enabled: true,
    clientSource: "database",
    repository: { type: "sqlite", sqlite: { dbPath: fixture.applicationsDbPath } },
    secretEncryption: {
      keyId: "applications-v1",
      masterKey: fixture.masterKey.toString("base64url"),
    },
  };
  config.jwks = { filePath: join(tempDir, "jwks.json"), keyId: "test-key" };
}

type CookieJar = Map<string, string>;

async function injectWithCookies(
  app: FastifyInstance,
  jar: CookieJar,
  options: {
    method: "GET" | "POST";
    url: string;
    payload?: string;
    headers?: Record<string, string>;
  },
) {
  const parsedUrl = new URL(options.url, "https://id.example.com");
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await app.inject({
    ...options,
    url: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers: {
      ...options.headers,
      ...(cookie === "" ? {} : { cookie }),
    },
  });
  const setCookie = response.headers["set-cookie"];
  for (const header of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value === "") {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
  return response;
}

function requireLocation(response: { headers: Record<string, unknown> }): string {
  const location = response.headers.location;
  if (typeof location !== "string") {
    throw new Error("预期响应包含 Location header");
  }
  return location;
}

function readInteractionUid(location: string): string {
  const match = /^\/interaction\/([^/?]+)$/.exec(
    new URL(location, "https://id.example.com").pathname,
  );
  if (!match?.[1]) {
    throw new Error(`无法从重定向读取 interaction uid: ${location}`);
  }
  return match[1];
}

async function beginDynamicConsent(
  app: FastifyInstance,
  clientId: string,
  state: string,
): Promise<{
  consent: Awaited<ReturnType<FastifyInstance["inject"]>>;
  jar: CookieJar;
  uid: string;
}> {
  const jar: CookieJar = new Map();
  const authorization = await injectWithCookies(app, jar, {
    method: "GET",
    url: `/oidc/auth?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: DYNAMIC_REDIRECT_URI,
      response_type: "code",
      scope: "openid profile email",
      state,
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
    })}`,
  });
  expect(authorization.statusCode).toBe(303);

  const loginLocation = requireLocation(authorization);
  const loginUid = readInteractionUid(loginLocation);
  const loginPage = await injectWithCookies(app, jar, { method: "GET", url: loginLocation });
  expect(loginPage.statusCode).toBe(200);

  const login = await injectWithCookies(app, jar, {
    method: "POST",
    url: `/interaction/${encodeURIComponent(loginUid)}/login`,
    payload: new URLSearchParams({
      authMethod: "local",
      username: "alice",
      password: "secret",
    }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  expect(login.statusCode).toBe(303);

  const resumedLogin = await injectWithCookies(app, jar, {
    method: "GET",
    url: requireLocation(login),
  });
  expect(resumedLogin.statusCode).toBe(303);

  const consentLocation = requireLocation(resumedLogin);
  const uid = readInteractionUid(consentLocation);
  const consent = await injectWithCookies(app, jar, { method: "GET", url: consentLocation });
  expect(consent.statusCode).toBe(200);
  return { consent, jar, uid };
}

async function authorizeTrustedSystemClient(app: FastifyInstance): Promise<URL> {
  const jar: CookieJar = new Map();
  const authorization = await injectWithCookies(app, jar, {
    method: "GET",
    url: `/oidc/auth?${new URLSearchParams({
      client_id: "web-app",
      redirect_uri: DYNAMIC_REDIRECT_URI,
      response_type: "code",
      scope: "openid profile email",
      state: "system-client-state",
      code_challenge: "B".repeat(43),
      code_challenge_method: "S256",
    })}`,
  });
  const loginLocation = requireLocation(authorization);
  const loginUid = readInteractionUid(loginLocation);
  await injectWithCookies(app, jar, { method: "GET", url: loginLocation });
  const login = await injectWithCookies(app, jar, {
    method: "POST",
    url: `/interaction/${encodeURIComponent(loginUid)}/login`,
    payload: new URLSearchParams({
      authMethod: "local",
      username: "alice",
      password: "secret",
    }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  let response = await injectWithCookies(app, jar, {
    method: "GET",
    url: requireLocation(login),
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const location = new URL(requireLocation(response), "https://id.example.com");
    if (location.origin === "https://app.example.com") {
      return location;
    }
    response = await injectWithCookies(app, jar, {
      method: "GET",
      url: location.toString(),
    });
  }
  throw new Error("受信任 system Client 未完成自动 consent");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server CORS configuration", () => {
  it("disables CORS when no browser origins are configured", () => {
    expect(resolveCorsOrigin()).toBe(false);
    expect(resolveCorsOrigin([])).toBe(false);
  });

  it("uses an explicit origin allowlist when configured", () => {
    expect(resolveCorsOrigin(["https://app.example.com"])).toEqual(["https://app.example.com"]);
  });
});

describe("server static security headers", () => {
  it("identifies only admin public files for admin security headers", () => {
    expect(isAdminPublicFilePath("/srv/app/public/admin/index.html")).toBe(true);
    expect(isAdminPublicFilePath("/srv/app/public/admin/assets/index.js")).toBe(true);
    expect(isAdminPublicFilePath("/srv/app/public/favicon.ico")).toBe(false);
    expect(isAdminPublicFilePath("/srv/app/public/admin2/index.html")).toBe(false);
  });

  it("applies restrictive security headers to interaction login pages", () => {
    const reply = { header: vi.fn().mockReturnThis() };

    setInteractionSecurityHeaders(reply);

    expect(reply.header).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("script-src 'none'"),
    );
    expect(reply.header).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("frame-ancestors 'none'"),
    );
    expect(reply.header).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(reply.header).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(reply.header).toHaveBeenCalledWith("Referrer-Policy", "same-origin");
  });
});

describe("server process entry", () => {
  it("recognizes a directly executed entry through a workspace symlink", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gitea-oidc-main-"));
    const realEntry = join(tempDir, "server.js");
    const linkedEntry = join(tempDir, "workspace-server.js");
    await writeFile(realEntry, "export {};\n", "utf8");
    await symlink(realEntry, linkedEntry);

    try {
      expect(isMainModulePath(pathToFileURL(realEntry).href, linkedEntry)).toBe(true);
      expect(isMainModulePath(pathToFileURL(realEntry).href)).toBe(false);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

describe("server runtime config validation", () => {
  it("accepts valid custom runtime config", () => {
    expect(validateRuntimeConfig(createValidRuntimeConfig()).server.url).toBe(
      "https://id.example.com",
    );
  });

  it("fills defaults for legacy TypeScript config fields introduced in v2", () => {
    const current = createValidRuntimeConfig();
    const { admin: _admin, providerApi: _providerApi, ...withoutControlPlane } = current;
    const { corsOrigins: _corsOrigins, ...legacyServer } = current.server;
    const legacyConfig: GiteaOidcConfig = {
      ...withoutControlPlane,
      server: legacyServer,
    };

    const resolved = validateRuntimeConfig(legacyConfig);

    expect(resolved.server.corsOrigins).toEqual([]);
    expect(resolved.admin.enabled).toBe(false);
    expect(resolved.providerApi.enabled).toBe(false);
  });

  it("rejects unsafe production custom runtime config before startup", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createValidRuntimeConfig();
    config.server.url = "http://id.example.com";
    config.oidc.issuer = "http://id.example.com/oidc";
    config.auth.userRepository = { type: "memory", memory: {} };
    config.adapter = { type: "memory" };

    let error: unknown;
    try {
      validateRuntimeConfig(config);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("配置验证失败");
    expect((error as Error).message).toContain("生产环境 server.url 必须使用 HTTPS 公网地址");
    expect((error as Error).message).toContain("生产环境必须使用 sqlite 或 pgsql 用户仓储");
  });
});

describe("server dynamic applications", () => {
  it("loads a database application as a real oidc-provider Client", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gitea-oidc-dynamic-client-"));
    const fixture = await seedDynamicApplication(tempDir);

    const config = createValidRuntimeConfig();
    config.auth.providers = {};
    configureDynamicApplications(config, fixture, tempDir);

    const app = await createIdentityServer(config, { publicDir: "public" });
    try {
      const authorization = await app.inject({
        method: "GET",
        url: `/oidc/auth?${new URLSearchParams({
          client_id: fixture.created.response.client.clientId,
          redirect_uri: DYNAMIC_REDIRECT_URI,
          response_type: "code",
          scope: "openid profile email",
          state: "test-state",
          code_challenge: "A".repeat(43),
          code_challenge_method: "S256",
        })}`,
      });

      expect(authorization.statusCode).toBe(303);
      expect(authorization.headers.location).toMatch(/^\/interaction\//);

      const missingPkce = await app.inject({
        method: "GET",
        url: `/oidc/auth?${new URLSearchParams({
          client_id: fixture.created.response.client.clientId,
          redirect_uri: DYNAMIC_REDIRECT_URI,
          response_type: "code",
          scope: "openid",
          state: "test-state-without-pkce",
        })}`,
      });
      expect(missingPkce.statusCode).toBe(303);
      expect(missingPkce.headers.location).toContain("error=invalid_request");

      const logoutCookies: CookieJar = new Map();
      const logout = await injectWithCookies(app, logoutCookies, {
        method: "GET",
        url: `/oidc/session/end?${new URLSearchParams({
          client_id: fixture.created.response.client.clientId,
          post_logout_redirect_uri: DYNAMIC_POST_LOGOUT_REDIRECT_URI,
          state: "logout-state",
        })}`,
      });
      expect(logout.statusCode).toBe(200);
      const xsrf = /name="xsrf" value="([^"]+)"/u.exec(logout.body)?.[1];
      expect(xsrf).toBeTruthy();

      const confirmedLogout = await injectWithCookies(app, logoutCookies, {
        method: "POST",
        url: "/oidc/session/end/confirm",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ xsrf: xsrf!, logout: "yes" }).toString(),
      });
      expect(confirmedLogout.statusCode).toBe(303);
      const postLogoutLocation = new URL(requireLocation(confirmedLogout));
      expect(`${postLogoutLocation.origin}${postLogoutLocation.pathname}`).toBe(
        DYNAMIC_POST_LOGOUT_REDIRECT_URI,
      );
      expect(postLogoutLocation.searchParams.get("state")).toBe("logout-state");

      const unregisteredLogout = await app.inject({
        method: "GET",
        url: `/oidc/session/end?${new URLSearchParams({
          client_id: fixture.created.response.client.clientId,
          post_logout_redirect_uri: "https://unregistered.example.com/",
        })}`,
      });
      expect(unregisteredLogout.statusCode).toBe(400);
      expect(unregisteredLogout.json()).toMatchObject({
        error: "invalid_request",
        error_description: "post_logout_redirect_uri not registered",
      });
    } finally {
      await app.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("对第三方动态应用显式展示授权并处理允许和拒绝", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gitea-oidc-dynamic-consent-"));
    const fixture = await seedDynamicApplication(tempDir);
    const passwordFile = join(tempDir, "users.htpasswd");
    await writeFile(passwordFile, "alice:secret\n", "utf8");

    const config = createValidRuntimeConfig();
    config.logging.enabled = false;
    config.auth.providers.local.config = {
      passwordFile,
      passwordFormat: "auto",
    };
    configureDynamicApplications(config, fixture, tempDir);

    const delivery = fixture.created.response.credentialDelivery;
    if (delivery.kind !== "direct" || delivery.credential.kind !== "client_secret") {
      throw new Error("测试动态应用应返回一次性 client_secret");
    }
    const clientSecret = delivery.credential.clientSecret;
    const clientId = fixture.created.response.client.clientId;
    const app = await createIdentityServer(config, { publicDir: "public" });

    try {
      const approval = await beginDynamicConsent(app, clientId, "approve-state");
      expect(approval.consent.headers["content-security-policy"]).toContain("script-src 'none'");
      expect(approval.consent.headers["x-frame-options"]).toBe("DENY");
      expect(approval.consent.headers["cache-control"]).toBe("no-store");
      expect(approval.consent.headers.pragma).toBe("no-cache");
      expect(approval.consent.body).toContain("动态测试应用");
      expect(approval.consent.body).toContain("<code>openid</code>");
      expect(approval.consent.body).toContain("<code>profile</code>");
      expect(approval.consent.body).toContain("<code>email</code>");
      expect(approval.consent.body).not.toContain(clientSecret);
      expect(approval.consent.body).not.toContain("gos_");

      const crossOrigin = await injectWithCookies(app, approval.jar, {
        method: "POST",
        url: `/interaction/${encodeURIComponent(approval.uid)}/consent`,
        payload: "decision=approve",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example.com",
        },
      });
      expect(crossOrigin.statusCode).toBe(403);
      expect(crossOrigin.headers["cache-control"]).toBe("no-store");

      const approved = await injectWithCookies(app, approval.jar, {
        method: "POST",
        url: `/interaction/${encodeURIComponent(approval.uid)}/consent`,
        payload: "decision=approve",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://id.example.com",
        },
      });
      expect(approved.statusCode).toBe(303);
      const approvedResume = await injectWithCookies(app, approval.jar, {
        method: "GET",
        url: requireLocation(approved),
      });
      expect(approvedResume.statusCode).toBe(303);
      const approvedCallback = new URL(requireLocation(approvedResume));
      expect(approvedCallback.origin).toBe("https://app.example.com");
      expect(approvedCallback.searchParams.get("code")).toBeTruthy();
      expect(approvedCallback.searchParams.get("state")).toBe("approve-state");
      expect(approvedCallback.searchParams.get("error")).toBeNull();

      const denial = await beginDynamicConsent(app, clientId, "deny-state");
      const denied = await injectWithCookies(app, denial.jar, {
        method: "POST",
        url: `/interaction/${encodeURIComponent(denial.uid)}/consent`,
        payload: "decision=deny",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://id.example.com",
        },
      });
      expect(denied.statusCode).toBe(303);
      const deniedResume = await injectWithCookies(app, denial.jar, {
        method: "GET",
        url: requireLocation(denied),
      });
      expect(deniedResume.statusCode).toBe(303);
      const deniedCallback = new URL(requireLocation(deniedResume));
      expect(deniedCallback.searchParams.get("error")).toBe("access_denied");
      expect(deniedCallback.searchParams.get("code")).toBeNull();
      expect(deniedCallback.searchParams.get("state")).toBe("deny-state");

      const systemCallback = await authorizeTrustedSystemClient(app);
      expect(systemCallback.searchParams.get("code")).toBeTruthy();
      expect(systemCallback.searchParams.get("state")).toBe("system-client-state");

      const pending = await beginDynamicConsent(app, clientId, "disabled-during-consent");
      const controlRepository = new SqliteApplicationRepository({
        dbPath: fixture.applicationsDbPath,
        connectionIssuer: config.oidc.issuer,
      });
      try {
        const controlService = new ApplicationService({
          repository: controlRepository,
          secretEncryptor: new ApplicationSecretEncryptor({
            keyId: "applications-v1",
            masterKey: fixture.masterKey,
          }),
          issuer: config.oidc.issuer,
          supportedScopes: ["openid", "profile", "email", "offline_access"],
        });
        const applicationId = fixture.created.response.application.id;
        await controlService.disableApplication(applicationId, { expectedVersion: 1 });
        await OidcAdapterFactory.revokeByClientId(clientId);
        await controlService.completeDisableApplication(applicationId, { expectedVersion: 2 });

        const rejectedConsent = await injectWithCookies(app, pending.jar, {
          method: "POST",
          url: `/interaction/${encodeURIComponent(pending.uid)}/consent`,
          payload: "decision=approve",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://id.example.com",
          },
        });
        expect(rejectedConsent.statusCode).toBe(400);
        expect(rejectedConsent.body).toBe("Invalid or expired interaction");

        const disabledAuthorization = await app.inject({
          method: "GET",
          url: `/oidc/auth?${new URLSearchParams({
            client_id: clientId,
            redirect_uri: DYNAMIC_REDIRECT_URI,
            response_type: "code",
            scope: "openid",
            state: "disabled-client-state",
            code_challenge: "C".repeat(43),
            code_challenge_method: "S256",
          })}`,
        });
        expect(disabledAuthorization.statusCode).toBe(400);
        expect(disabledAuthorization.headers.location).toBeUndefined();
        expect(disabledAuthorization.body).not.toContain("authorization code");
      } finally {
        await controlRepository.close();
      }
    } finally {
      await app.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

describe("server resource cleanup", () => {
  it("serves admin assets from a custom basePath", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gitea-oidc-admin-base-path-"));
    const config = createValidRuntimeConfig();
    config.logging.enabled = false;
    config.admin.basePath = "/ops/identity";
    config.clients[0].redirect_uris = [
      DYNAMIC_REDIRECT_URI,
      "https://id.example.com/ops/identity/callback",
    ];
    config.auth.userRepository = { type: "memory", memory: {} };
    config.auth.providers.local.enabled = false;
    config.providerApi.enabled = false;
    config.adapter = { type: "memory" };
    config.jwks = { filePath: join(tempDir, "jwks.json"), keyId: "test-key" };
    const app = await createIdentityServer(config, { publicDir: "public" });

    try {
      const page = await app.inject({ method: "GET", url: "/ops/identity/users" });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<base href="/ops/identity/">');
      const assetName = /src="\.\/assets\/([^"]+\.js)"/u.exec(page.body)?.[1];
      expect(assetName).toBeTruthy();

      const asset = await app.inject({
        method: "GET",
        url: `/ops/identity/assets/${encodeURIComponent(assetName!)}`,
      });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("javascript");
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(asset.headers["content-security-policy"]).toContain("script-src 'self'");
    } finally {
      await app.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("creates an application without listening on a port", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gitea-oidc-create-"));
    const config = createValidRuntimeConfig();
    config.auth.userRepository = { type: "memory", memory: {} };
    config.auth.providers.local.enabled = false;
    config.providerApi.enabled = false;
    config.admin.enabled = false;
    config.adapter = { type: "memory" };
    config.jwks = { filePath: join(tempDir, "jwks.json"), keyId: "test-key" };

    const app = await createIdentityServer(config, { publicDir: "public" });

    try {
      expect(app.server.listening).toBe(false);
      await expect(createIdentityServer(config)).rejects.toThrow(
        "OIDC Adapter 尚不支持同进程多实例",
      );
    } finally {
      await app.close();
      const replacement = await createIdentityServer(config);
      await replacement.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("cleans initialized resources before closing the app", async () => {
    const calls: string[] = [];
    const resources = {
      providerTokenProbeScheduler: {
        stop: vi.fn(() => calls.push("scheduler")),
      },
      authCoordinator: {
        destroy: vi.fn(async () => calls.push("auth")),
      },
      tokenRepository: {
        close: vi.fn(async () => calls.push("tokenRepository")),
      },
      applicationRuntime: {
        close: vi.fn(async () => calls.push("applications")),
      },
      userRepository: {
        close: vi.fn(async () => calls.push("userRepository")),
      },
      stateStore: {
        destroy: vi.fn(() => calls.push("stateStore")),
      },
      app: {
        close: vi.fn(async () => calls.push("app")),
      },
    };
    const cleanupAdapters = vi.fn(async () => calls.push("adapters"));

    await cleanupServerResources(resources, { cleanupAdapters });

    expect(calls).toEqual([
      "scheduler",
      "auth",
      "tokenRepository",
      "applications",
      "userRepository",
      "stateStore",
      "adapters",
      "app",
    ]);
  });

  it("can skip closing the app when only runtime resources should be released", async () => {
    const app = { close: vi.fn() };
    const cleanupAdapters = vi.fn(async () => {});

    await cleanupServerResources({ app }, { cleanupAdapters, closeApp: false });

    expect(cleanupAdapters).toHaveBeenCalled();
    expect(app.close).not.toHaveBeenCalled();
  });

  it("cleans runtime resources when startup fails before listening", async () => {
    const config = createValidRuntimeConfig();
    config.auth.userRepository = { type: "memory", memory: {} };
    config.auth.providers.local.config = {
      passwordFile: "/path/to/missing/htpasswd",
      passwordFormat: "bcrypt",
    };
    config.providerApi.enabled = false;
    config.adapter = { type: "sqlite", sqlite: { dbPath: "./oidc.db" } };

    const stateDestroySpy = vi.spyOn(MemoryStateStore.prototype, "destroy");
    const authDestroySpy = vi.spyOn(AuthCoordinator.prototype, "destroy");
    await expect(start(config)).rejects.toThrow("Failed to load password file");

    expect(authDestroySpy).toHaveBeenCalled();
    expect(stateDestroySpy).toHaveBeenCalled();

    authDestroySpy.mockRestore();
    stateDestroySpy.mockRestore();
  });
});
