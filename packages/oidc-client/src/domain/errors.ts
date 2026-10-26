export type NodeOidcErrorCode =
  | "INVALID_CONFIGURATION"
  | "CLIENT_CLOSED"
  | "INVALID_REDIRECT_URI"
  | "INVALID_RETURN_TO"
  | "INVALID_LOGIN_REQUEST"
  | "LOGIN_FAILED"
  | "INVALID_CALLBACK"
  | "CALLBACK_FAILED"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "REFRESH_NOT_AVAILABLE"
  | "REFRESH_FAILED"
  | "LOGOUT_FAILED"
  | "STORAGE_FAILED";

interface ErrorDefinition {
  message: string;
  status: number;
  expose: boolean;
  retryable: boolean;
}

const ERROR_DEFINITIONS: Record<NodeOidcErrorCode, ErrorDefinition> = {
  INVALID_CONFIGURATION: {
    message: "OIDC 客户端配置无效",
    status: 500,
    expose: false,
    retryable: false,
  },
  CLIENT_CLOSED: {
    message: "OIDC 客户端已关闭",
    status: 503,
    expose: false,
    retryable: false,
  },
  INVALID_REDIRECT_URI: {
    message: "回调地址未注册或格式无效",
    status: 400,
    expose: true,
    retryable: false,
  },
  INVALID_RETURN_TO: {
    message: "登录返回地址无效",
    status: 400,
    expose: true,
    retryable: false,
  },
  INVALID_LOGIN_REQUEST: {
    message: "登录请求参数无效",
    status: 400,
    expose: true,
    retryable: false,
  },
  LOGIN_FAILED: {
    message: "暂时无法发起登录",
    status: 502,
    expose: false,
    retryable: true,
  },
  INVALID_CALLBACK: {
    message: "登录回调无效或已过期",
    status: 400,
    expose: true,
    retryable: false,
  },
  CALLBACK_FAILED: {
    message: "登录验证失败",
    status: 401,
    expose: true,
    retryable: false,
  },
  SESSION_NOT_FOUND: {
    message: "认证会话不存在",
    status: 401,
    expose: true,
    retryable: false,
  },
  SESSION_EXPIRED: {
    message: "认证会话已过期",
    status: 401,
    expose: true,
    retryable: false,
  },
  REFRESH_NOT_AVAILABLE: {
    message: "当前会话不支持刷新",
    status: 409,
    expose: true,
    retryable: false,
  },
  REFRESH_FAILED: {
    message: "暂时无法刷新认证会话",
    status: 502,
    expose: false,
    retryable: true,
  },
  LOGOUT_FAILED: {
    message: "本地会话已清除，但身份服务退出失败",
    status: 502,
    expose: false,
    retryable: true,
  },
  STORAGE_FAILED: {
    message: "认证状态存储暂时不可用",
    status: 503,
    expose: false,
    retryable: true,
  },
};

export const NODE_OIDC_ERROR_BRAND = Symbol.for("@x-oidc/node/NodeOidcError");

/** 对外错误只包含固定字段，不保留可能携带 Secret、Token 或上游响应的原始 cause。 */
export class NodeOidcError extends Error {
  readonly code: NodeOidcErrorCode;
  readonly status: number;
  readonly expose: boolean;
  readonly retryable: boolean;

  constructor(code: NodeOidcErrorCode) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = "NodeOidcError";
    this.code = code;
    this.status = definition.status;
    this.expose = definition.expose;
    this.retryable = definition.retryable;
    Object.defineProperty(this, NODE_OIDC_ERROR_BRAND, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      expose: this.expose,
      retryable: this.retryable,
    };
  }
}

export const isNodeOidcError = (error: unknown): error is NodeOidcError => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as Record<PropertyKey, unknown>;
  if (
    candidate[NODE_OIDC_ERROR_BRAND] !== true ||
    typeof candidate.code !== "string" ||
    !(candidate.code in ERROR_DEFINITIONS)
  ) {
    return false;
  }
  const definition = ERROR_DEFINITIONS[candidate.code as NodeOidcErrorCode];
  return (
    candidate.message === definition.message &&
    candidate.status === definition.status &&
    candidate.expose === definition.expose &&
    candidate.retryable === definition.retryable &&
    candidate.cause === undefined
  );
};

export const oidcError = (code: NodeOidcErrorCode): NodeOidcError => new NodeOidcError(code);

/** 在可注入资源边界只读取合法 code，并重建不带自定义字段或 cause 的规范错误。 */
export const canonicalizeNodeOidcError = (error: unknown): NodeOidcError | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as Record<PropertyKey, unknown>;
  if (
    candidate[NODE_OIDC_ERROR_BRAND] !== true ||
    typeof candidate.code !== "string" ||
    !(candidate.code in ERROR_DEFINITIONS)
  ) {
    return null;
  }
  return oidcError(candidate.code as NodeOidcErrorCode);
};
