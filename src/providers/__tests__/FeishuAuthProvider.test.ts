import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthContext, AuthProviderConfig, FeishuAuthConfig, UserInfo } from '../../types/auth';
import { FeishuAuthProvider } from '../FeishuAuthProvider';
import { AuthErrors } from '../../utils/authErrors';

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
    fetchSpy.mockRestore();
  });

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
        username: 'zhangsan',
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
      vi.spyOn(provider as any, 'handleCallback').mockResolvedValue({
        success: false,
        error: AuthErrors.invalidState('bad-state'),
      });
      const routes = provider.registerRoutes();
      const callbackRoute = routes.find(route => route.method === 'GET' && route.path === '/callback');
      const request = {
        method: 'GET',
        query: { code: 'abc', state: 'state-1' },
        body: null,
        headers: { 'content-type': 'application/json' },
      } as any;
      const reply = {
        redirect: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await callbackRoute?.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: '无效的认证状态' });
    });
  });
});
