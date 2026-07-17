export type ApplicationErrorCode =
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_CONFLICT"
  | "APPLICATION_VERSION_CONFLICT"
  | "APPLICATION_VALIDATION_FAILED"
  | "IDEMPOTENCY_CONFLICT"
  | "SECRET_CONFIGURATION_INVALID"
  | "SECRET_DECRYPTION_FAILED"
  | "APPLICATION_REPOSITORY_CLOSED"
  | "APPLICATION_STORAGE_CORRUPTED"
  | "UNSUPPORTED_CREDENTIAL_DELIVERY";

export class ApplicationError extends Error {
  public constructor(
    public readonly code: ApplicationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ApplicationNotFoundError extends ApplicationError {
  public constructor(id: string) {
    super("APPLICATION_NOT_FOUND", `应用不存在: ${id}`);
  }
}

export class ApplicationConflictError extends ApplicationError {
  public constructor(message: string) {
    super("APPLICATION_CONFLICT", message);
  }
}

export class ApplicationVersionConflictError extends ApplicationError {
  public constructor(id: string, expectedVersion: number, actualVersion: number) {
    super(
      "APPLICATION_VERSION_CONFLICT",
      `应用 ${id} 的版本已变化，期望 ${expectedVersion}，实际 ${actualVersion}`,
    );
  }
}

export class ApplicationValidationError extends ApplicationError {
  public constructor(message: string, options?: ErrorOptions) {
    super("APPLICATION_VALIDATION_FAILED", message, options);
  }
}

export class IdempotencyConflictError extends ApplicationError {
  public constructor() {
    super("IDEMPOTENCY_CONFLICT", "同一幂等键已用于不同的创建请求");
  }
}

export class SecretConfigurationError extends ApplicationError {
  public constructor(message: string) {
    super("SECRET_CONFIGURATION_INVALID", message);
  }
}

export class SecretDecryptionError extends ApplicationError {
  public constructor(options?: ErrorOptions) {
    super("SECRET_DECRYPTION_FAILED", "应用密钥解密失败", options);
  }
}

export class UnsupportedCredentialDeliveryError extends ApplicationError {
  public constructor(kind: string) {
    super("UNSUPPORTED_CREDENTIAL_DELIVERY", `当前尚不支持 ${kind} 凭据交付`);
  }
}

export class ApplicationRepositoryClosedError extends ApplicationError {
  public constructor() {
    super("APPLICATION_REPOSITORY_CLOSED", "应用仓储已关闭");
  }
}

export class ApplicationStorageCorruptionError extends ApplicationError {
  public constructor(recordType: string, options?: ErrorOptions) {
    super(
      "APPLICATION_STORAGE_CORRUPTED",
      `应用仓储中的 ${recordType} 数据损坏或不符合当前 schema`,
      options,
    );
  }
}
