/**
 * 认证错误工厂函数
 *
 * 提供统一的错误创建和处理机制
 */

import { type AuthError, AuthErrorCode } from "../types/auth";

/**
 * 创建认证错误
 */
export function createAuthError(
  code: AuthErrorCode,
  message: string,
  options?: {
    userMessage?: string;
    details?: Record<string, any>;
    cause?: Error;
    retryable?: boolean;
    suggestedAction?: string;
  },
): AuthError {
  return {
    code,
    message,
    userMessage: options?.userMessage || getDefaultUserMessage(code),
    details: options?.details,
    cause: options?.cause,
    retryable: options?.retryable ?? false,
    suggestedAction: options?.suggestedAction,
  };
}

/**
 * 获取默认的用户友好消息
 */
function getDefaultUserMessage(code: AuthErrorCode): string {
  const messages: Record<AuthErrorCode, string> = {
    [AuthErrorCode.UNKNOWN_ERROR]: "未知错误",
    [AuthErrorCode.INVALID_REQUEST]: "无效的请求",
    [AuthErrorCode.MISSING_PARAMETER]: "缺少必要参数",

    [AuthErrorCode.INVALID_CREDENTIALS]: "用户名或密码错误",
    [AuthErrorCode.USER_NOT_FOUND]: "用户不存在",
    [AuthErrorCode.PASSWORD_INCORRECT]: "密码错误",
    [AuthErrorCode.ACCOUNT_LOCKED]: "账户已被锁定，请联系管理员",
    [AuthErrorCode.ACCOUNT_DISABLED]: "账户已被禁用",

    [AuthErrorCode.INVALID_STATE]: "无效的认证状态",
    [AuthErrorCode.STATE_EXPIRED]: "认证已过期，请重新登录",
    [AuthErrorCode.OAUTH_CALLBACK_FAILED]: "OAuth 认证失败",
    [AuthErrorCode.TOKEN_EXCHANGE_FAILED]: "令牌交换失败",
    [AuthErrorCode.USERINFO_FETCH_FAILED]: "获取用户信息失败",

    [AuthErrorCode.PROVIDER_NOT_FOUND]: "认证方式不存在",
    [AuthErrorCode.PROVIDER_DISABLED]: "该认证方式已被禁用",
    [AuthErrorCode.INVALID_CONFIGURATION]: "配置错误",

    [AuthErrorCode.INTERNAL_ERROR]: "系统错误，请稍后重试",
    [AuthErrorCode.DATABASE_ERROR]: "数据库错误",
    [AuthErrorCode.NETWORK_ERROR]: "网络错误",
  };

  return messages[code] || "认证失败";
}

/**
 * 常用错误创建函数
 */
export const AuthErrors = {
  /**
   * 无效凭据
   */
  invalidCredentials: (details?: Record<string, any>) =>
    createAuthError(AuthErrorCode.INVALID_CREDENTIALS, "Invalid credentials", {
      details,
      retryable: true,
      suggestedAction: "请检查用户名和密码是否正确",
    }),

  /**
   * 用户不存在
   */
  userNotFound: (username: string) =>
    createAuthError(AuthErrorCode.USER_NOT_FOUND, `User not found: ${username}`, {
      details: { username },
      suggestedAction: "请检查用户名是否正确",
    }),

  /**
   * 密码错误
   */
  passwordIncorrect: (username: string) =>
    createAuthError(AuthErrorCode.PASSWORD_INCORRECT, `Password incorrect for user: ${username}`, {
      details: { username },
      retryable: true,
      suggestedAction: "请检查密码是否正确",
    }),

  /**
   * 缺少参数
   */
  missingParameter: (parameterNames: string[]) =>
    createAuthError(
      AuthErrorCode.MISSING_PARAMETER,
      `Missing required parameters: ${parameterNames.join(", ")}`,
      {
        details: { missingParameters: parameterNames },
        userMessage: `请输入${parameterNames.join("和")}`,
      },
    ),

  /**
   * 无效的 OAuth state
   */
  invalidState: (state?: string) =>
    createAuthError(AuthErrorCode.INVALID_STATE, "Invalid OAuth state", {
      details: state ? { state: `${state.substring(0, 8)}...` } : undefined,
      suggestedAction: "请重新开始登录流程",
    }),

  /**
   * State 已过期
   */
  stateExpired: () =>
    createAuthError(AuthErrorCode.STATE_EXPIRED, "OAuth state expired", {
      retryable: true,
      suggestedAction: "请重新登录",
    }),

  /**
   * OAuth 回调失败
   */
  oauthCallbackFailed: (reason: string, details?: Record<string, any>) =>
    createAuthError(AuthErrorCode.OAUTH_CALLBACK_FAILED, `OAuth callback failed: ${reason}`, {
      details,
      retryable: true,
      suggestedAction: "请重新尝试登录",
    }),

  /**
   * 令牌交换失败
   */
  tokenExchangeFailed: (cause?: Error) =>
    createAuthError(
      AuthErrorCode.TOKEN_EXCHANGE_FAILED,
      "Failed to exchange authorization code for token",
      {
        cause,
        retryable: true,
        suggestedAction: "请重新尝试登录",
      },
    ),

  /**
   * 获取用户信息失败
   */
  userinfoFetchFailed: (cause?: Error) =>
    createAuthError(AuthErrorCode.USERINFO_FETCH_FAILED, "Failed to fetch user information", {
      cause,
      retryable: true,
      suggestedAction: "请重新尝试登录",
    }),

  /**
   * 认证提供者不存在
   */
  providerNotFound: (provider: string) =>
    createAuthError(
      AuthErrorCode.PROVIDER_NOT_FOUND,
      `Authentication provider not found: ${provider}`,
      {
        details: { provider },
        userMessage: `认证方式"${provider}"不存在`,
      },
    ),

  /**
   * 认证提供者已禁用
   */
  providerDisabled: (provider: string) =>
    createAuthError(
      AuthErrorCode.PROVIDER_DISABLED,
      `Authentication provider is disabled: ${provider}`,
      {
        details: { provider },
        userMessage: `认证方式"${provider}"已被禁用`,
      },
    ),

  /**
   * 内部错误
   */
  internalError: (cause?: Error, details?: Record<string, any>) =>
    createAuthError(AuthErrorCode.INTERNAL_ERROR, "Internal error", {
      cause,
      details,
      retryable: true,
      suggestedAction: "请稍后重试，如果问题持续请联系管理员",
    }),

  /**
   * 网络错误
   */
  networkError: (cause?: Error) =>
    createAuthError(AuthErrorCode.NETWORK_ERROR, "Network error", {
      cause,
      retryable: true,
      suggestedAction: "请检查网络连接后重试",
    }),
};

/**
 * 格式化错误消息（用于日志）
 */
export function formatAuthError(error: AuthError): string {
  const parts = [`[${error.code}] ${error.message}`];

  if (error.details) {
    parts.push(`Details: ${JSON.stringify(error.details)}`);
  }

  if (error.cause) {
    parts.push(`Cause: ${error.cause.message}`);
  }

  return parts.join(" | ");
}

/**
 * 获取用户可见的错误消息
 */
export function getUserErrorMessage(error: AuthError): string {
  return error.userMessage || getDefaultUserMessage(error.code);
}
