import { createHash } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext, AuthProviderConfig, UserInfo } from "../../types/auth";
import { AuthErrors } from "../../utils/authErrors";
import { Logger } from "../../utils/Logger";
import { LocalAuthProvider } from "../LocalAuthProvider";

const mocks = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  bcryptCompareMock: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: mocks.readFileMock,
}));

vi.mock("bcrypt", () => ({
  compare: mocks.bcryptCompareMock,
}));

describe("LocalAuthProvider", () => {
  let provider: LocalAuthProvider;
  const userRepository = {
    findOrCreate: vi.fn<(provider: string, externalId: string, data: any) => Promise<UserInfo>>(),
    findById: vi.fn<(id: string) => Promise<UserInfo | null>>(),
  } as unknown as any;

  const baseConfig: AuthProviderConfig = {
    enabled: true,
    displayName: "Local",
    config: {
      passwordFile: "/tmp/.htpasswd",
      passwordFormat: "auto",
    },
  };

  const fakeRequest = {} as FastifyRequest;
  const fakeReply = {} as FastifyReply;

  const createContext = (overrides: Partial<AuthContext> = {}): AuthContext => ({
    authMethod: overrides.authMethod ?? "local",
    interactionUid: overrides.interactionUid ?? "interaction-123",
    request: overrides.request ?? fakeRequest,
    reply: overrides.reply ?? fakeReply,
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: {
      authMethod: "local",
      username: "alice",
      password: "secret",
      ...overrides.body,
    },
    interaction: overrides.interaction,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LocalAuthProvider(userRepository);
    const shaHash = createHash("sha1").update("secret").digest("base64");
    const md5Hash = (provider as any).apr1Crypt("secret", "salt");
    mocks.readFileMock.mockResolvedValue(
      [
        "alice:$2b$10$hash123",
        "bob:plain",
        `md5user:$apr1$salt$${md5Hash}`,
        `shauser:{SHA}${shaHash}`,
        "plainuser:secret",
        "unknown:??",
        "#comment",
      ].join("\n"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialize 应该读取密码文件", async () => {
    await provider.initialize(baseConfig);

    expect(mocks.readFileMock).toHaveBeenCalledWith("/tmp/.htpasswd", "utf-8");
    expect((provider as any).passwordMap.get("alice")).toBe("$2b$10$hash123");
    expect((provider as any).passwordMap.get("bob")).toBe("plain");
  });

  it("initialize 在读取失败时应抛出错误", async () => {
    mocks.readFileMock.mockRejectedValueOnce(new Error("fs error"));

    await expect(provider.initialize(baseConfig)).rejects.toThrow(
      "Failed to load password file: /tmp/.htpasswd",
    );
  });

  it("canHandle 应根据 context 判断", async () => {
    await provider.initialize(baseConfig);
    expect(provider.canHandle(createContext())).toBe(true);
    expect(
      provider.canHandle(
        createContext({
          authMethod: "other",
          body: { authMethod: "other", username: "x", password: "y" },
        }),
      ),
    ).toBe(false);
  });

  it("renderLoginUI 应返回带隐藏字段的表单", async () => {
    await provider.initialize(baseConfig);
    const ui = await provider.renderLoginUI(createContext({ query: { error: "Oops" } as any }));

    expect(ui.type).toBe("html");
    expect(ui.html).toContain('name="authMethod" value="local"');
    expect(ui.html).toContain("Oops");
  });

  describe("authenticate", () => {
    beforeEach(async () => {
      await provider.initialize(baseConfig);
    });

    it("缺少用户名或密码时返回缺参错误", async () => {
      const result = await provider.authenticate(
        createContext({
          body: { authMethod: "local", username: "", password: "" },
        }),
      );

      const expected = AuthErrors.missingParameter(["username", "password"]);
      expect(result).toEqual({ success: false, error: expected });
    });

    it("未知格式密码验证失败时返回 passwordIncorrect", async () => {
      const result = await provider.authenticate(
        createContext({
          body: { authMethod: "local", username: "unknown", password: "secret" },
        }),
      );

      expect(result.error).toEqual(AuthErrors.passwordIncorrect("unknown"));
      expect(result.success).toBe(false);
    });

    it("密码不正确时返回 passwordIncorrect", async () => {
      const context = createContext();
      mocks.bcryptCompareMock.mockResolvedValue(false);

      const result = await provider.authenticate(context);

      expect(result.error).toEqual(AuthErrors.passwordIncorrect("alice"));
      expect(result.success).toBe(false);
    });

    it("验证成功时调用 findOrCreate 并返回成功", async () => {
      const user = {
        sub: "user-1",
        username: "alice",
        name: "alice",
        email: "alice@local",
        authProvider: "local",
        externalId: "alice",
      } as UserInfo;
      mocks.bcryptCompareMock.mockResolvedValue(true);
      userRepository.findOrCreate.mockResolvedValue(user);

      const result = await provider.authenticate(createContext());

      expect(result.success).toBe(true);
      expect(result.userId).toBe("user-1");
      expect(userRepository.findOrCreate).toHaveBeenCalledWith("local", "alice", {
        username: "alice",
        name: "alice",
        email: "alice@local",
        emailVerified: false,
      });
    });

    it("支持 md5 密码格式", async () => {
      const md5User = {
        sub: "user-md5",
        username: "md5user",
      } as UserInfo;
      userRepository.findOrCreate.mockResolvedValueOnce(md5User);

      const result = await provider.authenticate(
        createContext({ body: { authMethod: "local", username: "md5user", password: "secret" } }),
      );

      expect(result.success).toBe(true);
      expect(userRepository.findOrCreate).toHaveBeenCalledWith(
        "local",
        "md5user",
        expect.any(Object),
      );
    });

    it("支持 sha 密码格式", async () => {
      const shaUser = {
        sub: "user-sha",
        username: "shauser",
      } as UserInfo;
      userRepository.findOrCreate.mockResolvedValueOnce(shaUser);

      const result = await provider.authenticate(
        createContext({ body: { authMethod: "local", username: "shauser", password: "secret" } }),
      );

      expect(result.success).toBe(true);
      expect(userRepository.findOrCreate).toHaveBeenCalledWith(
        "local",
        "shauser",
        expect.any(Object),
      );
    });

    it("支持 plain 密码格式", async () => {
      const plainUser = {
        sub: "user-plain",
        username: "plainuser",
      } as UserInfo;
      userRepository.findOrCreate.mockResolvedValueOnce(plainUser);

      const result = await provider.authenticate(
        createContext({ body: { authMethod: "local", username: "plainuser", password: "secret" } }),
      );

      expect(result.success).toBe(true);
      expect(userRepository.findOrCreate).toHaveBeenCalledWith(
        "local",
        "plainuser",
        expect.any(Object),
      );
    });
  });

  describe("detectPasswordFormat", () => {
    beforeEach(async () => {
      await provider.initialize(baseConfig);
    });

    it("根据前缀返回对应格式", () => {
      const detect = (provider as any).detectPasswordFormat.bind(provider);
      expect(detect("$2b$hash")).toBe("bcrypt");
      expect(detect("$apr1$salt$hash")).toBe("md5");
      expect(detect("{SHA}abc")).toBe("sha");
      (provider as any).config.passwordFormat = "md5";
      expect(detect("custom")).toBe("md5");
      delete (provider as any).config.passwordFormat;
      expect(detect("plain")).toBe("plain");
    });
  });

  describe("verify helpers", () => {
    beforeEach(async () => {
      await provider.initialize(baseConfig);
    });

    it("在强制配置格式时调用对应的验证方法", async () => {
      (provider as any).config.passwordFormat = "md5";
      const verifyMd5Spy = vi.spyOn(provider as any, "verifyMD5").mockReturnValue(true);

      const result = await (provider as any).verifyPassword("secret", "custom-hash");

      expect(result).toBe(true);
      expect(verifyMd5Spy).toHaveBeenCalledWith("secret", "custom-hash");
    });

    it("未知格式应记录错误并返回 false", async () => {
      const loggerSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
      vi.spyOn(provider as any, "detectPasswordFormat").mockReturnValue("unknown");

      const result = await (provider as any).verifyPassword("secret", "mystery");

      expect(result).toBe(false);
      expect(loggerSpy).toHaveBeenCalledWith("[LocalAuth] Unknown password format:", "mystery");
    });

    it("verifyBcrypt 异常时返回 false 并记录错误", async () => {
      const loggerSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
      mocks.bcryptCompareMock.mockRejectedValueOnce(new Error("boom"));

      const result = await (provider as any).verifyBcrypt("secret", "$2b$hash");

      expect(result).toBe(false);
      expect(loggerSpy).toHaveBeenCalledWith(
        "[LocalAuth] Bcrypt verification error:",
        expect.any(Error),
      );
    });
  });

  describe("辅助方法", () => {
    beforeEach(async () => {
      await provider.initialize(baseConfig);
    });

    it("getUserInfo 应调用仓库查找用户", async () => {
      const user = { sub: "user-1" } as UserInfo;
      userRepository.findById.mockResolvedValueOnce(user);

      const result = await provider.getUserInfo("user-1");

      expect(userRepository.findById).toHaveBeenCalledWith("user-1");
      expect(result).toBe(user);
    });

    it("destroy 应清空密码缓存", async () => {
      expect((provider as any).passwordMap.size).toBeGreaterThan(0);

      await provider.destroy();

      expect((provider as any).passwordMap.size).toBe(0);
    });
  });
});
