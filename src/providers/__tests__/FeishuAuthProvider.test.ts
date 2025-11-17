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
    vi.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('fetch not mocked'));
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
});
