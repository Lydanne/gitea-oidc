import { isNodeOidcError, type NodeOidcErrorCode } from "@x-oidc/node";

export type ConnectorErrorCode =
  | "AUTH_REQUIRED"
  | "CSRF_REJECTED"
  | "INVALID_CLIENT_RESPONSE"
  | "INVALID_CONNECTOR_CONFIGURATION"
  | "INVALID_REQUEST"
  | "METHOD_NOT_ALLOWED";

interface ConnectorErrorDefinition {
  readonly status: number;
  readonly message: string;
  readonly retryable: boolean;
}

const CONNECTOR_ERROR_DEFINITIONS: Record<ConnectorErrorCode, ConnectorErrorDefinition> = {
  AUTH_REQUIRED: {
    status: 401,
    message: "需要有效的认证会话",
    retryable: false,
  },
  CSRF_REJECTED: {
    status: 403,
    message: "请求来源校验失败",
    retryable: false,
  },
  INVALID_CLIENT_RESPONSE: {
    status: 502,
    message: "认证客户端返回了无效结果",
    retryable: false,
  },
  INVALID_CONNECTOR_CONFIGURATION: {
    status: 500,
    message: "OIDC 连接器配置无效",
    retryable: false,
  },
  INVALID_REQUEST: {
    status: 400,
    message: "OIDC 请求格式无效",
    retryable: false,
  },
  METHOD_NOT_ALLOWED: {
    status: 405,
    message: "请求方法不受支持",
    retryable: false,
  },
};

const NODE_ERROR_DEFINITIONS: Record<NodeOidcErrorCode, ConnectorErrorDefinition> = {
  INVALID_CONFIGURATION: {
    status: 500,
    message: "认证服务暂时不可用",
    retryable: false,
  },
  CLIENT_CLOSED: {
    status: 503,
    message: "认证服务暂时不可用",
    retryable: false,
  },
  INVALID_REDIRECT_URI: {
    status: 400,
    message: "回调地址未注册或格式无效",
    retryable: false,
  },
  INVALID_RETURN_TO: {
    status: 400,
    message: "登录返回地址无效",
    retryable: false,
  },
  INVALID_LOGIN_REQUEST: {
    status: 400,
    message: "登录请求参数无效",
    retryable: false,
  },
  LOGIN_FAILED: {
    status: 502,
    message: "认证服务暂时不可用",
    retryable: true,
  },
  INVALID_CALLBACK: {
    status: 400,
    message: "登录回调无效或已过期",
    retryable: false,
  },
  CALLBACK_FAILED: {
    status: 401,
    message: "登录验证失败",
    retryable: false,
  },
  SESSION_NOT_FOUND: {
    status: 401,
    message: "认证会话不存在",
    retryable: false,
  },
  SESSION_EXPIRED: {
    status: 401,
    message: "认证会话已过期",
    retryable: false,
  },
  REFRESH_NOT_AVAILABLE: {
    status: 409,
    message: "当前会话不支持刷新",
    retryable: false,
  },
  REFRESH_FAILED: {
    status: 502,
    message: "认证服务暂时不可用",
    retryable: true,
  },
  LOGOUT_FAILED: {
    status: 502,
    message: "本地会话已清除，但身份服务退出失败",
    retryable: true,
  },
  STORAGE_FAILED: {
    status: 503,
    message: "认证服务暂时不可用",
    retryable: true,
  },
};

const CONNECTOR_ERROR_BRAND = Symbol.for("@x-oidc/connector-core/ConnectorError");

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;

  constructor(code: ConnectorErrorCode) {
    super(CONNECTOR_ERROR_DEFINITIONS[code].message);
    this.name = "ConnectorError";
    this.code = code;
    Object.defineProperty(this, CONNECTOR_ERROR_BRAND, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
  }
}

export const isConnectorError = (error: unknown): error is ConnectorError => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as Record<PropertyKey, unknown>;
  return (
    candidate[CONNECTOR_ERROR_BRAND] === true &&
    typeof candidate.code === "string" &&
    candidate.code in CONNECTOR_ERROR_DEFINITIONS
  );
};

export interface ConnectorErrorBody {
  readonly error: {
    readonly code: ConnectorErrorCode | NodeOidcErrorCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface MappedConnectorError {
  readonly status: number;
  readonly body: ConnectorErrorBody;
}

export const connectorError = (code: ConnectorErrorCode): ConnectorError =>
  new ConnectorError(code);

/** 未知异常返回 null，由具体框架交给自己的错误链处理。 */
export const mapConnectorError = (error: unknown): MappedConnectorError | null => {
  let code: ConnectorErrorCode | NodeOidcErrorCode;
  let definition: ConnectorErrorDefinition;

  if (isConnectorError(error)) {
    code = error.code;
    definition = CONNECTOR_ERROR_DEFINITIONS[code];
  } else if (isNodeOidcError(error)) {
    code = error.code;
    definition = NODE_ERROR_DEFINITIONS[code];
  } else {
    return null;
  }

  return Object.freeze({
    status: definition.status,
    body: Object.freeze({
      error: Object.freeze({
        code,
        message: definition.message,
        retryable: definition.retryable,
      }),
    }),
  });
};
