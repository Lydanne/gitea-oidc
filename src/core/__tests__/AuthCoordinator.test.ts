import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthContext, AuthProvider, AuthProviderConfig, OAuthStateData } from '../../types/auth';
import { PluginPermission } from '../../types/auth';
import { AuthCoordinator } from '../AuthCoordinator';
import { PermissionChecker } from '../PermissionChecker';

describe('AuthCoordinator', () => {
  const fastifyStub = () => ({
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    route: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    addHook: vi.fn(),
  });

  const stateStoreMock = () => ({
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  });

  const userRepositoryMock = () => ({
    findById: vi.fn(),
  });

  const createProvider = (overrides: Partial<AuthProvider> = {}): AuthProvider => ({
    name: 'feishu',
    displayName: 'Feishu',
    initialize: vi.fn(),
    canHandle: vi.fn().mockReturnValue(true),
    renderLoginUI: vi.fn(),
    authenticate: vi.fn(),
    getUserInfo: vi.fn(),
    ...overrides,
  } as AuthProvider);

  let app: ReturnType<typeof fastifyStub>;
  let stateStore: ReturnType<typeof stateStoreMock>;
  let userRepository: ReturnType<typeof userRepositoryMock>;
  let coordinator: AuthCoordinator;
  let permissionSpy: ReturnType<typeof vi.spyOn>;

  const providersConfig: Record<string, AuthProviderConfig> = {
    feishu: {
      enabled: true,
      displayName: 'Feishu',
      config: {},
    },
  } as any;

  beforeEach(() => {
    app = fastifyStub();
    stateStore = stateStoreMock();
    userRepository = userRepositoryMock();
    coordinator = new AuthCoordinator({
      app: app as any,
      stateStore: stateStore as any,
      userRepository: userRepository as any,
      providersConfig,
    });
    permissionSpy = vi.spyOn(PermissionChecker.prototype, 'requirePermission');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createContext = (overrides: Partial<AuthContext> = {}): AuthContext => ({
    authMethod: overrides.authMethod ?? 'feishu',
    interactionUid: overrides.interactionUid ?? 'i-1',
    request: overrides.request ?? ({ headers: {}, ip: '127.0.0.1' } as any),
    reply: overrides.reply ?? ({} as any),
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
  });

  describe('registerProvider', () => {
    it('should register metadata, routes, assets and webhooks with permission checks', () => {
      const provider = createProvider({
        registerRoutes: vi.fn().mockReturnValue([
          {
            method: 'GET',
            path: '/callback',
            handler: vi.fn(),
            options: { description: 'callback' },
          },
        ]),
        registerStaticAssets: vi.fn().mockReturnValue([
          { path: '/icon.svg', content: '<svg />', contentType: 'image/svg+xml' },
        ]),
        registerWebhooks: vi.fn().mockReturnValue([
          { path: '/webhook', handler: vi.fn() },
        ]),
        registerMiddleware: vi.fn().mockResolvedValue(undefined),
        getMetadata: vi.fn().mockReturnValue({
          name: 'feishu',
          displayName: 'Feishu',
          permissions: [
            PluginPermission.REGISTER_ROUTES,
            PluginPermission.REGISTER_STATIC,
            PluginPermission.REGISTER_WEBHOOK,
            PluginPermission.REGISTER_MIDDLEWARE,
          ],
        }),
      });

      coordinator.registerProvider(provider);

      expect(app.route).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/auth/feishu/callback', method: 'GET' }),
      );
      expect(app.get).toHaveBeenCalledWith('/auth/feishu/icon.svg', expect.any(Function));
      expect(app.post).toHaveBeenCalledWith('/auth/feishu/webhook', expect.any(Function));
      expect(provider.registerMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({ basePath: '/auth/feishu', pluginName: 'feishu' }),
      );
      expect(permissionSpy).toHaveBeenCalledWith('feishu', PluginPermission.REGISTER_ROUTES);
      expect(coordinator.getProvider('feishu')).toBe(provider);
    });

    it('should throw when provider already registered', () => {
      const provider = createProvider();
      coordinator.registerProvider(provider);
      expect(() => coordinator.registerProvider(provider)).toThrow(/already registered/);
    });
  });

  describe('handleAuthentication', () => {
    let provider: AuthProvider;

    beforeEach(() => {
      provider = createProvider();
      coordinator.registerProvider(provider);
    });

    it('returns missingParameter when authMethod absent', async () => {
      const result = await coordinator.handleAuthentication(createContext({ authMethod: '' as any }));
      expect(result.error?.code).toBe('AUTH_1002');
    });

    it('returns providerNotFound when provider missing', async () => {
      const result = await coordinator.handleAuthentication(createContext({ authMethod: 'unknown' }));
      expect(result.error?.code).toBe('AUTH_4001');
    });

    it('returns providerDisabled when canHandle false', async () => {
      (provider.canHandle as any).mockReturnValue(false);
      const result = await coordinator.handleAuthentication(createContext());
      expect(result.error?.code).toBe('AUTH_4002');
    });

    it('calls authenticate when provider can handle', async () => {
      (provider.authenticate as any).mockResolvedValue({ success: true, userId: 'user-1' });
      const result = await coordinator.handleAuthentication(createContext());
      expect(provider.authenticate).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('wraps errors into internal error', async () => {
      (provider.authenticate as any).mockRejectedValue(new Error('boom'));
      const result = await coordinator.handleAuthentication(createContext());
      expect(result.error?.code).toBe('AUTH_5001');
    });
  });

  describe('OAuth state management', () => {

    it('generateOAuthState stores state with ttl 600', async () => {
      const state = await coordinator.generateOAuthState('interaction-1', 'feishu', { foo: 'bar' });
      expect(state).toHaveLength(64);
      expect(stateStore.set).toHaveBeenCalledWith(
        state,
        expect.objectContaining({ interactionUid: 'interaction-1', provider: 'feishu', metadata: { foo: 'bar' } }),
        600,
      );
    });

    it('verifyOAuthState returns data and deletes state', async () => {
      const data: OAuthStateData = { interactionUid: 'i-1', provider: 'feishu', createdAt: Date.now() };
      stateStore.get.mockResolvedValue(data);
      const result = await coordinator.verifyOAuthState('state-1');
      expect(result).toEqual(data);
      expect(stateStore.delete).toHaveBeenCalledWith('state-1');
    });

    it('verifyOAuthState returns null when expired', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:10:05Z'));
      const data: OAuthStateData = {
        interactionUid: 'i-1',
        provider: 'feishu',
        createdAt: new Date('2025-01-01T00:00:00Z').getTime(),
      };
      stateStore.get.mockResolvedValue(data);
      const result = await coordinator.verifyOAuthState('state-1');
      expect(result).toBeNull();
      expect(stateStore.delete).toHaveBeenCalledWith('state-1');
      vi.useRealTimers();
    });

    it('storeAuthResult and getAuthResult roundtrip', async () => {
      await coordinator.storeAuthResult('inter-1', 'user-1');
      expect(stateStore.set).toHaveBeenCalledWith(
        'auth_result_inter-1',
        expect.objectContaining({ userId: 'user-1', type: 'auth_result' }),
        300,
      );

      stateStore.get.mockResolvedValue({ userId: 'user-1', timestamp: Date.now(), type: 'auth_result' });
      const userId = await coordinator.getAuthResult('inter-1');
      expect(userId).toBe('user-1');
      expect(stateStore.delete).toHaveBeenCalledWith('auth_result_inter-1');
    });

    it('getAuthResult returns null when expired or invalid', async () => {
      stateStore.get.mockResolvedValue({ userId: 'user-1', timestamp: Date.now() - 400000, type: 'auth_result' });
      const expired = await coordinator.getAuthResult('inter-1');
      expect(expired).toBeNull();

      stateStore.get.mockResolvedValue({ foo: 'bar' });
      const invalid = await coordinator.getAuthResult('inter-2');
      expect(invalid).toBeNull();
    });
  });

  describe('initialize and destroy', () => {
    it('initializes enabled providers and skips disabled ones', async () => {
      const provider = createProvider();
      const disabledProvider = createProvider({ name: 'local' });
      coordinator.registerProvider(provider);
      coordinator.registerProvider(disabledProvider);
      (coordinator as any).providersConfig.local = { enabled: false, displayName: 'Local', config: {} };

      await coordinator.initialize();

      expect((provider.initialize as any)).toHaveBeenCalledWith(providersConfig.feishu);
      expect((disabledProvider.initialize as any)).not.toHaveBeenCalled();
    });

    it('throws when initializing twice', async () => {
      const provider = createProvider();
      coordinator.registerProvider(provider);
      await coordinator.initialize();
      await expect(coordinator.initialize()).rejects.toThrow(/already initialized/);
    });

    it('destroy calls provider destroy and clears map', async () => {
      const provider = createProvider({ destroy: vi.fn() });
      coordinator.registerProvider(provider);
      await coordinator.destroy();
      expect(provider.destroy).toHaveBeenCalled();
      expect(coordinator.getProviders()).toHaveLength(0);
    });
  });
});
