import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GiteaOidcConfig } from "../../config.js";
import {
  formatValidationErrors,
  formatWarnings,
  printValidationResult,
  validateConfig,
} from "../configValidator.js";
import { Logger } from "../Logger.js";

const createBaseConfig = (): GiteaOidcConfig => ({
  server: {
    host: "0.0.0.0",
    port: 3000,
    url: "https://id.example.com",
    trustProxy: false,
    corsOrigins: [],
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
      profile: ["name", "email"],
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
      client_secret: "super-secret-value-123",
      redirect_uris: ["https://app.example.com/callback", "https://id.example.com/admin/callback"],
      post_logout_redirect_uris: ["https://app.example.com/"],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],
  auth: {
    userRepository: {
      type: "memory",
      memory: {},
    },
    providers: {
      local: {
        enabled: true,
        displayName: "Local",
        config: {
          passwordFile: "/etc/htpasswd",
          passwordFormat: "bcrypt",
        },
      },
      feishu: {
        enabled: false,
        displayName: "Feishu",
        config: {},
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
    tokenEncryptionKey: "A".repeat(32),
    refreshSkewSeconds: 300,
    probeIntervalSeconds: 300,
    requestTimeoutMs: 10000,
    responseBodyLimitBytes: 1048576,
    sdkProxy: true,
    allowedClientIds: ["web-app"],
    providers: {},
  },
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateConfig", () => {
  it("should return valid result without warnings for correct config", () => {
    const result = validateConfig(createBaseConfig());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toEqual([]);
    expect(result.config?.server.url).toBe("https://id.example.com");
    expect(result.config?.clients[0].post_logout_redirect_uris).toEqual([
      "https://app.example.com/",
    ]);
  });

  it("should default CORS origins to an empty allowlist", () => {
    const config = createBaseConfig() as any;
    delete config.server.corsOrigins;

    const result = validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.config?.server.corsOrigins).toEqual([]);
  });

  it("should reject invalid CORS origins", () => {
    const config = createBaseConfig();
    config.server.corsOrigins = ["*"];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "server.corsOrigins.0",
          message: expect.stringContaining("有效的 URL"),
        }),
      ]),
    );
  });

  it("should reject public URLs with query, fragment, or non-origin CORS values", () => {
    const config = createBaseConfig();
    config.admin.enabled = false;
    config.server.url = "https://id.example.com?from=config";
    config.oidc.issuer = "https://id.example.com/oidc#issuer";
    config.server.corsOrigins = [
      "https://app.example.com/path",
      "https://admin.example.com#fragment",
    ];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "server.url",
          code: "url_query_fragment_forbidden",
        }),
        expect.objectContaining({
          path: "oidc.issuer",
          code: "url_query_fragment_forbidden",
        }),
        expect.objectContaining({
          path: "server.corsOrigins.0",
          code: "cors_origin_must_be_origin",
        }),
        expect.objectContaining({
          path: "server.corsOrigins.1",
          code: "cors_origin_must_be_origin",
        }),
      ]),
    );
  });

  it("should collect zod errors when invalid config provided", () => {
    const invalid = { server: {} };

    const result = validateConfig(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty("message");
  });

  it("should report general security warnings", () => {
    const config = createBaseConfig();
    config.oidc.cookieKeys = ["dev-cookie-key-change-me-32-chars-min", "B".repeat(32)];
    config.clients[0].client_secret = "dev-client-secret-change-me";
    config.clients[0].redirect_uris = [
      "http://example.com/callback",
      "http://id.example.com/admin/callback",
    ];
    config.clients[0].post_logout_redirect_uris = ["http://example.com/"];
    config.server.url = "http://id.example.com";
    config.oidc.issuer = "http://id.example.com/oidc";
    config.auth.providers.local.enabled = false;
    config.auth.providers.feishu.enabled = false;
    config.clients.push({
      client_id: "legacy-app",
      client_secret: "gitea-client-secret-change-in-production",
      redirect_uris: ["https://legacy.example.com/cb"],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_basic",
    });

    const result = validateConfig(config);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("默认 Cookie 密钥"),
        expect.stringContaining('客户端 "web-app" 使用默认密钥'),
        expect.stringContaining('客户端 "legacy-app" 使用默认密钥'),
        expect.stringContaining("服务器 URL 未使用 HTTPS"),
        expect.stringContaining('客户端 "web-app" 的重定向 URI'),
        expect.stringContaining('客户端 "web-app" 的登出后重定向 URI'),
        expect.stringContaining("没有启用任何认证提供者"),
      ]),
    );
  });

  it("should report provider specific warnings", () => {
    const config = createBaseConfig();
    config.auth.providers.local.enabled = true;
    (config.auth.providers.local.config as any).passwordFile = undefined;
    (config.auth.providers.local.config as any).passwordFormat = "auto";
    config.auth.providers.feishu.enabled = true;
    config.auth.providers.feishu.config = { appId: "", appSecret: "" } as any;

    const result = validateConfig(config);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("本地认证已启用但未配置 passwordFile"),
        expect.stringContaining("本地认证 passwordFormat=auto 不适合生产环境"),
        expect.stringContaining("飞书认证已启用但未配置 appId 或 appSecret"),
        expect.stringContaining("飞书认证已启用但未配置 verificationToken"),
        expect.stringContaining("飞书认证已启用但未配置 encryptKey"),
      ]),
    );
  });

  it("should reject enabled Provider API with a default token encryption key", () => {
    const config = createBaseConfig();
    config.providerApi.enabled = true;
    config.providerApi.tokenEncryptionKey = "change-this-provider-token-key";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "providerApi.tokenEncryptionKey",
          message: expect.stringContaining("至少 32 字符"),
        }),
      ]),
    );
  });

  it("should reject unsafe Provider API baseUrl values when the provider is enabled", () => {
    const config = createBaseConfig();
    config.providerApi.providers = {
      feishu: {
        enabled: true,
        baseUrl: "https://user:pass@open.feishu.cn/open-apis?debug=true#token",
        allowedOperations: ["authen.user_info"],
        defaultAppOwnerId: "default",
      },
      dingtalk: {
        enabled: true,
        baseUrl: "file:///tmp/provider",
        allowedOperations: [],
        defaultAppOwnerId: "default",
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "providerApi.providers.feishu.baseUrl",
          code: "provider_api_base_url_userinfo_forbidden",
        }),
        expect.objectContaining({
          path: "providerApi.providers.feishu.baseUrl",
          code: "provider_api_base_url_query_fragment_forbidden",
        }),
        expect.objectContaining({
          path: "providerApi.providers.dingtalk.baseUrl",
          code: "provider_api_base_url_protocol_forbidden",
        }),
      ]),
    );
  });

  it("should default Provider API resource limits and reject unsafe limit values", () => {
    const config = createBaseConfig() as any;
    delete config.providerApi.requestTimeoutMs;
    delete config.providerApi.responseBodyLimitBytes;

    const result = validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.config?.providerApi.requestTimeoutMs).toBe(10000);
    expect(result.config?.providerApi.responseBodyLimitBytes).toBe(1048576);

    const unsafe = createBaseConfig();
    unsafe.providerApi.requestTimeoutMs = 0;
    unsafe.providerApi.responseBodyLimitBytes = 0;

    const unsafeResult = validateConfig(unsafe);

    expect(unsafeResult.valid).toBe(false);
    expect(unsafeResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "providerApi.requestTimeoutMs",
        }),
        expect.objectContaining({
          path: "providerApi.responseBodyLimitBytes",
        }),
      ]),
    );
  });

  it("should warn when the admin group keeps the legacy Owners name", () => {
    const config = createBaseConfig();
    config.admin.allowedGroups = ["Owners"];

    const result = validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('后台管理员组仍使用通用名称 "Owners"')]),
    );
  });

  it("should reject enabled admin without a matching authorization code client", () => {
    const config = createBaseConfig();
    config.clients[0].redirect_uris = ["https://app.example.com/callback"];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "clients",
          code: "admin_client_required",
          message: expect.stringContaining("https://id.example.com/admin/callback"),
        }),
      ]),
    );
  });

  it("should reject issuer that does not match the mounted /oidc path", () => {
    const config = createBaseConfig();
    config.oidc.issuer = "https://evil.example.com/oidc";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "oidc.issuer",
          code: "oidc_issuer_mismatch",
          message: expect.stringContaining("https://id.example.com/oidc"),
        }),
      ]),
    );
  });

  it("should reject production config without HTTPS and persistent storage", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.server.url = "http://id.example.com";
    config.server.corsOrigins = ["http://app.example.com"];
    config.oidc.issuer = "http://id.example.com/oidc";
    config.clients[0].redirect_uris = ["http://app.example.com/callback"];
    config.clients[0].post_logout_redirect_uris = ["http://app.example.com/"];
    config.auth.userRepository = { type: "memory", memory: {} };
    config.adapter = { type: "memory" };
    config.providerApi.allowedClientIds = [];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "server.url", code: "production_https_required" }),
        expect.objectContaining({ path: "oidc.issuer", code: "production_https_required" }),
        expect.objectContaining({
          path: "server.corsOrigins.0",
          code: "production_https_required",
        }),
        expect.objectContaining({
          path: "clients.0.redirect_uris.0",
          code: "production_https_required",
        }),
        expect.objectContaining({
          path: "clients.0.post_logout_redirect_uris.0",
          code: "production_https_required",
        }),
        expect.objectContaining({
          path: "auth.userRepository.type",
          code: "production_storage_required",
        }),
        expect.objectContaining({
          path: "adapter.type",
          code: "production_storage_required",
        }),
        expect.objectContaining({
          path: "providerApi.allowedClientIds",
          code: "production_provider_api_client_allowlist_required",
        }),
      ]),
    );
  });

  it("should reject production development interactions and unbounded proxy trust", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.auth.userRepository = { type: "sqlite", sqlite: { dbPath: "./users.db" } };
    config.adapter = { type: "sqlite", sqlite: { dbPath: "./oidc.db" } };
    config.server.trustProxy = true;
    config.oidc.features.devInteractions.enabled = true;

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "production_dev_interactions_forbidden" }),
        expect.objectContaining({ code: "production_trusted_proxy_ips_required" }),
      ]),
    );
  });

  it("should require a shared state store with the Redis OIDC adapter in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.auth.userRepository = { type: "sqlite", sqlite: { dbPath: "./users.db" } };
    config.adapter = { type: "redis", redis: { url: "redis://localhost:6379" } };
    config.server.trustProxy = true;
    config.server.trustedProxyIps = ["127.0.0.1"];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "production_distributed_state_store_required" }),
      ]),
    );
  });

  it("should reject production default or weak client and cookie secrets", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.auth.userRepository = { type: "sqlite", sqlite: { dbPath: "./users.db" } };
    config.adapter = { type: "sqlite", sqlite: { dbPath: "./oidc.db" } };
    config.oidc.cookieKeys = ["dev-cookie-key-change-me-32-chars-min", "B".repeat(32)];
    config.clients[0].client_secret = "shortsecret";
    config.clients.push({
      client_id: "legacy-app",
      client_secret: "gitea-client-secret-change-in-production",
      redirect_uris: ["https://legacy.example.com/callback"],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_basic",
    });

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "oidc.cookieKeys.0",
          code: "production_default_secret_forbidden",
        }),
        expect.objectContaining({
          path: "clients.0.client_secret",
          code: "production_client_secret_too_short",
        }),
        expect.objectContaining({
          path: "clients.1.client_secret",
          code: "production_default_secret_forbidden",
        }),
      ]),
    );
  });

  it("should reject production local auth without bcrypt password format", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.auth.userRepository = { type: "sqlite", sqlite: { dbPath: "./users.db" } };
    config.adapter = { type: "sqlite", sqlite: { dbPath: "./oidc.db" } };
    (config.auth.providers.local.config as any).passwordFormat = "auto";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "auth.providers.local.config.passwordFormat",
          code: "production_local_password_bcrypt_required",
        }),
      ]),
    );
  });

  it("should reject production local auth without a password file", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.auth.userRepository = { type: "sqlite", sqlite: { dbPath: "./users.db" } };
    config.adapter = { type: "sqlite", sqlite: { dbPath: "./oidc.db" } };
    (config.auth.providers.local.config as any).passwordFile = "";

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "auth.providers.local.config.passwordFile",
          code: "production_local_password_file_required",
        }),
      ]),
    );
  });

  it("should reject production Provider API allowlist entries that do not match configured clients", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.auth.userRepository = { type: "sqlite", sqlite: { dbPath: "./users.db" } };
    config.providerApi.allowedClientIds = ["missing-client"];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "providerApi.allowedClientIds.0",
          code: "production_provider_api_client_unknown",
        }),
      ]),
    );
  });

  it("should reject production Provider API providers with non-HTTPS baseUrl", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createBaseConfig();
    config.auth.userRepository = { type: "sqlite", sqlite: { dbPath: "./users.db" } };
    config.adapter = { type: "sqlite", sqlite: { dbPath: "./oidc.db" } };
    config.providerApi.providers = {
      feishu: {
        enabled: true,
        baseUrl: "http://open.feishu.cn/open-apis",
        allowedOperations: ["authen.user_info"],
        defaultAppOwnerId: "default",
      },
    };

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "providerApi.providers.feishu.baseUrl",
          code: "production_provider_api_base_url_https_required",
        }),
      ]),
    );
  });
});

describe("formatValidationErrors", () => {
  it("should format errors into readable string", () => {
    const message = formatValidationErrors([
      { path: "server.url", message: "invalid url", code: "invalid_string" },
      { path: "", message: "general error", code: "custom" },
    ]);

    expect(message).toContain('配置项 "server.url"');
    expect(message).toContain("general error");
  });

  it("should return empty string when no errors", () => {
    expect(formatValidationErrors([])).toBe("");
  });
});

describe("formatWarnings", () => {
  it("should format warnings list", () => {
    const output = formatWarnings(["foo", "bar"]);

    expect(output).toBe("  - foo\n  - bar");
  });

  it("should return empty string when no warnings", () => {
    expect(formatWarnings([])).toBe("");
  });
});

describe("printValidationResult", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(Logger, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(Logger, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("should log errors when validation fails", () => {
    const result = {
      valid: false,
      errors: [{ path: "server.url", message: "invalid", code: "invalid_string" }],
      warnings: [],
    };

    printValidationResult(result);

    expect(errorSpy).toHaveBeenCalledTimes(3);
    expect(errorSpy.mock.calls[1][0]).toContain("server.url");
  });

  it("should log info and warnings when validation succeeds with warnings", () => {
    const result = {
      valid: true,
      warnings: ["warning message"],
      errors: [],
      config: createBaseConfig(),
    };

    printValidationResult(result);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy.mock.calls[1][0]).toContain("warning message");
  });
});
