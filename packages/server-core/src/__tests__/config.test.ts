import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateConfig = vi.fn();
const mockPrintValidationResult = vi.fn();

vi.mock("../utils/configValidator", () => ({
  validateConfig: mockValidateConfig,
  printValidationResult: mockPrintValidationResult,
}));

describe("loadConfig", () => {
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let tempDir: string;

  const importConfigModule = async () => {
    const module = await import("../config.js");
    return module;
  };

  beforeEach(() => {
    vi.resetModules();
    mockValidateConfig.mockReset();
    mockPrintValidationResult.mockReset();
    tempDir = mkdtempSync(join(tmpdir(), "gitea-oidc-config-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads and merges JSON config, then validates", async () => {
    const jsonConfig = {
      server: { port: 4000 },
      logging: { level: "debug" },
      auth: {
        providers: {
          local: {
            enabled: false,
          },
        },
      },
    };
    writeFileSync(join(tempDir, "gitea-oidc.config.json"), JSON.stringify(jsonConfig));

    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: { host: "0.0.0.0", port: 4000, url: "http://localhost:3000" },
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({ port: 4000 }),
        logging: expect.objectContaining({ level: "debug" }),
      }),
    );
    expect(mockPrintValidationResult).toHaveBeenCalledWith(validated);
    expect(result).toBe(validated.config);
  });

  it("旧版配置省略 admin 时默认关闭且不注入后台 callback", async () => {
    const jsonConfig = {
      clients: [
        {
          client_id: "gitea",
          client_secret: "legacy-client-secret",
          redirect_uris: ["http://localhost:3001/user/oauth2/gitea/callback"],
          response_types: ["code"],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "client_secret_basic",
        },
      ],
    };
    writeFileSync(join(tempDir, "gitea-oidc.config.json"), JSON.stringify(jsonConfig));
    mockValidateConfig.mockImplementation((config) => ({
      valid: true,
      warnings: [],
      errors: [],
      config,
    }));

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(result.admin).toEqual({
      enabled: false,
      basePath: "/admin",
      allowedGroups: ["gitea-oidc-admins"],
      sessionTtlSeconds: 3600,
    });
    expect(result.portal).toEqual({
      enabled: false,
      basePath: "/portal",
      clientId: "",
      sessionTtlSeconds: 3600,
    });
    expect(result.clients[0].redirect_uris).toEqual([
      "http://localhost:3001/user/oauth2/gitea/callback",
    ]);
  });

  it("falls back to default config when no file found", async () => {
    const validated = {
      valid: true,
      warnings: ["dev defaults"],
      errors: [],
      config: {
        server: { url: "http://localhost:3000" },
        auth: { providers: { local: { enabled: true } } },
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({ url: "http://localhost:3000" }),
        oidc: expect.objectContaining({
          cookieKeys: ["dev-cookie-key-change-me-32-chars-min"],
        }),
        audit: { enabled: true, retentionDays: 30 },
        auth: expect.objectContaining({ autoRedirectSingleProvider: false }),
        clients: [
          expect.objectContaining({
            client_id: "gitea",
            client_secret: "dev-client-secret-change-me",
          }),
        ],
      }),
    );
    expect(mockPrintValidationResult).toHaveBeenCalledWith(validated);
    expect(result.server.url).toBe("http://localhost:3000");
    expect(result.auth.providers.local.enabled).toBe(true);
  });

  it("throws in production when no config file is found", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { loadConfig } = await importConfigModule();

    await expect(loadConfig()).rejects.toThrow(/生产环境必须提供/);
    expect(mockValidateConfig).not.toHaveBeenCalled();
  });

  it("loads JS config (function export) and merges before验证", async () => {
    const jsConfig = `export default () => ({
      server: { port: 4100 },
      logging: { level: 'warn' }
    });`;
    writeFileSync(join(tempDir, "gitea-oidc.config.js"), jsConfig);
    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: { server: { port: 4100 } },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({ port: 4100 }),
        logging: expect.objectContaining({ level: "warn" }),
      }),
    );
    expect(result).toBe(validated.config);
  });

  it("throws when JS config fails to load", async () => {
    const jsConfig = 'throw new Error("boom")';
    writeFileSync(join(tempDir, "gitea-oidc.config.js"), jsConfig);

    const { loadConfig } = await importConfigModule();

    await expect(loadConfig()).rejects.toThrow(/JS 配置文件加载失败/);
    expect(mockValidateConfig).not.toHaveBeenCalled();
  });

  it("throws when JSON parsing fails", async () => {
    writeFileSync(join(tempDir, "gitea-oidc.config.json"), '{"server": ');

    const { loadConfig } = await importConfigModule();

    await expect(loadConfig()).rejects.toThrow(/JSON 配置文件解析失败/);
    expect(mockValidateConfig).not.toHaveBeenCalled();
  });

  it("loads trustProxy configuration from JSON config", async () => {
    const jsonConfig = {
      server: {
        host: "0.0.0.0",
        port: 3000,
        url: "https://oidc.example.com",
        trustProxy: true,
      },
      oidc: {
        issuer: "https://oidc.example.com/oidc",
      },
    };
    writeFileSync(join(tempDir, "gitea-oidc.config.json"), JSON.stringify(jsonConfig));

    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: {
          host: "0.0.0.0",
          port: 3000,
          url: "https://oidc.example.com",
          trustProxy: true,
        },
        oidc: {
          issuer: "https://oidc.example.com/oidc",
        },
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({
          trustProxy: true,
          url: "https://oidc.example.com",
        }),
      }),
    );
    expect(result.server.trustProxy).toBe(true);
    expect(result.server.url).toBe("https://oidc.example.com");
  });

  it("replaces default auth providers when a config explicitly provides providers", async () => {
    writeFileSync(
      join(tempDir, "gitea-oidc.config.json"),
      JSON.stringify({
        auth: {
          providers: {
            feishu: {
              enabled: false,
              displayName: "飞书登录",
              config: {},
            },
          },
        },
      }),
    );
    mockValidateConfig.mockImplementation((config) => ({
      valid: true,
      warnings: [],
      errors: [],
      config,
    }));

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(result.auth.providers.feishu).toBeDefined();
    expect(result.auth.providers.local).toBeUndefined();
  });

  it("loads trustProxy configuration from JS config", async () => {
    const jsConfig = `export default {
      server: { 
        host: '0.0.0.0',
        port: 3000,
        url: 'https://oidc.example.com',
        trustProxy: true
      },
      oidc: {
        issuer: 'https://oidc.example.com/oidc'
      }
    };`;
    writeFileSync(join(tempDir, "gitea-oidc.config.js"), jsConfig);

    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: {
          host: "0.0.0.0",
          port: 3000,
          url: "https://oidc.example.com",
          trustProxy: true,
        },
        oidc: {
          issuer: "https://oidc.example.com/oidc",
        },
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({
          trustProxy: true,
          url: "https://oidc.example.com",
        }),
      }),
    );
    expect(result.server.trustProxy).toBe(true);
  });

  it("defaults trustProxy to false when not specified", async () => {
    const jsonConfig = {
      server: {
        port: 3000,
        url: "http://localhost:3000",
      },
    };
    writeFileSync(join(tempDir, "gitea-oidc.config.json"), JSON.stringify(jsonConfig));

    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: {
          host: "0.0.0.0",
          port: 3000,
          url: "http://localhost:3000",
          trustProxy: false,
        },
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    // 验证默认配置被合并
    expect(result.server.trustProxy).toBe(false);
  });

  it("throws when validation fails instead of terminating the host process", async () => {
    writeFileSync(
      join(tempDir, "gitea-oidc.config.json"),
      JSON.stringify({ server: { port: 4001 } }),
    );
    const invalidResult = {
      valid: false,
      errors: [{ path: "server", message: "invalid", code: "invalid_type" }],
      warnings: [],
    };
    mockValidateConfig.mockReturnValue(invalidResult as any);
    const { loadConfig } = await importConfigModule();

    await expect(loadConfig()).rejects.toThrow("server: invalid");
    expect(mockPrintValidationResult).toHaveBeenCalledWith(invalidResult);
  });
});

describe("defineConfig", () => {
  it("should return the provided config", async () => {
    const module = await import("../config.js");
    const input = { foo: "bar" } as any;

    expect(module.defineConfig(input)).toBe(input);
  });
});
