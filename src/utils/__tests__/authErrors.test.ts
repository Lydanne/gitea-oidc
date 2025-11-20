import { describe, expect, it } from "vitest";
import { AuthErrorCode } from "../../types/auth";
import { AuthErrors, createAuthError, formatAuthError, getUserErrorMessage } from "../authErrors";

describe("createAuthError", () => {
  it("should apply default user message and retryable=false when not provided", () => {
    const error = createAuthError(AuthErrorCode.INVALID_REQUEST, "Missing fields");

    expect(error.code).toBe(AuthErrorCode.INVALID_REQUEST);
    expect(error.message).toBe("Missing fields");
    expect(error.userMessage).toBe("无效的请求");
    expect(error.retryable).toBe(false);
    expect(error.details).toBeUndefined();
    expect(error.cause).toBeUndefined();
    expect(error.suggestedAction).toBeUndefined();
  });

  it("should honor provided options", () => {
    const cause = new Error("boom");
    const error = createAuthError(AuthErrorCode.NETWORK_ERROR, "Network unreachable", {
      userMessage: "无法连接",
      details: { host: "example.com" },
      cause,
      retryable: true,
      suggestedAction: "检查网络",
    });

    expect(error.userMessage).toBe("无法连接");
    expect(error.details).toEqual({ host: "example.com" });
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
    expect(error.suggestedAction).toBe("检查网络");
  });
});

describe("AuthErrors factory helpers", () => {
  const errorCases = [
    {
      name: "invalidCredentials",
      code: AuthErrorCode.INVALID_CREDENTIALS,
      build: () => AuthErrors.invalidCredentials({ username: "foo" }),
      extra: (error: ReturnType<typeof AuthErrors.invalidCredentials>) => {
        expect(error.details).toEqual({ username: "foo" });
        expect(error.retryable).toBe(true);
        expect(error.suggestedAction).toMatch(/用户名和密码/);
      },
    },
    {
      name: "userNotFound",
      code: AuthErrorCode.USER_NOT_FOUND,
      build: () => AuthErrors.userNotFound("foo"),
      extra: (error: ReturnType<typeof AuthErrors.userNotFound>) => {
        expect(error.details).toEqual({ username: "foo" });
        expect(error.userMessage).toBe("用户不存在");
      },
    },
    {
      name: "passwordIncorrect",
      code: AuthErrorCode.PASSWORD_INCORRECT,
      build: () => AuthErrors.passwordIncorrect("foo"),
      extra: (error: ReturnType<typeof AuthErrors.passwordIncorrect>) => {
        expect(error.details).toEqual({ username: "foo" });
        expect(error.retryable).toBe(true);
      },
    },
    {
      name: "missingParameter",
      code: AuthErrorCode.MISSING_PARAMETER,
      build: () => AuthErrors.missingParameter(["username", "password"]),
      extra: (error: ReturnType<typeof AuthErrors.missingParameter>) => {
        expect(error.details).toEqual({ missingParameters: ["username", "password"] });
        expect(error.userMessage).toContain("username和password");
      },
    },
    {
      name: "invalidState",
      code: AuthErrorCode.INVALID_STATE,
      build: () => AuthErrors.invalidState("abcdef123456"),
      extra: (error: ReturnType<typeof AuthErrors.invalidState>) => {
        expect(error.details).toEqual({ state: "abcdef12..." });
        expect(error.suggestedAction).toMatch(/重新开始/);
      },
    },
    {
      name: "stateExpired",
      code: AuthErrorCode.STATE_EXPIRED,
      build: () => AuthErrors.stateExpired(),
      extra: (error: ReturnType<typeof AuthErrors.stateExpired>) => {
        expect(error.retryable).toBe(true);
      },
    },
    {
      name: "oauthCallbackFailed",
      code: AuthErrorCode.OAUTH_CALLBACK_FAILED,
      build: () => AuthErrors.oauthCallbackFailed("timeout", { provider: "feishu" }),
      extra: (error: ReturnType<typeof AuthErrors.oauthCallbackFailed>) => {
        expect(error.details).toEqual({ provider: "feishu" });
        expect(error.retryable).toBe(true);
      },
    },
    {
      name: "tokenExchangeFailed",
      code: AuthErrorCode.TOKEN_EXCHANGE_FAILED,
      build: () => AuthErrors.tokenExchangeFailed(new Error("bad code")),
      extra: (error: ReturnType<typeof AuthErrors.tokenExchangeFailed>) => {
        expect(error.cause?.message).toBe("bad code");
      },
    },
    {
      name: "userinfoFetchFailed",
      code: AuthErrorCode.USERINFO_FETCH_FAILED,
      build: () => AuthErrors.userinfoFetchFailed(new Error("downstream")),
      extra: (error: ReturnType<typeof AuthErrors.userinfoFetchFailed>) => {
        expect(error.cause?.message).toBe("downstream");
      },
    },
    {
      name: "providerNotFound",
      code: AuthErrorCode.PROVIDER_NOT_FOUND,
      build: () => AuthErrors.providerNotFound("unknown"),
      extra: (error: ReturnType<typeof AuthErrors.providerNotFound>) => {
        expect(error.details).toEqual({ provider: "unknown" });
        expect(error.userMessage).toContain("unknown");
      },
    },
    {
      name: "providerDisabled",
      code: AuthErrorCode.PROVIDER_DISABLED,
      build: () => AuthErrors.providerDisabled("local"),
      extra: (error: ReturnType<typeof AuthErrors.providerDisabled>) => {
        expect(error.details).toEqual({ provider: "local" });
      },
    },
    {
      name: "internalError",
      code: AuthErrorCode.INTERNAL_ERROR,
      build: () => AuthErrors.internalError(new Error("boom"), { traceId: "123" }),
      extra: (error: ReturnType<typeof AuthErrors.internalError>) => {
        expect(error.cause?.message).toBe("boom");
        expect(error.details).toEqual({ traceId: "123" });
        expect(error.retryable).toBe(true);
      },
    },
    {
      name: "networkError",
      code: AuthErrorCode.NETWORK_ERROR,
      build: () => AuthErrors.networkError(new Error("offline")),
      extra: (error: ReturnType<typeof AuthErrors.networkError>) => {
        expect(error.cause?.message).toBe("offline");
        expect(error.retryable).toBe(true);
      },
    },
  ] as const;

  errorCases.forEach(({ name, code, build, extra }) => {
    it(`${name} should create error with code ${code}`, () => {
      const error = build();
      expect(error.code).toBe(code);
      expect(error.message).toBeTruthy();
      extra(error as any);
    });
  });
});

describe("formatAuthError", () => {
  it("should include base message and optional sections", () => {
    const error = createAuthError(AuthErrorCode.UNKNOWN_ERROR, "Something broke", {
      details: { foo: "bar" },
      cause: new Error("root cause"),
    });

    const formatted = formatAuthError(error);

    expect(formatted).toContain("[AUTH_1000] Something broke");
    expect(formatted).toContain('Details: {"foo":"bar"}');
    expect(formatted).toContain("Cause: root cause");
  });

  it("should only include message when no extras provided", () => {
    const error = createAuthError(AuthErrorCode.UNKNOWN_ERROR, "Plain error");

    expect(formatAuthError(error)).toBe("[AUTH_1000] Plain error");
  });
});

describe("getUserErrorMessage", () => {
  it("should favor explicit userMessage", () => {
    const error = createAuthError(AuthErrorCode.ACCOUNT_DISABLED, "Disabled", {
      userMessage: "账号被禁用",
    });

    expect(getUserErrorMessage(error)).toBe("账号被禁用");
  });

  it("should fall back to default message when userMessage missing", () => {
    const error = createAuthError(AuthErrorCode.ACCOUNT_DISABLED, "Disabled");

    expect(getUserErrorMessage(error)).toBe("账户已被禁用");
  });
});
