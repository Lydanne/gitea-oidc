import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthContext,
  AuthProvider,
  AuthProviderConfig,
  OAuthStateData,
} from "../../types/auth";
import { PluginPermission } from "../../types/auth";
import { AuthCoordinator } from "../AuthCoordinator";
import { PermissionChecker } from "../PermissionChecker";

describe("AuthCoordinator", () => {
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
    listAll: undefined as (() => any) | undefined,
  });

  const userRepositoryMock = () => ({
    findById: vi.fn(),
  });

  const createProvider = (overrides: Partial<AuthProvider> = {}): AuthProvider =>
    ({
      name: "feishu",
      displayName: "Feishu",
      initialize: vi.fn(),
      canHandle: vi.fn().mockReturnValue(true),
      renderLoginUI: vi.fn(),
      authenticate: vi.fn(),
      getUserInfo: vi.fn(),
      registerWebhooks: undefined,
      registerMiddleware: undefined,
      ...overrides,
    }) as AuthProvider;

  let app: ReturnType<typeof fastifyStub>;
  let stateStore: ReturnType<typeof stateStoreMock>;
  let userRepository: ReturnType<typeof userRepositoryMock>;
  let coordinator: AuthCoordinator;
  let permissionSpy: ReturnType<typeof vi.spyOn>;

  const providersConfig: Record<string, AuthProviderConfig> = {
    feishu: {
      enabled: true,
      displayName: "Feishu",
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
    permissionSpy = vi.spyOn(PermissionChecker.prototype, "requirePermission");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createContext = (overrides: Partial<AuthContext> = {}): AuthContext => ({
    authMethod: overrides.authMethod ?? "feishu",
    interactionUid: overrides.interactionUid ?? "i-1",
    request: overrides.request ?? ({ headers: {}, ip: "127.0.0.1" } as any),
    reply: overrides.reply ?? ({} as any),
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
  });

  describe("registerProvider", () => {
    it("should register metadata, routes, assets and webhooks with permission checks", () => {
      const provider = createProvider({
        registerRoutes: vi.fn().mockReturnValue([
          {
            method: "GET",
            path: "/callback",
            handler: vi.fn(),
            options: { description: "callback" },
          },
        ]),
        registerStaticAssets: vi
          .fn()
          .mockReturnValue([
            { path: "/icon.svg", content: "<svg />", contentType: "image/svg+xml" },
          ]),
        registerWebhooks: vi.fn().mockReturnValue([{ path: "/webhook", handler: vi.fn() }]),
        registerMiddleware: vi.fn().mockResolvedValue(undefined),
        getMetadata: vi.fn().mockReturnValue({
          name: "feishu",
          displayName: "Feishu",
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
        expect.objectContaining({ url: "/auth/feishu/callback", method: "GET" }),
      );
      expect(app.get).toHaveBeenCalledWith("/auth/feishu/icon.svg", expect.any(Function));
      expect(app.post).toHaveBeenCalledWith("/auth/feishu/webhook", expect.any(Function));
      expect(provider.registerMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({ basePath: "/auth/feishu", pluginName: "feishu" }),
      );
      expect(permissionSpy).toHaveBeenCalledWith("feishu", PluginPermission.REGISTER_ROUTES);
      expect(coordinator.getProvider("feishu")).toBe(provider);
    });

    it("should throw when provider already registered", () => {
      const provider = createProvider();
      coordinator.registerProvider(provider);
      expect(() => coordinator.registerProvider(provider)).toThrow(/already registered/);
    });

    it("webhook handler验证签名失败返回401，成功时调用原处理", async () => {
      const handler = vi.fn().mockResolvedValue({ ok: true });
      const verifySignature = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const provider = createProvider({
        registerWebhooks: vi.fn().mockReturnValue([{ path: "/webhook", handler, verifySignature }]),
        getMetadata: vi.fn().mockReturnValue({
          name: "feishu",
          displayName: "Feishu",
          permissions: [PluginPermission.REGISTER_WEBHOOK],
        }),
      });

      coordinator.registerProvider(provider);
      const webhookHandler = app.post.mock.calls.find(
        (call) => call[0] === "/auth/feishu/webhook",
      )?.[1];
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() } as any;

      await webhookHandler?.({} as any, reply);
      expect(verifySignature).toHaveBeenCalled();
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid signature" });

      await webhookHandler?.({} as any, reply);
      expect(handler).toHaveBeenCalled();
    });

    it("middleware 钩子仅在匹配路径时触发", async () => {
      const hookHandler = vi.fn();
      const provider = createProvider({
        registerMiddleware: vi.fn().mockImplementation(async (context) => {
          context.addHook("onRequest", hookHandler);
        }),
        getMetadata: vi.fn().mockReturnValue({
          name: "feishu",
          displayName: "Feishu",
          permissions: [PluginPermission.REGISTER_MIDDLEWARE],
        }),
      });

      coordinator.registerProvider(provider);
      const registeredHook = app.addHook.mock.calls.find((call) => call[0] === "onRequest")?.[1];

      await registeredHook?.({ url: "/auth/feishu/callback" } as any, {} as any);
      await registeredHook?.({ url: "/auth/other" } as any, {} as any);

      expect(hookHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleAuthentication", () => {
    let provider: AuthProvider;

    beforeEach(() => {
      provider = createProvider();
      coordinator.registerProvider(provider);
    });

    it("returns missingParameter when authMethod absent", async () => {
      const result = await coordinator.handleAuthentication(
        createContext({ authMethod: "" as any }),
      );
      expect(result.error?.code).toBe("AUTH_1002");
    });

    it("returns providerNotFound when provider missing", async () => {
      const result = await coordinator.handleAuthentication(
        createContext({ authMethod: "unknown" }),
      );
      expect(result.error?.code).toBe("AUTH_4001");
    });

    it("returns providerDisabled when canHandle false", async () => {
      (provider.canHandle as any).mockReturnValue(false);
      const result = await coordinator.handleAuthentication(createContext());
      expect(result.error?.code).toBe("AUTH_4002");
    });

    it("calls authenticate when provider can handle", async () => {
      (provider.authenticate as any).mockResolvedValue({ success: true, userId: "user-1" });
      const result = await coordinator.handleAuthentication(createContext());
      expect(provider.authenticate).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("wraps errors into internal error", async () => {
      (provider.authenticate as any).mockRejectedValue(new Error("boom"));
      const result = await coordinator.handleAuthentication(createContext());
      expect(result.error?.code).toBe("AUTH_5001");
    });
  });

  describe("OAuth state management", () => {
    it("generateOAuthState stores state with ttl 600", async () => {
      const state = await coordinator.generateOAuthState("interaction-1", "feishu", { foo: "bar" });
      expect(state).toHaveLength(64);
      expect(stateStore.set).toHaveBeenCalledWith(
        state,
        expect.objectContaining({
          interactionUid: "interaction-1",
          provider: "feishu",
          metadata: { foo: "bar" },
        }),
        600,
      );
    });

    it("verifyOAuthState returns data and deletes state", async () => {
      const data: OAuthStateData = {
        interactionUid: "i-1",
        provider: "feishu",
        createdAt: Date.now(),
      };
      stateStore.get.mockResolvedValue(data);
      const result = await coordinator.verifyOAuthState("state-1");
      expect(result).toEqual(data);
      expect(stateStore.delete).toHaveBeenCalledWith("state-1");
    });

    it("verifyOAuthState returns null when expired", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:10:05Z"));
      const data: OAuthStateData = {
        interactionUid: "i-1",
        provider: "feishu",
        createdAt: new Date("2025-01-01T00:00:00Z").getTime(),
      };
      stateStore.get.mockResolvedValue(data);
      const result = await coordinator.verifyOAuthState("state-1");
      expect(result).toBeNull();
      expect(stateStore.delete).toHaveBeenCalledWith("state-1");
      vi.useRealTimers();
    });

    it("verifyOAuthState logs listAll when available", async () => {
      const listAll = vi.fn().mockReturnValue({ foo: "bar" });
      stateStore.listAll = listAll;
      const data: OAuthStateData = {
        interactionUid: "i-2",
        provider: "feishu",
        createdAt: Date.now(),
      };
      stateStore.get.mockResolvedValue(data);

      const result = await coordinator.verifyOAuthState("state-2");

      expect(result).toEqual(data);
      expect(listAll).toHaveBeenCalled();
      expect(app.log.info).toHaveBeenCalledWith(expect.stringContaining("Current stored states"));
    });

    it("verifyOAuthState warns when state missing", async () => {
      stateStore.get.mockResolvedValue(null);

      const result = await coordinator.verifyOAuthState("state-missing");

      expect(result).toBeNull();
      expect(app.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Invalid or expired state"),
      );
    });

    it("verifyOAuthState handles store errors", async () => {
      stateStore.get.mockRejectedValue(new Error("boom"));

      const result = await coordinator.verifyOAuthState("state-error");

      expect(result).toBeNull();
      expect(app.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Failed to verify OAuth state",
      );
    });

    it("storeAuthResult and getAuthResult roundtrip", async () => {
      await coordinator.storeAuthResult("inter-1", "user-1");
      expect(stateStore.set).toHaveBeenCalledWith(
        "auth_result_inter-1",
        expect.objectContaining({ userId: "user-1", type: "auth_result" }),
        300,
      );

      stateStore.get.mockResolvedValue({
        userId: "user-1",
        timestamp: Date.now(),
        type: "auth_result",
      });
      const userId = await coordinator.getAuthResult("inter-1");
      expect(userId).toBe("user-1");
      expect(stateStore.delete).toHaveBeenCalledWith("auth_result_inter-1");
    });

    it("getAuthResult returns null when expired or invalid", async () => {
      stateStore.get.mockResolvedValue({
        userId: "user-1",
        timestamp: Date.now() - 400000,
        type: "auth_result",
      });
      const expired = await coordinator.getAuthResult("inter-1");
      expect(expired).toBeNull();

      stateStore.get.mockResolvedValue({ foo: "bar" });
      const invalid = await coordinator.getAuthResult("inter-2");
      expect(invalid).toBeNull();
    });
  });

  describe("initialize and destroy", () => {
    it("initializes enabled providers and skips disabled ones", async () => {
      const provider = createProvider();
      const disabledProvider = createProvider({ name: "local" });
      coordinator.registerProvider(provider);
      coordinator.registerProvider(disabledProvider);
      (coordinator as any).providersConfig.local = {
        enabled: false,
        displayName: "Local",
        config: {},
      };

      await coordinator.initialize();

      expect(provider.initialize as any).toHaveBeenCalledWith(providersConfig.feishu);
      expect(disabledProvider.initialize as any).not.toHaveBeenCalled();
    });

    it("throws when initializing twice", async () => {
      const provider = createProvider();
      coordinator.registerProvider(provider);
      await coordinator.initialize();
      await expect(coordinator.initialize()).rejects.toThrow(/already initialized/);
    });

    it("destroy calls provider destroy and clears map", async () => {
      const provider = createProvider({ destroy: vi.fn() });
      coordinator.registerProvider(provider);
      await coordinator.destroy();
      expect(provider.destroy).toHaveBeenCalled();
      expect(coordinator.getProviders()).toHaveLength(0);
    });

    it("propagates initialization errors并记录日志", async () => {
      const provider = createProvider({
        initialize: vi.fn().mockRejectedValue(new Error("init failed")),
      });
      coordinator.registerProvider(provider);

      await expect(coordinator.initialize()).rejects.toThrow("init failed");
      expect(app.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), provider: "feishu" }),
        "Failed to initialize provider",
      );
    });

    it("destroy ignores provider destroy errors但记录日志", async () => {
      const provider = createProvider({ destroy: vi.fn().mockRejectedValue(new Error("boom")) });
      coordinator.registerProvider(provider);

      await coordinator.destroy();

      expect(app.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), provider: "feishu" }),
        "Failed to destroy provider",
      );
      expect(coordinator.getProviders()).toHaveLength(0);
    });
  });

  describe("finishOidcInteraction", () => {
    it("completes interaction via oidcProvider", async () => {
      const oidcProvider = { interactionFinished: vi.fn().mockResolvedValue(undefined) } as any;
      coordinator = new AuthCoordinator({
        app: app as any,
        stateStore: stateStore as any,
        userRepository: userRepository as any,
        providersConfig,
        oidcProvider,
      });

      const request = { raw: {} } as any;
      const reply = { raw: {} } as any;
      await coordinator.finishOidcInteraction(request, reply, "uid-1", "user-1");

      expect(oidcProvider.interactionFinished).toHaveBeenCalledWith(
        request.raw,
        reply.raw,
        expect.objectContaining({ login: { accountId: "user-1" } }),
        { mergeWithLastSubmission: false },
      );
    });

    it("logs并抛出 finishOidcInteraction 错误", async () => {
      const oidcProvider = {
        interactionFinished: vi.fn().mockRejectedValue(new Error("finish failed")),
      } as any;
      coordinator = new AuthCoordinator({
        app: app as any,
        stateStore: stateStore as any,
        userRepository: userRepository as any,
        providersConfig,
        oidcProvider,
      });

      await expect(
        coordinator.finishOidcInteraction(
          { raw: {} } as any,
          { raw: {} } as any,
          "uid-err",
          "user-err",
        ),
      ).rejects.toThrow("finish failed");
      expect(app.log.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          userId: "user-err",
          interactionUid: "uid-err",
        }),
        "Failed to finish OIDC interaction",
      );
    });

    it("throws when oidcProvider 未初始化", async () => {
      await expect(
        coordinator.finishOidcInteraction({ raw: {} } as any, { raw: {} } as any, "uid", "user"),
      ).rejects.toThrow("OIDC Provider not initialized");
    });
  });

  describe("renderUnifiedLoginPage", () => {
    it("收集登录 UI 并按优先级渲染 HTML", async () => {
      const htmlProvider = createProvider({
        name: "local",
        renderLoginUI: vi
          .fn()
          .mockResolvedValue({ type: "html", html: '<form id="local"></form>' }),
      });
      const redirectProvider = createProvider({
        name: "feishu",
        renderLoginUI: vi.fn().mockResolvedValue({
          type: "redirect",
          redirectUrl: "https://feishu.com",
          button: { text: "Feishu", icon: "/icon.svg", style: "color:red;" },
        }),
      });
      (coordinator as any).providersConfig = {
        local: { enabled: true, displayName: "Local", priority: 2, config: {} },
        feishu: { enabled: true, displayName: "Feishu", priority: 1, config: {} },
      };

      coordinator.registerProvider(redirectProvider);
      coordinator.registerProvider(htmlProvider);

      const html = await coordinator.renderUnifiedLoginPage(createContext());

      expect(html).toContain('<form id="local"></form>');
      expect(html).toContain("https://feishu.com");
    });
  });

  describe("findAccount", () => {
    it("returns user from repository", async () => {
      userRepository.findById.mockResolvedValue({ sub: "user-1" } as any);
      const result = await coordinator.findAccount("user-1");
      expect(result).toEqual({ sub: "user-1" });
    });

    it("returns null and logs on repository error", async () => {
      userRepository.findById.mockRejectedValue(new Error("db error"));
      const result = await coordinator.findAccount("user-2");
      expect(result).toBeNull();
      expect(app.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), userId: "user-2" }),
        "Failed to find account",
      );
    });
  });
});
