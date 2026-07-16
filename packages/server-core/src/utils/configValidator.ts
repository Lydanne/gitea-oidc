/**
 * 配置验证工具
 *
 * 提供配置验证、警告检查和错误格式化功能
 */

import { ZodError } from "zod";
import { type ResolvedGiteaOidcConfig, resolveApplicationsConfig } from "../config.js";
import { GiteaOidcConfigSchema } from "../schemas/configSchema.js";
import {
  findAdminClient,
  formatAdminClientRequirement,
  getAdminRedirectUri,
} from "./adminClient.js";
import { Logger } from "./Logger.js";

const DEFAULT_COOKIE_KEYS = new Set([
  "change-this-to-a-random-string-in-production",
  "and-another-one-for-key-rotation",
  "your-secret-cookie-key-change-in-production",
  "another-secret-key-for-rotation",
  "dev-cookie-key-change-me-32-chars-min",
]);

const DEFAULT_CLIENT_SECRETS = new Set([
  "secret",
  "gitea-client-secret-change-in-production",
  "change-this-client-secret",
  "dev-client-secret-change-me",
]);

/**
 * 配置验证错误
 */
export interface ConfigValidationError {
  /** 错误路径 */
  path: string;

  /** 错误消息 */
  message: string;

  /** 错误代码 */
  code: string;
}

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  /** 是否验证通过 */
  valid: boolean;

  /** 验证错误列表 */
  errors: ConfigValidationError[];

  /** 警告列表 */
  warnings: string[];

  /** 验证后的配置（如果验证通过） */
  config?: ResolvedGiteaOidcConfig;
}

/**
 * 验证配置
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result = GiteaOidcConfigSchema.safeParse(config);

  if (result.success) {
    const parsedConfig = result.data as unknown as ResolvedGiteaOidcConfig;
    const errors = [
      ...checkRuntimeConfigErrors(parsedConfig),
      ...checkProductionErrors(parsedConfig),
    ];
    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings: [],
      };
    }

    const warnings = checkConfigWarnings(parsedConfig);
    return {
      valid: true,
      errors: [],
      warnings,
      config: parsedConfig,
    };
  }

  const errors: ConfigValidationError[] = (result.error as ZodError).issues.map((err: any) => ({
    path: err.path.join("."),
    message: err.message,
    code: err.code,
  }));

  return {
    valid: false,
    errors,
    warnings: [],
  };
}

function checkRuntimeConfigErrors(config: ResolvedGiteaOidcConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  const applications = resolveApplicationsConfig(config);
  addPublicUrlBoundaryErrors(errors, "server.url", config.server.url);
  addPublicUrlBoundaryErrors(errors, "oidc.issuer", config.oidc.issuer);
  config.server.corsOrigins.forEach((origin, index) => {
    addCorsOriginBoundaryErrors(errors, `server.corsOrigins.${index}`, origin);
  });
  addProviderApiBaseUrlBoundaryErrors(errors, config);

  if (applications.enabled) {
    const applicationMasterKey = applications.secretEncryption.masterKey;
    if (
      config.oidc.cookieKeys.includes(applicationMasterKey) ||
      config.clients.some((client) => client.client_secret === applicationMasterKey) ||
      (config.providerApi.tokenEncryptionKey !== "" &&
        config.providerApi.tokenEncryptionKey === applicationMasterKey)
    ) {
      errors.push({
        path: "applications.secretEncryption.masterKey",
        message: "应用密钥主密钥必须与 OIDC Cookie、Client Secret 和 Provider Token 密钥分域",
        code: "application_secret_key_reuse_forbidden",
      });
    }
  }

  const expectedIssuer = getExpectedOidcIssuer(config.server.url);

  if (expectedIssuer && normalizeUrlForComparison(config.oidc.issuer) !== expectedIssuer) {
    errors.push({
      path: "oidc.issuer",
      message: `oidc.issuer 必须等于 ${expectedIssuer}，与当前 /oidc 挂载路径保持一致`,
      code: "oidc_issuer_mismatch",
    });
  }

  if (config.admin.enabled && !findAdminClient(config, config.admin.basePath)) {
    const redirectUri = getAdminRedirectUri(config, config.admin.basePath);
    errors.push({
      path: "clients",
      message: `启用内置后台时，${formatAdminClientRequirement(redirectUri)}`,
      code: "admin_client_required",
    });
  }

  return errors;
}

function checkProductionErrors(config: ResolvedGiteaOidcConfig): ConfigValidationError[] {
  if (!isProductionRuntime()) {
    return [];
  }

  const errors: ConfigValidationError[] = [];
  const applications = resolveApplicationsConfig(config);

  config.oidc.cookieKeys.forEach((key, index) => {
    if (DEFAULT_COOKIE_KEYS.has(key)) {
      errors.push({
        path: `oidc.cookieKeys.${index}`,
        message: "生产环境 oidc.cookieKeys 不能使用示例或默认密钥",
        code: "production_default_secret_forbidden",
      });
    }
  });

  if (!isHttpsUrl(config.server.url)) {
    errors.push({
      path: "server.url",
      message: "生产环境 server.url 必须使用 HTTPS 公网地址",
      code: "production_https_required",
    });
  }

  if (!isHttpsUrl(config.oidc.issuer)) {
    errors.push({
      path: "oidc.issuer",
      message: "生产环境 oidc.issuer 必须使用 HTTPS 公网地址",
      code: "production_https_required",
    });
  }

  config.server.corsOrigins.forEach((origin, index) => {
    if (!isHttpsUrl(origin)) {
      errors.push({
        path: `server.corsOrigins.${index}`,
        message: "生产环境 CORS Origin 必须使用 HTTPS",
        code: "production_https_required",
      });
    }
  });

  config.clients.forEach((client, clientIndex) => {
    if (client.client_secret.length < 16) {
      errors.push({
        path: `clients.${clientIndex}.client_secret`,
        message: `生产环境客户端 "${client.client_id}" 的 client_secret 长度至少需要 16 字符`,
        code: "production_client_secret_too_short",
      });
    }

    if (DEFAULT_CLIENT_SECRETS.has(client.client_secret)) {
      errors.push({
        path: `clients.${clientIndex}.client_secret`,
        message: `生产环境客户端 "${client.client_id}" 不能使用示例或默认 client_secret`,
        code: "production_default_secret_forbidden",
      });
    }

    client.redirect_uris.forEach((uri, uriIndex) => {
      if (!isHttpsUrl(uri)) {
        errors.push({
          path: `clients.${clientIndex}.redirect_uris.${uriIndex}`,
          message: `生产环境客户端 "${client.client_id}" 的 redirect_uri 必须使用 HTTPS`,
          code: "production_https_required",
        });
      }
    });

    client.post_logout_redirect_uris?.forEach((uri, uriIndex) => {
      if (!isHttpsUrl(uri)) {
        errors.push({
          path: `clients.${clientIndex}.post_logout_redirect_uris.${uriIndex}`,
          message: `生产环境客户端 "${client.client_id}" 的 post_logout_redirect_uri 必须使用 HTTPS`,
          code: "production_https_required",
        });
      }
    });
  });

  if (config.auth.userRepository.type === "memory") {
    errors.push({
      path: "auth.userRepository.type",
      message: "生产环境必须使用 sqlite 或 pgsql 用户仓储，不能使用 memory",
      code: "production_storage_required",
    });
  }

  if (config.adapter?.type === "memory") {
    errors.push({
      path: "adapter.type",
      message: "生产环境必须使用 sqlite 或 redis OIDC 适配器，不能使用 memory",
      code: "production_storage_required",
    });
  }

  if (applications.enabled && applications.repository.type === "memory") {
    errors.push({
      path: "applications.repository.type",
      message: "生产环境启用应用管理时必须使用 sqlite 应用仓储，不能使用 memory",
      code: "production_storage_required",
    });
  }

  if (
    applications.enabled &&
    applications.repository.type === "sqlite" &&
    isEphemeralSqlitePath(applications.repository.sqlite?.dbPath)
  ) {
    errors.push({
      path: "applications.repository.sqlite.dbPath",
      message: "生产环境应用仓储不能使用 SQLite :memory:",
      code: "production_storage_required",
    });
  }

  if (config.adapter?.type === "sqlite" && isEphemeralSqlitePath(config.adapter.sqlite?.dbPath)) {
    errors.push({
      path: "adapter.sqlite.dbPath",
      message: "生产环境 OIDC adapter 不能使用 SQLite :memory:",
      code: "production_storage_required",
    });
  }

  if (config.oidc.features.devInteractions.enabled) {
    errors.push({
      path: "oidc.features.devInteractions.enabled",
      message: "生产环境禁止启用 devInteractions，它可绕过实际认证交互",
      code: "production_dev_interactions_forbidden",
    });
  }

  if (!config.server.trustProxy) {
    errors.push({
      path: "server.trustProxy",
      message: "生产环境必须通过受信任的 HTTPS 反向代理访问，并设置 trustProxy: true",
      code: "production_trust_proxy_required",
    });
  }

  if (config.server.trustProxy && (config.server.trustedProxyIps?.length ?? 0) === 0) {
    errors.push({
      path: "server.trustedProxyIps",
      message: "生产环境启用 trustProxy 时必须限制为受信任反向代理的 IP 或 CIDR",
      code: "production_trusted_proxy_ips_required",
    });
  }

  if (config.adapter?.type === "redis" && config.auth.stateStore?.type !== "redis") {
    errors.push({
      path: "auth.stateStore",
      message:
        "Redis OIDC 适配器的多实例部署必须使用 Redis stateStore，以保证 OAuth state 和后台会话跨节点一致",
      code: "production_distributed_state_store_required",
    });
  }

  if (
    config.providerApi.enabled &&
    config.providerApi.sdkProxy &&
    config.providerApi.allowedClientIds.length === 0
  ) {
    errors.push({
      path: "providerApi.allowedClientIds",
      message: "生产环境启用 Provider API SDK 代理时必须配置允许调用的 OIDC client_id",
      code: "production_provider_api_client_allowlist_required",
    });
  }

  if (config.providerApi.enabled) {
    const configuredClientIds = new Set(config.clients.map((client) => client.client_id));
    config.providerApi.allowedClientIds.forEach((clientId, index) => {
      if (!configuredClientIds.has(clientId)) {
        errors.push({
          path: `providerApi.allowedClientIds.${index}`,
          message: `Provider API allowedClientIds 包含未配置的客户端: ${clientId}`,
          code: "production_provider_api_client_unknown",
        });
      }
    });

    for (const [providerName, providerConfig] of Object.entries(config.providerApi.providers)) {
      if (!providerConfig.enabled || !providerConfig.baseUrl) {
        continue;
      }

      if (!isHttpsUrl(providerConfig.baseUrl)) {
        errors.push({
          path: `providerApi.providers.${providerName}.baseUrl`,
          message: `生产环境 Provider API "${providerName}" 的 baseUrl 必须使用 HTTPS`,
          code: "production_provider_api_base_url_https_required",
        });
      }
    }
  }

  const localProvider = config.auth.providers.local;
  if (localProvider?.enabled) {
    const localConfig = localProvider.config as Record<string, unknown>;
    if (typeof localConfig.passwordFile !== "string" || localConfig.passwordFile.trim() === "") {
      errors.push({
        path: "auth.providers.local.config.passwordFile",
        message: "生产环境启用本地认证时必须配置 passwordFile",
        code: "production_local_password_file_required",
      });
    }

    if (localConfig.passwordFormat !== "bcrypt") {
      errors.push({
        path: "auth.providers.local.config.passwordFormat",
        message:
          "生产环境启用本地认证时必须显式配置 passwordFormat 为 bcrypt，不能使用 auto、md5 或 sha",
        code: "production_local_password_bcrypt_required",
      });
    }
  }

  const feishuProvider = config.auth.providers.feishu;
  if (feishuProvider?.enabled) {
    const feishuConfig = feishuProvider.config as Record<string, unknown>;
    const callback = typeof feishuConfig.redirectUri === "string" ? feishuConfig.redirectUri : "";
    const expectedCallback = `${config.server.url.replace(/\/$/, "")}/auth/feishu/callback`;
    if (typeof feishuConfig.appId !== "string" || feishuConfig.appId.trim() === "") {
      errors.push({
        path: "auth.providers.feishu.config.appId",
        message: "生产环境启用飞书认证时必须配置 appId",
        code: "production_feishu_app_id_required",
      });
    }
    if (typeof feishuConfig.appSecret !== "string" || feishuConfig.appSecret.trim() === "") {
      errors.push({
        path: "auth.providers.feishu.config.appSecret",
        message: "生产环境启用飞书认证时必须配置 appSecret",
        code: "production_feishu_app_secret_required",
      });
    }
    if (
      !isHttpsUrl(callback) ||
      normalizeUrlForComparison(callback) !== normalizeUrlForComparison(expectedCallback)
    ) {
      errors.push({
        path: "auth.providers.feishu.config.redirectUri",
        message: `生产环境飞书 redirectUri 必须为 ${expectedCallback}`,
        code: "production_feishu_redirect_uri_mismatch",
      });
    }
  }

  return errors;
}

/**
 * 检查配置警告
 */
function checkConfigWarnings(config: any): string[] {
  const warnings: string[] = [];

  // 检查 Cookie 密钥强度
  if (config.oidc?.cookieKeys) {
    config.oidc.cookieKeys.forEach((key: string, index: number) => {
      if (key.length < 32) {
        warnings.push(`Cookie 密钥 #${index + 1} 长度小于 32 字符，建议使用更长的密钥`);
      }
    });
  }

  // 检查是否使用默认密钥
  if (config.oidc?.cookieKeys) {
    config.oidc.cookieKeys.forEach((key: string) => {
      if (DEFAULT_COOKIE_KEYS.has(key)) {
        warnings.push(`⚠️  检测到默认 Cookie 密钥，生产环境中必须更换为随机字符串`);
      }
    });
  }

  // 检查客户端密钥强度
  if (config.clients) {
    config.clients.forEach((client: any, index: number) => {
      if (client.client_secret && client.client_secret.length < 16) {
        warnings.push(
          `客户端 #${index + 1} (${client.client_id}) 的密钥长度小于 16 字符，建议使用更长的密钥`,
        );
      }

      // 检查是否使用默认密钥
      if (DEFAULT_CLIENT_SECRETS.has(client.client_secret)) {
        warnings.push(`⚠️  客户端 "${client.client_id}" 使用默认密钥，生产环境中必须更换`);
      }
    });
  }

  // 检查是否启用了任何认证提供者
  if (config.auth?.providers) {
    const enabledProviders = Object.entries(config.auth.providers).filter(
      ([_, p]: [string, any]) => p.enabled,
    );

    if (enabledProviders.length === 0) {
      warnings.push("⚠️  没有启用任何认证提供者，用户将无法登录");
    }
  }

  // 检查本地认证配置
  if (config.auth?.providers?.local?.enabled) {
    const localConfig = config.auth.providers.local.config;
    if (!localConfig.passwordFile) {
      warnings.push("本地认证已启用但未配置 passwordFile");
    }
    if (!localConfig.passwordFormat) {
      warnings.push("本地认证未显式配置 passwordFormat，生产环境必须使用 bcrypt");
    } else if (localConfig.passwordFormat !== "bcrypt") {
      warnings.push(
        `本地认证 passwordFormat=${localConfig.passwordFormat} 不适合生产环境，生产环境必须使用 bcrypt`,
      );
    }
  }

  // 检查飞书认证配置
  if (config.auth?.providers?.feishu?.enabled) {
    const feishuConfig = config.auth.providers.feishu.config;
    if (!feishuConfig.appId || !feishuConfig.appSecret) {
      warnings.push("飞书认证已启用但未配置 appId 或 appSecret");
    }
    if (!feishuConfig.verificationToken) {
      warnings.push("飞书认证已启用但未配置 verificationToken，Webhook 请求将被拒绝");
    }
    if (!feishuConfig.encryptKey) {
      warnings.push("飞书认证已启用但未配置 encryptKey，Webhook 签名和加密请求将被拒绝");
    }
  }

  if (config.admin?.enabled && config.admin.allowedGroups?.includes("Owners")) {
    warnings.push(
      '⚠️  后台管理员组仍使用通用名称 "Owners"，建议改为专用组名以避免与外部 Provider 组冲突',
    );
  }

  if (config.audit?.enabled === false) {
    warnings.push("身份审计已关闭，登录、退出和用户资料变更将无法追溯");
  }

  // 检查 HTTPS
  if (config.server?.url && !config.server.url.startsWith("https://")) {
    warnings.push("⚠️  服务器 URL 未使用 HTTPS，生产环境中建议使用 HTTPS");
  }

  // 检查 redirect_uris 是否使用 HTTPS
  if (config.clients) {
    config.clients.forEach((client: any) => {
      if (client.redirect_uris) {
        client.redirect_uris.forEach((uri: string) => {
          if (!uri.startsWith("https://") && !uri.startsWith("http://localhost")) {
            warnings.push(`客户端 "${client.client_id}" 的重定向 URI "${uri}" 未使用 HTTPS`);
          }
        });
      }

      if (client.post_logout_redirect_uris) {
        client.post_logout_redirect_uris.forEach((uri: string) => {
          if (!uri.startsWith("https://") && !uri.startsWith("http://localhost")) {
            warnings.push(`客户端 "${client.client_id}" 的登出后重定向 URI "${uri}" 未使用 HTTPS`);
          }
        });
      }
    });
  }

  return warnings;
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
}

function getExpectedOidcIssuer(serverUrl: string): string | null {
  try {
    const url = new URL(serverUrl);
    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/oidc`;
    return normalizeUrlForComparison(url.toString());
  } catch {
    return null;
  }
}

function normalizeUrlForComparison(value: string): string {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function addPublicUrlBoundaryErrors(
  errors: ConfigValidationError[],
  path: string,
  value: string,
): void {
  try {
    const url = new URL(value);
    if (url.search || url.hash) {
      errors.push({
        path,
        message: `${path} 不能包含 query 或 fragment`,
        code: "url_query_fragment_forbidden",
      });
    }
  } catch {
    // Zod URL 校验会负责报告非法 URL。
  }
}

function addCorsOriginBoundaryErrors(
  errors: ConfigValidationError[],
  path: string,
  value: string,
): void {
  try {
    const url = new URL(value);
    if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      errors.push({
        path,
        message: "server.corsOrigins 只能配置纯 Origin，不能包含 path、query 或 fragment",
        code: "cors_origin_must_be_origin",
      });
    }
  } catch {
    // Zod URL 校验会负责报告非法 URL。
  }
}

function addProviderApiBaseUrlBoundaryErrors(
  errors: ConfigValidationError[],
  config: ResolvedGiteaOidcConfig,
): void {
  if (!config.providerApi.enabled) {
    return;
  }

  for (const [providerName, providerConfig] of Object.entries(config.providerApi.providers)) {
    if (!providerConfig.enabled || !providerConfig.baseUrl) {
      continue;
    }

    const path = `providerApi.providers.${providerName}.baseUrl`;
    try {
      const url = new URL(providerConfig.baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.push({
          path,
          message: "Provider API baseUrl 只允许使用 HTTP 或 HTTPS",
          code: "provider_api_base_url_protocol_forbidden",
        });
      }
      if (url.username || url.password) {
        errors.push({
          path,
          message: "Provider API baseUrl 不能包含用户名或密码",
          code: "provider_api_base_url_userinfo_forbidden",
        });
      }
      if (url.search || url.hash) {
        errors.push({
          path,
          message: "Provider API baseUrl 不能包含 query 或 fragment",
          code: "provider_api_base_url_query_fragment_forbidden",
        });
      }
    } catch {
      // Zod URL 校验会负责报告非法 URL。
    }
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isEphemeralSqlitePath(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized === ":memory:" ||
    normalized.startsWith("file::memory:") ||
    /^file:.*(?:[?&])mode=memory(?:&|$)/.test(normalized)
  );
}

/**
 * 格式化验证错误
 */
export function formatValidationErrors(errors: ConfigValidationError[]): string {
  if (errors.length === 0) {
    return "";
  }

  return errors
    .map((err) => {
      const path = err.path ? `  配置项 "${err.path}": ` : "  ";
      return `${path}${err.message}`;
    })
    .join("\n");
}

/**
 * 格式化警告
 */
export function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) {
    return "";
  }

  return warnings.map((warning) => `  - ${warning}`).join("\n");
}

/**
 * 打印验证结果
 */
export function printValidationResult(result: ConfigValidationResult): void {
  if (!result.valid) {
    Logger.error("\n❌ 配置验证失败:\n");
    Logger.error(formatValidationErrors(result.errors));
    Logger.error("");
  } else {
    Logger.info("✅ 配置验证通过");

    if (result.warnings.length > 0) {
      Logger.warn("\n⚠️  配置警告:");
      Logger.warn(formatWarnings(result.warnings));
      Logger.warn("");
    }
  }
}
