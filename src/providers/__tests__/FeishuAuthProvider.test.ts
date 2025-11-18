import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCipheriv, createHash } from 'crypto';

import { PluginPermission } from '../../types/auth';
import type { AuthContext, AuthProviderConfig, FeishuAuthConfig, UserInfo } from '../../types/auth';
import { FeishuAuthProvider } from '../FeishuAuthProvider';
import { AuthErrors } from '../../utils/authErrors';
import { Logger } from '../../utils/Logger';

const baseProviderConfig: AuthProviderConfig = {
  enabled: true,
  displayName: 'Feishu',
  config: {
    appId: 'app-test',
    appSecret: 'secret-test',
    redirectUri: 'https://example.com/callback',
    scope: 'user_info',
    userMapping: {},
    groupMapping: { 研发部: 'dev-group' },
  } satisfies FeishuAuthConfig,
};

type CoordinatorMock = {
  generateOAuthState: ReturnType<typeof vi.fn>;
  verifyOAuthState: ReturnType<typeof vi.fn>;
  storeAuthResult: ReturnType<typeof vi.fn>;
};

describe('FeishuAuthProvider', () => {
  let provider: FeishuAuthProvider;
  let userRepository: {
    findOrCreate: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let coordinator: CoordinatorMock;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const createContext = (overrides: Partial<AuthContext> = {}): AuthContext => ({
    authMethod: overrides.authMethod ?? 'feishu',
    interactionUid: overrides.interactionUid ?? 'interaction-1',
    request: overrides.request ?? ({ headers: { 'user-agent': 'vitest' }, ip: '127.0.0.1' } as any),
    reply: overrides.reply ?? ({} as any),
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? { authMethod: 'feishu' },
  });

  beforeEach(() => {
    userRepository = {
      findOrCreate: vi.fn(),
      findById: vi.fn(),
    };
    coordinator = {
      generateOAuthState: vi.fn(),
      verifyOAuthState: vi.fn(),
      storeAuthResult: vi.fn(),
    };

    provider = new FeishuAuthProvider(userRepository as any, coordinator as any);
    (provider as any).config = baseProviderConfig.config;
    (provider as any).appAccessToken = 'app-token';
    (provider as any).tokenExpiresAt = Date.now() + 1000 * 60;
    fetchSpy = vi.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('fetch not mocked'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const encryptFeishuPayload = (encryptKey: string, data: Record<string, any>): string => {
    const keyHash = createHash('sha256').update(encryptKey).digest();
    const iv = keyHash.slice(0, 16);
    const randomPrefix = Buffer.from('1234567890123456');
    const json = Buffer.from(JSON.stringify(data));
    const plain = Buffer.concat([randomPrefix, json, Buffer.from('app_id')]);
    const cipher = createCipheriv('aes-256-cbc', keyHash, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return encrypted.toString('base64');
  };

  describe('canHandle', () => {
    it('returns true when authMethod matches', () => {
      expect(provider.canHandle(createContext())).toBe(true);
    });

    it('returns true when body authMethod matches', () => {
      expect(
        provider.canHandle(
          createContext({ authMethod: 'other', body: { authMethod: 'feishu' } as any }),
        ),
      ).toBe(true);
    });

    it('returns false when neither matches', () => {
      expect(
        provider.canHandle(
          createContext({ authMethod: 'other', body: { authMethod: 'local' } as any }),
        ),
      ).toBe(false);
    });
  });

  describe('renderLoginUI', () => {
    it('generates state and returns redirect url', async () => {
      coordinator.generateOAuthState.mockResolvedValue('state-123');
      const context = createContext({ interactionUid: 'interaction-abc' });

      const result = await provider.renderLoginUI(context);

      expect(coordinator.generateOAuthState).toHaveBeenCalledWith('interaction-abc', 'feishu', {
        userAgent: 'vitest',
        ip: '127.0.0.1',
      });
      expect(result.type).toBe('redirect');
      expect(result.redirectUrl).toContain('https://open.feishu.cn/open-apis/authen/v1/authorize');
      expect(result.redirectUrl).toContain('state=state-123');
      expect(result.redirectUrl).toContain('app_id=app-test');
    });
  });

  describe('handleCallback', () => {
    it('returns missingParameter when code or state absent', async () => {
      const result = await provider.handleCallback(createContext({ query: {} }));

      expect(result).toEqual({
        success: false,
        error: AuthErrors.missingParameter(['code', 'state']),
      });
    });

    it('returns stateExpired when verifyOAuthState returns null', async () => {
      coordinator.verifyOAuthState.mockResolvedValue(null);

      const result = await provider.handleCallback(
        createContext({ query: { code: 'abc', state: 'state-1' } as any }),
      );

      expect(result).toEqual({ success: false, error: AuthErrors.stateExpired() });
    });

    it('returns invalidState when provider mismatches', async () => {
      coordinator.verifyOAuthState.mockResolvedValue({ provider: 'local' });

      const result = await provider.handleCallback(
        createContext({ query: { code: 'abc', state: 'state-1' } as any }),
      );

      expect(result).toEqual({ success: false, error: AuthErrors.invalidState('state-1') });
    });

    it('returns oauthCallbackFailed when exchange code fails', async () => {
      coordinator.verifyOAuthState.mockResolvedValue({ provider: 'feishu', interactionUid: 'i-1' });
      vi.spyOn(provider as any, 'exchangeCodeForToken').mockRejectedValue(new Error('failed to exchange'));

      const result = await provider.handleCallback(
        createContext({ query: { code: 'abc', state: 'state-1' } as any }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthErrors.oauthCallbackFailed('飞书登录失败').code);
    });

    it('returns success and userId when flow completes', async () => {
      const feishuUser = {
        open_id: 'open-1',
        name: '张三',
        en_name: 'zhangsan',
        email: 'test@example.com',
        fullInfo: {
          department_path: [
            {
              department_name: {
                name: '研发部',
                i18n_name: { en_us: 'R&D', ja_jp: '', zh_cn: '研发部' },
              },
            } as any,
          ],
        },
      } as any;

      coordinator.verifyOAuthState.mockResolvedValue({ provider: 'feishu', interactionUid: 'i-uid' });
      vi.spyOn(provider as any, 'exchangeCodeForToken').mockResolvedValue('user-token');
      vi.spyOn(provider as any, 'getFeishuUserInfo').mockResolvedValue(feishuUser);
      const user: UserInfo = {
        sub: 'user-1',
        username: 'zhangsan',
        name: '张三',
        email: 'test@example.com',
        authProvider: 'feishu',
        externalId: 'open-1',
      } as UserInfo;
      userRepository.findOrCreate.mockResolvedValue(user);

      const result = await provider.handleCallback(
        createContext({ query: { code: 'abc', state: 'state-1' } as any }),
      );

      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.metadata?.interactionUid).toBe('i-uid');
      expect(userRepository.findOrCreate).toHaveBeenCalledWith('feishu', 'open-1', expect.objectContaining({
        username: 'open-1',
        email: 'test@example.com',
        groups: expect.arrayContaining(['dev-group']),
      }));
    });
  });

  describe('refreshAppAccessToken', () => {
    it('should store token and expiry when fetch succeeds', async () => {
      const response = {
        json: vi.fn().mockResolvedValue({ code: 0, app_access_token: 'new-token', expires_in: 100 }),
      };
      fetchSpy.mockResolvedValue(response as any);

      await (provider as any).refreshAppAccessToken();

      expect((provider as any).appAccessToken).toBe('new-token');
      expect((provider as any).tokenExpiresAt).toBeGreaterThan(Date.now());
    });

    it('should throw when fetch returns error code', async () => {
      const response = {
        json: vi.fn().mockResolvedValue({ code: 1, msg: 'invalid' }),
      };
      fetchSpy.mockResolvedValue(response as any);

      await expect((provider as any).refreshAppAccessToken()).rejects.toThrow('invalid');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should refresh app token when expired before exchange', async () => {
      (provider as any).tokenExpiresAt = Date.now() - 1000;
      const refreshSpy = vi.spyOn(provider as any, 'refreshAppAccessToken').mockResolvedValue(undefined);
      const response = {
        json: vi.fn().mockResolvedValue({ code: 0, data: { access_token: 'user-token' } }),
      };
      fetchSpy.mockResolvedValue(response as any);

      const token = await (provider as any).exchangeCodeForToken('code-123');

      expect(refreshSpy).toHaveBeenCalled();
      expect(token).toBe('user-token');
    });

    it('throws when Feishu returns error', async () => {
      const response = {
        json: vi.fn().mockResolvedValue({ code: 8, msg: 'bad code' }),
      };
      fetchSpy.mockResolvedValue(response as any);

      await expect((provider as any).exchangeCodeForToken('code-abc')).rejects.toThrow(/bad code/);
    });
  });

  describe('getFeishuUserInfo', () => {
    it('returns merged user data with full info', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue({ code: 0, data: { open_id: 'open-1', name: 'Alice' } }),
        } as any)
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue({ code: 0, data: { user: { department_path: [] } } }),
        } as any);

      const result = await (provider as any).getFeishuUserInfo('user-token');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.open_id).toBe('open-1');
      expect(result.fullInfo).toEqual({ department_path: [] });
    });

    it('throws when user info fetch fails', async () => {
      fetchSpy.mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ code: 2, msg: 'denied' }) } as any);

      await expect((provider as any).getFeishuUserInfo('user-token')).rejects.toThrow(/denied/);
    });

    it('throws when full user info fetch fails', async () => {
      fetchSpy
        .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ code: 0, data: { open_id: 'open-1' } }) } as any)
        .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ code: 3, msg: 'no access' }) } as any);

      await expect((provider as any).getFeishuUserInfo('token')).rejects.toThrow(/no access/);
    });
  });

  describe('静态资源与元数据', () => {
    it('registerStaticAssets 返回 svg 资源', () => {
      const assets = provider.registerStaticAssets();

      expect(assets[0]).toMatchObject({ path: '/icon.svg', contentType: 'image/svg+xml' });
    });

    it('getMetadata 返回健康状态并包含权限', () => {
      (provider as any).appAccessToken = 'token';
      (provider as any).tokenExpiresAt = Date.now() + 10_000;

      const metadata = provider.getMetadata();

      expect(metadata.permissions).toEqual(
        expect.arrayContaining([
          PluginPermission.READ_USER,
          PluginPermission.CREATE_USER,
          PluginPermission.REGISTER_WEBHOOK,
        ]),
      );
      expect(metadata.status?.healthy).toBe(true);
      expect(metadata.status?.stats?.appId).toContain('app-test'.substring(0, 8));
    });

    it('destroy 会清空 token 并令 isTokenValid 失效', async () => {
      (provider as any).appAccessToken = 'token';
      (provider as any).tokenExpiresAt = Date.now() + 10_000;

      await provider.destroy();

      expect((provider as any).appAccessToken).toBeUndefined();
      expect((provider as any).tokenExpiresAt).toBeUndefined();
      expect((provider as any).isTokenValid()).toBe(false);
    });
  });

  describe('字段映射', () => {
    beforeEach(() => {
      (provider as any).config.userMapping = {
        username: 'custom_username',
        name: 'custom_name',
        email: 'custom_email',
      };
      (provider as any).config.groupMapping = { 研发部: 'dev-group' };
    });

    it('map* 函数应遵循映射配置', () => {
      const feishuUser: any = {
        open_id: 'open-1',
        en_name: 'english',
        name: '中文名',
        custom_username: 'mapped-user',
        custom_name: 'mapped-name',
        custom_email: 'mapped@example.com',
        fullInfo: {
          department_path: [
            { department_name: { name: '研发部' } },
          ],
        },
      };

      expect((provider as any).mapUsername(feishuUser)).toBe('mapped-user');
      expect((provider as any).mapName(feishuUser)).toBe('mapped-name');
      expect((provider as any).mapEmail(feishuUser)).toBe('mapped@example.com');
      expect((provider as any).mapGroups(feishuUser)).toEqual(['Owners', 'dev-group']);
    });

    it('mapGroups 在无映射时返回部门名称并追加 Owners', () => {
      delete (provider as any).config.groupMapping;
      const feishuUser: any = {
        open_id: 'open-1',
        en_name: 'english',
        name: '中文名',
        fullInfo: {
          department_path: [
            { department_name: { name: 'DeptA' } },
            { department_name: { name: 'DeptB' } },
          ],
        },
      };

      expect((provider as any).mapGroups(feishuUser)).toEqual(['DeptA', 'DeptB', 'Owners']);
    });

    it('缺少映射字段时使用默认值', () => {
      delete (provider as any).config.userMapping;
      const feishuUser: any = {
        open_id: 'open-1',
        en_name: 'english-name',
        name: '中文名',
      };

      expect((provider as any).mapUsername(feishuUser)).toBe('open-1');
      expect((provider as any).mapName(feishuUser)).toBe('中文名');
      expect((provider as any).mapEmail(feishuUser)).toBe('open-1@feishu.local');
    });
  });

  describe('registerRoutes', () => {
    it('redirects user when callback returns success', async () => {
      const handleSpy = vi.spyOn(provider as any, 'handleCallback').mockResolvedValue({
        success: true,
        userId: 'user-1',
        metadata: { interactionUid: 'i-123' },
      });
      const routes = provider.registerRoutes();
      const callbackRoute = routes.find(route => route.method === 'GET' && route.path === '/callback');
      const request = {
        method: 'GET',
        query: { code: 'abc', state: 'state-1' },
        body: null,
        params: {},
        headers: { 'content-type': 'application/json' },
      } as any;
      const reply = {
        redirect: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;
      coordinator.storeAuthResult.mockResolvedValue(undefined);

      await callbackRoute?.handler(request, reply);

      expect(handleSpy).toHaveBeenCalled();
      expect(coordinator.storeAuthResult).toHaveBeenCalledWith('i-123', 'user-1');
      expect(reply.redirect).toHaveBeenCalledWith('/interaction/i-123/complete');
    });

    it('returns 400 when callback fails', async () => {
      const handleSpy = vi.spyOn(provider as any, 'handleCallback').mockResolvedValue({
        success: false,
        error: AuthErrors.invalidState('state-1'),
      });
      const routes = provider.registerRoutes();
      const callbackRoute = routes.find(route => route.method === 'GET' && route.path === '/callback');
      const request = {
        method: 'GET',
        query: { code: 'abc', state: 'state-1' },
        body: null,
        params: {},
        headers: { 'content-type': 'application/json' },
      } as any;
      const reply = {
        redirect: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await callbackRoute?.handler(request, reply);

      expect(handleSpy).toHaveBeenCalled();
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: '无效的认证状态' });
    });

    it('处理加密 challenge 请求并返回 challenge', async () => {
      const decryptSpy = vi
        .spyOn(provider as any, 'decryptFeishuData')
        .mockReturnValue({ type: 'url_verification', challenge: 'enc-token' });
      const routes = provider.registerRoutes();
      const callbackRoute = routes.find(route => route.method === 'POST' && route.path === '/callback');
      const request = {
        method: 'POST',
        body: { encrypt: 'encrypted-payload' },
        headers: {},
      } as any;
      const reply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
        redirect: vi.fn(),
      } as any;

      await callbackRoute?.handler(request, reply);

      expect(decryptSpy).toHaveBeenCalledWith('encrypted-payload');
      expect(reply.send).toHaveBeenCalledWith({ challenge: 'enc-token' });
    });

    it('加密请求解密失败时返回 400', async () => {
      vi.spyOn(provider as any, 'decryptFeishuData').mockImplementation(() => {
        throw new Error('boom');
      });
      const routes = provider.registerRoutes();
      const callbackRoute = routes.find(route => route.method === 'POST' && route.path === '/callback');
      const request = {
        method: 'POST',
        body: { encrypt: 'payload' },
        headers: {},
      } as any;
      const reply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
        redirect: vi.fn(),
      } as any;

      await callbackRoute?.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Decryption failed' });
    });

    it('处理明文 challenge 请求', async () => {
      const routes = provider.registerRoutes();
      const callbackRoute = routes.find(route => route.method === 'POST' && route.path === '/callback');
      const request = {
        method: 'POST',
        body: { challenge: 'plain-token' },
        headers: {},
      } as any;
      const reply = {
        send: vi.fn(),
        code: vi.fn().mockReturnThis(),
        redirect: vi.fn(),
      } as any;

      await callbackRoute?.handler(request, reply);

      expect(reply.send).toHaveBeenCalledWith({ challenge: 'plain-token' });
    });

    it('handleCallback 成功但缺少 interactionUid 时返回 400', async () => {
      vi.spyOn(provider as any, 'handleCallback').mockResolvedValue({
        success: true,
        userId: 'user-1',
        metadata: {},
      });
      const routes = provider.registerRoutes();
      const callbackRoute = routes.find(route => route.method === 'GET' && route.path === '/callback');
      const request = {
        method: 'GET',
        query: { code: 'abc', state: 'state-1' },
        body: null,
        params: {},
        headers: { 'content-type': 'application/json' },
      } as any;
      const reply = {
        redirect: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await callbackRoute?.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid or expired state' });
    });

    it('status 路由返回插件状态', async () => {
      (provider as any).appAccessToken = 'token';
      (provider as any).tokenExpiresAt = Date.now() + 10_000;
      const routes = provider.registerRoutes();
      const statusRoute = routes.find(route => route.path === '/status');

      const result = await statusRoute?.handler({} as any, {} as any);

      expect(result).toEqual({
        provider: 'feishu',
        configured: true,
        tokenValid: true,
      });
    });
  });

  describe('decryptFeishuData', () => {
    it('should decrypt payload when encrypt key is configured', () => {
      const key = 'encrypt-key-123';
      (provider as any).config.encryptKey = key;
      const payload = { challenge: 'abc', type: 'url_verification' };
      const encrypted = encryptFeishuPayload(key, payload);

      const result = (provider as any).decryptFeishuData(encrypted);

      expect(result).toEqual(payload);
    });

    it('should throw when encrypt key missing', () => {
      delete (provider as any).config.encryptKey;
      expect(() => (provider as any).decryptFeishuData('payload')).toThrow('Encrypt key not configured');
    });

    it('解密失败时会记录错误并抛出', () => {
      (provider as any).config.encryptKey = 'key';
      const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});

      expect(() => (provider as any).decryptFeishuData('invalid-base64')).toThrow();
      expect(errorSpy).toHaveBeenCalledWith('[FeishuAuth] Failed to decrypt data:', expect.any(Error));
    });
  });

  describe('verifyFeishuSignature', () => {
    it('returns false when headers missing', async () => {
      const result = await (provider as any).verifyFeishuSignature({ headers: {}, body: {} } as any);
      expect(result).toBe(false);
    });

    it('skips verification when token not configured', async () => {
      delete (provider as any).config.verificationToken;
      const request = {
        headers: {
          'x-lark-signature': 'sig',
          'x-lark-request-timestamp': '111',
          'x-lark-request-nonce': 'nonce',
        },
        body: {},
      } as any;
      const result = await (provider as any).verifyFeishuSignature(request);
      expect(result).toBe(true);
    });

    it('validates correct signature', async () => {
      (provider as any).config.verificationToken = 'token-123';
      const timestamp = `${Math.floor(Date.now() / 1000)}`;
      const nonce = 'nonce-1';
      const body = { foo: 'bar' };
      const signature = createHash('sha256')
        .update(`${timestamp}${nonce}token-123${JSON.stringify(body)}`)
        .digest('hex');

      const result = await (provider as any).verifyFeishuSignature({
        headers: {
          'x-lark-signature': signature,
          'x-lark-request-timestamp': timestamp,
          'x-lark-request-nonce': nonce,
        },
        body,
      } as any);

      expect(result).toBe(true);
    });

    it('returns false for invalid signature', async () => {
      (provider as any).config.verificationToken = 'token-abc';
      const request = {
        headers: {
          'x-lark-signature': 'invalid',
          'x-lark-request-timestamp': '1',
          'x-lark-request-nonce': '2',
        },
        body: { foo: 'bar' },
      } as any;

      const result = await (provider as any).verifyFeishuSignature(request);

      expect(result).toBe(false);
    });

    it('JSON.stringify 失败时返回 false 并记录错误', async () => {
      (provider as any).config.verificationToken = 'token-123';
      const body: any = {};
      body.self = body;
      const timestamp = '1';
      const nonce = '2';
      const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});

      const result = await (provider as any).verifyFeishuSignature({
        headers: {
          'x-lark-signature': 'sig',
          'x-lark-request-timestamp': timestamp,
          'x-lark-request-nonce': nonce,
        },
        body,
      } as any);

      expect(result).toBe(false);
      expect(loggerSpy).toHaveBeenCalledWith('[FeishuAuth] Error verifying signature:', expect.any(TypeError));
    });
  });

  describe('registerWebhooks', () => {
    it('returns challenge for url verification', async () => {
      const webhooks = provider.registerWebhooks();
      const webhook = webhooks[0];
      const response = await webhook.handler(
        { body: { type: 'url_verification', challenge: 'challenge-token' } } as any,
        {} as any,
      );

      expect(response).toEqual({ challenge: 'challenge-token' });
    });

    it('returns success for other events', async () => {
      const webhooks = provider.registerWebhooks();
      const webhook = webhooks[0];
      const response = await webhook.handler({ body: { type: 'user.updated', event: { id: 1 } } } as any, {} as any);

      expect(response).toEqual({ success: true });
    });

    it('delegates verifySignature to verifyFeishuSignature', async () => {
      const spy = vi.spyOn(provider as any, 'verifyFeishuSignature').mockResolvedValue(true);
      const webhooks = provider.registerWebhooks();
      const webhook = webhooks[0];
      const request = { headers: {}, body: {} } as any;

      const result = await webhook.verifySignature?.(request);

      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(request);
    });
  });
});
