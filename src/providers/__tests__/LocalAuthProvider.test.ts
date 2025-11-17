import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthContext, AuthProviderConfig, AuthResult, UserInfo } from '../../types/auth';
import { LocalAuthProvider } from '../LocalAuthProvider';
import { AuthErrors } from '../../utils/authErrors';

const mocks = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  bcryptCompareMock: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.readFileMock,
}));

vi.mock('bcrypt', () => ({
  compare: mocks.bcryptCompareMock,
}));

describe('LocalAuthProvider', () => {
  let provider: LocalAuthProvider;
  const userRepository = {
    findOrCreate: vi.fn<(provider: string, externalId: string, data: any) => Promise<UserInfo>>(),
    findById: vi.fn<(id: string) => Promise<UserInfo | null>>(),
  } as unknown as any;

  const baseConfig: AuthProviderConfig = {
    enabled: true,
    displayName: 'Local',
    config: {
      passwordFile: '/tmp/.htpasswd',
      passwordFormat: 'auto',
    },
  };

  const fakeRequest = {} as FastifyRequest;
  const fakeReply = {} as FastifyReply;

  const createContext = (overrides: Partial<AuthContext> = {}): AuthContext => ({
    authMethod: overrides.authMethod ?? 'local',
    interactionUid: overrides.interactionUid ?? 'interaction-123',
    request: overrides.request ?? fakeRequest,
    reply: overrides.reply ?? fakeReply,
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: {
      authMethod: 'local',
      username: 'alice',
      password: 'secret',
      ...overrides.body,
    },
    interaction: overrides.interaction,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LocalAuthProvider(userRepository);
    mocks.readFileMock.mockResolvedValue('alice:$2b$10$hash123\n#comment\n bob:plain');
  });

  it('initialize 应该读取密码文件', async () => {
    await provider.initialize(baseConfig);

    expect(mocks.readFileMock).toHaveBeenCalledWith('/tmp/.htpasswd', 'utf-8');
    expect((provider as any).passwordMap.get('alice')).toBe('$2b$10$hash123');
    expect((provider as any).passwordMap.get('bob')).toBe('plain');
  });

  it('initialize 在读取失败时应抛出错误', async () => {
    mocks.readFileMock.mockRejectedValueOnce(new Error('fs error'));

    await expect(provider.initialize(baseConfig)).rejects.toThrow(
      'Failed to load password file: /tmp/.htpasswd'
    );
  });

  it('canHandle 应根据 context 判断', async () => {
    await provider.initialize(baseConfig);
    expect(provider.canHandle(createContext())).toBe(true);
    expect(
      provider.canHandle(
        createContext({ authMethod: 'other', body: { authMethod: 'other', username: 'x', password: 'y' } })
      )
    ).toBe(false);
  });

  it('renderLoginUI 应返回带隐藏字段的表单', async () => {
    await provider.initialize(baseConfig);
    const ui = await provider.renderLoginUI(createContext({ query: { error: 'Oops' } as any }));

    expect(ui.type).toBe('html');
    expect(ui.html).toContain('name="authMethod" value="local"');
    expect(ui.html).toContain('Oops');
  });

  describe('authenticate', () => {
    beforeEach(async () => {
      await provider.initialize(baseConfig);
    });

    it('缺少用户名或密码时返回缺参错误', async () => {
      const result = await provider.authenticate(createContext({
        body: { authMethod: 'local', username: '', password: '' },
      }));

      const expected = AuthErrors.missingParameter(['username', 'password']);
      expect(result).toEqual({ success: false, error: expected });
    });

    it('用户不存在时返回 invalidCredentials', async () => {
      const result = await provider.authenticate(createContext({
        body: { authMethod: 'local', username: 'unknown', password: 'secret' },
      }));

      expect(result.error).toEqual(AuthErrors.invalidCredentials({ username: 'unknown' }));
      expect(result.success).toBe(false);
    });

    it('密码不正确时返回 passwordIncorrect', async () => {
      const context = createContext();
      mocks.bcryptCompareMock.mockResolvedValue(false);

      const result = await provider.authenticate(context);

      expect(result.error).toEqual(AuthErrors.passwordIncorrect('alice'));
      expect(result.success).toBe(false);
    });

    it('验证成功时调用 findOrCreate 并返回成功', async () => {
      const user = {
        sub: 'user-1',
        username: 'alice',
        name: 'alice',
        email: 'alice@local',
        authProvider: 'local',
        externalId: 'alice',
      } as UserInfo;
      mocks.bcryptCompareMock.mockResolvedValue(true);
      userRepository.findOrCreate.mockResolvedValue(user);

      const result = await provider.authenticate(createContext());

      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(userRepository.findOrCreate).toHaveBeenCalledWith('local', 'alice', {
        username: 'alice',
        name: 'alice',
        email: 'alice@local',
        emailVerified: false,
      });
    });
  });

  describe('detectPasswordFormat', () => {
    beforeEach(async () => {
      await provider.initialize(baseConfig);
    });

    it('根据前缀返回对应格式', () => {
      const detect = (provider as any).detectPasswordFormat.bind(provider);
      expect(detect('$2b$hash')).toBe('bcrypt');
      expect(detect('$apr1$salt$hash')).toBe('md5');
      expect(detect('{SHA}abc')).toBe('sha');
      (provider as any).config.passwordFormat = 'md5';
      expect(detect('custom')).toBe('md5');
      delete (provider as any).config.passwordFormat;
      expect(detect('plain')).toBe('plain');
    });
  });
});
