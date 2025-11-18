import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mockValidateConfig = vi.fn();
const mockPrintValidationResult = vi.fn();

vi.mock('../utils/configValidator', () => ({
  validateConfig: mockValidateConfig,
  printValidationResult: mockPrintValidationResult,
}));

describe('loadConfig', () => {
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let tempDir: string;

  const importConfigModule = async () => {
    const module = await import('../config');
    return module;
  };

  beforeEach(() => {
    vi.resetModules();
    mockValidateConfig.mockReset();
    mockPrintValidationResult.mockReset();
    tempDir = mkdtempSync(join(tmpdir(), 'gitea-oidc-config-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads and merges JSON config, then validates', async () => {
    const jsonConfig = {
      server: { port: 4000 },
      logging: { level: 'debug' },
      auth: {
        providers: {
          local: {
            enabled: false,
          },
        },
      },
    };
    writeFileSync(join(tempDir, 'gitea-oidc.config.json'), JSON.stringify(jsonConfig));

    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: { host: '0.0.0.0', port: 4000, url: 'http://localhost:3000' },
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({ port: 4000 }),
        logging: expect.objectContaining({ level: 'debug' }),
      }),
    );
    expect(mockPrintValidationResult).toHaveBeenCalledWith(validated);
    expect(result).toBe(validated.config);
  });

  it('falls back to default config when no file found', async () => {
    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).not.toHaveBeenCalled();
    expect(result.server.url).toBe('http://localhost:3000');
    expect(result.auth.providers.local.enabled).toBe(true);
  });

  it('loads JS config (function export) and merges before验证', async () => {
    const jsConfig = `export default () => ({
      server: { port: 4100 },
      logging: { level: 'warn' }
    });`;
    writeFileSync(join(tempDir, 'gitea-oidc.config.js'), jsConfig);
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
        logging: expect.objectContaining({ level: 'warn' }),
      }),
    );
    expect(result).toBe(validated.config);
  });

  it('returns default config when JS config fails to load', async () => {
    const jsConfig = 'throw new Error("boom")';
    writeFileSync(join(tempDir, 'gitea-oidc.config.js'), jsConfig);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).not.toHaveBeenCalled();
    expect(result.server.port).toBe(3000);
  });

  it('returns default config when JSON parsing fails', async () => {
    writeFileSync(join(tempDir, 'gitea-oidc.config.json'), '{"server": ');

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).not.toHaveBeenCalled();
    expect(result.server.host).toBe('0.0.0.0');
  });

  it('loads trustProxy configuration from JSON config', async () => {
    const jsonConfig = {
      server: { 
        host: '0.0.0.0',
        port: 3000,
        url: 'https://oidc.example.com',
        trustProxy: true
      },
      oidc: {
        issuer: 'https://oidc.example.com'
      }
    };
    writeFileSync(join(tempDir, 'gitea-oidc.config.json'), JSON.stringify(jsonConfig));

    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: { 
          host: '0.0.0.0', 
          port: 3000, 
          url: 'https://oidc.example.com',
          trustProxy: true
        },
        oidc: {
          issuer: 'https://oidc.example.com'
        }
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({ 
          trustProxy: true,
          url: 'https://oidc.example.com'
        }),
      }),
    );
    expect(result.server.trustProxy).toBe(true);
    expect(result.server.url).toBe('https://oidc.example.com');
  });

  it('loads trustProxy configuration from JS config', async () => {
    const jsConfig = `export default {
      server: { 
        host: '0.0.0.0',
        port: 3000,
        url: 'https://oidc.example.com',
        trustProxy: true
      },
      oidc: {
        issuer: 'https://oidc.example.com'
      }
    };`;
    writeFileSync(join(tempDir, 'gitea-oidc.config.js'), jsConfig);
    
    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: { 
          host: '0.0.0.0', 
          port: 3000, 
          url: 'https://oidc.example.com',
          trustProxy: true
        },
        oidc: {
          issuer: 'https://oidc.example.com'
        }
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    expect(mockValidateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.objectContaining({ 
          trustProxy: true,
          url: 'https://oidc.example.com'
        }),
      }),
    );
    expect(result.server.trustProxy).toBe(true);
  });

  it('defaults trustProxy to false when not specified', async () => {
    const jsonConfig = {
      server: { 
        port: 3000,
        url: 'http://localhost:3000'
      }
    };
    writeFileSync(join(tempDir, 'gitea-oidc.config.json'), JSON.stringify(jsonConfig));

    const validated = {
      valid: true,
      warnings: [],
      errors: [],
      config: {
        server: { 
          host: '0.0.0.0', 
          port: 3000, 
          url: 'http://localhost:3000',
          trustProxy: false
        }
      },
    } as const;
    mockValidateConfig.mockReturnValue(validated);

    const { loadConfig } = await importConfigModule();
    const result = await loadConfig();

    // 验证默认配置被合并
    expect(result.server.trustProxy).toBe(false);
  });

  it('exits process when validation fails', async () => {
    writeFileSync(
      join(tempDir, 'gitea-oidc.config.json'),
      JSON.stringify({ server: { port: 4001 } }),
    );
    const invalidResult = { valid: false, errors: [{ path: 'server', message: 'invalid', code: 'invalid_type' }], warnings: [] };
    mockValidateConfig.mockReturnValue(invalidResult as any);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    const { loadConfig } = await importConfigModule();

    await expect(loadConfig()).resolves.toBeUndefined();
    expect(mockPrintValidationResult).toHaveBeenCalledWith(invalidResult);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

describe('defineConfig', () => {
  it('should return the provided config', async () => {
    const module = await import('../config');
    const input = { foo: 'bar' } as any;

    expect(module.defineConfig(input)).toBe(input);
  });
});
