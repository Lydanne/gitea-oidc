import { afterEach, describe, expect, it, vi } from "vitest";
import type { GiteaOidcConfig } from "../config";
import { AuthCoordinator } from "../core/AuthCoordinator";
import {
  cleanupServerResources,
  isAdminPublicFilePath,
  resolveCorsOrigin,
  setInteractionSecurityHeaders,
  start,
  validateRuntimeConfig,
} from "../server";
import { MemoryStateStore } from "../stores/MemoryStateStore";

const createValidRuntimeConfig = (): GiteaOidcConfig => ({
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
  adapter: {
    type: "sqlite",
    sqlite: { dbPath: "./oidc.db" },
  },
  jwks: {
    filePath: "./jwks.json",
    keyId: "default-key",
  },
});

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

describe("server runtime config validation", () => {
  it("accepts valid custom runtime config", () => {
    expect(validateRuntimeConfig(createValidRuntimeConfig()).server.url).toBe(
      "https://id.example.com",
    );
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

describe("server resource cleanup", () => {
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
