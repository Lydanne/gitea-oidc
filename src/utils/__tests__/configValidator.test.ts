import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  validateConfig,
  formatValidationErrors,
  formatWarnings,
  printValidationResult,
} from '../configValidator';
import { Logger } from '../Logger';
import type { GiteaOidcConfig } from '../../config';

const createBaseConfig = (): GiteaOidcConfig => ({
  server: {
    host: '0.0.0.0',
    port: 3000,
    url: 'https://id.example.com',
    trustProxy: false,
  },
  logging: {
    enabled: true,
    level: 'info',
  },
  oidc: {
    issuer: 'https://id.example.com',
    cookieKeys: ['A'.repeat(32), 'B'.repeat(32)],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
    claims: {
      openid: ['sub'],
      profile: ['name', 'email'],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
    },
  },
  clients: [
    {
      client_id: 'web-app',
      client_secret: 'super-secret-value-123',
      redirect_uris: ['https://app.example.com/callback'],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'client_secret_basic',
    },
  ],
  auth: {
    userRepository: {
      type: 'memory',
      memory: {},
    },
    providers: {
      local: {
        enabled: true,
        displayName: 'Local',
        config: {
          passwordFile: '/etc/htpasswd',
        },
      },
      feishu: {
        enabled: false,
        displayName: 'Feishu',
        config: {},
      },
    },
  },
});

describe('validateConfig', () => {
  it('should return valid result without warnings for correct config', () => {
    const result = validateConfig(createBaseConfig());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toEqual([]);
    expect(result.config?.server.url).toBe('https://id.example.com');
  });

  it('should collect zod errors when invalid config provided', () => {
    const invalid = { server: {} };

    const result = validateConfig(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty('message');
  });

  it('should report general security warnings', () => {
    const config = createBaseConfig();
    config.oidc.cookieKeys = [
      'change-this-to-a-random-string-in-production',
      'B'.repeat(32),
    ];
    config.clients[0].client_secret = 'shortsecret';
    config.clients[0].redirect_uris = ['http://example.com/callback'];
    config.server.url = 'http://id.example.com';
    config.auth.providers.local.enabled = false;
    config.auth.providers.feishu.enabled = false;
    config.clients.push({
      client_id: 'legacy-app',
      client_secret: 'gitea-client-secret-change-in-production',
      redirect_uris: ['https://legacy.example.com/cb'],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'client_secret_basic',
    });

    const result = validateConfig(config);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('默认 Cookie 密钥'),
        expect.stringContaining('客户端 #1 (web-app) 的密钥长度小于 16'),
        expect.stringContaining('客户端 "legacy-app" 使用默认密钥'),
        expect.stringContaining('服务器 URL 未使用 HTTPS'),
        expect.stringContaining('客户端 "web-app" 的重定向 URI'),
        expect.stringContaining('没有启用任何认证提供者'),
      ])
    );
  });

  it('should report provider specific warnings', () => {
    const config = createBaseConfig();
    config.auth.providers.local.enabled = true;
    (config.auth.providers.local.config as any).passwordFile = undefined;
    config.auth.providers.feishu.enabled = true;
    config.auth.providers.feishu.config = { appId: '', appSecret: '' } as any;

    const result = validateConfig(config);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('本地认证已启用但未配置 passwordFile'),
        expect.stringContaining('飞书认证已启用但未配置 appId 或 appSecret'),
      ])
    );
  });
});

describe('formatValidationErrors', () => {
  it('should format errors into readable string', () => {
    const message = formatValidationErrors([
      { path: 'server.url', message: 'invalid url', code: 'invalid_string' },
      { path: '', message: 'general error', code: 'custom' },
    ]);

    expect(message).toContain('配置项 "server.url"');
    expect(message).toContain('general error');
  });

  it('should return empty string when no errors', () => {
    expect(formatValidationErrors([])).toBe('');
  });
});

describe('formatWarnings', () => {
  it('should format warnings list', () => {
    const output = formatWarnings(['foo', 'bar']);

    expect(output).toBe('  - foo\n  - bar');
  });

  it('should return empty string when no warnings', () => {
    expect(formatWarnings([])).toBe('');
  });
});

describe('printValidationResult', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(Logger, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should log errors when validation fails', () => {
    const result = {
      valid: false,
      errors: [{ path: 'server.url', message: 'invalid', code: 'invalid_string' }],
      warnings: [],
    };

    printValidationResult(result);

    expect(errorSpy).toHaveBeenCalledTimes(3);
    expect(errorSpy.mock.calls[1][0]).toContain('server.url');
  });

  it('should log info and warnings when validation succeeds with warnings', () => {
    const result = {
      valid: true,
      warnings: ['warning message'],
      errors: [],
      config: createBaseConfig(),
    };

    printValidationResult(result);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy.mock.calls[1][0]).toContain('warning message');
  });
});
