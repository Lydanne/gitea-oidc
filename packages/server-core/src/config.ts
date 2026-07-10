/**
 * Gitea OIDC IdP 配置模块
 *
 * 支持从多种格式的配置文件加载配置：
 * 1. gitea-oidc.config.js (优先级最高)
 * 2. gitea-oidc.config.json (备选)
 * 3. 默认配置 (兜底)
 *
 * 特性：
 * - 支持环境变量动态配置
 * - 支持函数式配置导出
 * - 自动配置验证
 * - 深度合并配置
 * - 错误处理和回退机制
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { OidcAdapterConfig } from "./adapters/OidcAdapterFactory.js";
import type { AdminConfig } from "./types/admin.js";
import type { AuthConfig } from "./types/config.js";
import type { ProviderApiRuntimeConfig } from "./types/providerApi.js";

/**
 * Gitea OIDC IdP 完整配置接口
 *
 * 包含所有可配置的选项，涵盖服务器、日志、OIDC Provider、客户端和认证系统设置
 */
export interface GiteaOidcConfig {
  /**
   * 服务器基础配置
   * - host: 监听地址，'0.0.0.0' 表示监听所有网络接口
   * - port: 服务端口，范围 1-65535
   * - url: 公开访问的完整 URL，用于 OIDC 发现和回调
   * - trustProxy: 是否信任反向代理的 X-Forwarded-* 头（在 Nginx/Traefik 等反向代理后必须启用）
   * - corsOrigins: 允许跨域调用的浏览器 Origin；默认空数组表示不发送 CORS 响应头
   */
  server: {
    host: string;
    port: number;
    url: string;
    trustProxy: boolean;
    /** 受信任反向代理的 IP/CIDR 列表；生产环境启用 trustProxy 时必填。 */
    trustedProxyIps?: string[];
    corsOrigins: string[];
  };

  /**
   * 日志系统配置
   * - enabled: 是否启用详细日志输出
   * - level: 日志级别，支持 'info' | 'warn' | 'error' | 'debug'
   */
  logging: {
    enabled: boolean;
    level: "info" | "warn" | "error" | "debug";
  };

  /**
   * OIDC Provider 核心配置
   * 基于 oidc-provider 库的配置选项
   */
  oidc: {
    /**
     * OIDC 发行者 URL
     * 必须与 server.url 保持一致，用于生成发现文档和令牌
     */
    issuer: string;

    /**
     * Cookie 签名和加密密钥
     * 建议使用多个密钥以支持密钥轮换
     * 生产环境必须使用强密钥
     */
    cookieKeys: string[];

    /**
     * 各种令牌的生存时间（秒）
     * - AccessToken: 访问令牌，用于 API 调用
     * - AuthorizationCode: 授权码，用于授权码流程
     * - IdToken: ID 令牌，包含用户身份信息
     * - RefreshToken: 刷新令牌，用于获取新的访问令牌
     */
    ttl: {
      /**
       * 访问令牌生存时间（秒）
       */
      AccessToken: number;
      /**
       * 授权码生存时间（秒）
       */
      AuthorizationCode: number;
      /**
       * ID 令牌生存时间（秒）
       */
      IdToken: number;
      /**
       * 刷新令牌生存时间（秒）
       */
      RefreshToken: number;
    };

    /**
     * OIDC 声明配置
     * 定义支持的标准声明和自定义声明
     * - openid: 核心声明，必须包含 sub（主体标识符）
     * - profile: 用户档案信息，如姓名、邮箱等
     */
    claims: {
      /**
       * 核心声明
       * - 必须包含 sub（主体标识符）
       */
      openid: string[];
      /**
       * 用户档案信息
       * - 如姓名、邮箱等
       */
      profile: string[];
      /**
       * 自定义 scope 到声明字段列表的映射
       */
      [scope: string]: string[];
    };

    /**
     * OIDC 功能特性开关
     * 控制启用/禁用各种 OIDC 功能
     * - devInteractions: 开发模式交互页面，生产环境应禁用
     * - registration: 客户端动态注册功能
     * - revocation: 令牌撤销功能
     */
    features: {
      /**
       * 开发模式交互页面
       * - 生产环境应禁用
       */
      devInteractions: { enabled: boolean };
      /**
       * 客户端动态注册功能
       */
      registration: { enabled: boolean };
      /**
       * 令牌撤销功能
       */
      revocation: { enabled: boolean };
    };
  };

  /**
   * OAuth/OIDC 客户端配置数组
   * 每个客户端代表一个使用此 IdP 的应用程序
   *
   * 字段说明：
   * - client_id: 客户端唯一标识符
   * - client_secret: 客户端密钥，用于客户端认证
   * - redirect_uris: 授权后重定向的 URL 列表
   * - post_logout_redirect_uris: 登出后允许重定向的 URL 列表
   * - response_types: 支持的响应类型，如 'code'（授权码流程）
   * - grant_types: 支持的授权类型，如 'authorization_code'
   * - token_endpoint_auth_method: 令牌端点认证方法
   */
  clients: Array<{
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
    post_logout_redirect_uris?: string[];
    response_types: string[];
    grant_types: string[];
    token_endpoint_auth_method: string;
  }>;

  /**
   * 认证系统配置
   * 包含用户仓储和认证提供者配置
   */
  auth: AuthConfig;

  /**
   * 内置后台管理配置
   */
  admin: AdminConfig;

  /**
   * 统一 Provider API 配置
   */
  providerApi: ProviderApiRuntimeConfig;

  /**
   * OIDC 适配器配置
   * 配置持久化存储方式
   * - sqlite: SQLite 文件数据库 (默认)
   * - redis: Redis 内存数据库
   * - memory: 内存存储 (仅开发)
   */
  adapter?: OidcAdapterConfig;

  /**
   * JWKS (JSON Web Key Set) 配置
   * 用于签名和验证 JWT 令牌的密钥配置
   */
  jwks?: {
    /**
     * JWKS 文件路径
     * 默认: './jwks.json'
     */
    filePath?: string;
    /**
     * 密钥 ID (kid)
     * 用于标识密钥，支持密钥轮换
     * 默认: 'default-key'
     */
    keyId?: string;
  };
}

/**
 * 配置模块类型定义
 * 支持两种导出方式：
 * 1. 直接导出配置对象
 * 2. 导出返回配置对象的函数（支持动态配置）
 */
export type ConfigModule = GiteaOidcConfig | (() => GiteaOidcConfig);

/**
 * 默认配置常量
 *
 * 提供开箱即用的配置，包含：
 * - 本地开发服务器设置
 * - 基础日志配置
 * - 标准 OIDC Provider 设置
 * - Gitea 集成客户端
 * - 测试用户账户
 *
 * 用户配置文件会深度合并并覆盖这些默认值
 */
const defaultConfig: GiteaOidcConfig = {
  server: {
    host: "0.0.0.0",
    port: 3000,
    url: "http://localhost:3000",
    trustProxy: false,
    trustedProxyIps: [],
    corsOrigins: [],
  },

  logging: {
    enabled: true,
    level: "info",
  },

  oidc: {
    issuer: "http://localhost:3000/oidc",
    cookieKeys: ["dev-cookie-key-change-me-32-chars-min"],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
    claims: {
      openid: ["sub"],
      profile: ["name", "email", "groups", "roles", "status"],
      provider_api: [],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
    },
  },

  clients: [
    {
      client_id: "gitea",
      client_secret: "dev-client-secret-change-me",
      redirect_uris: [
        "http://localhost:3001/user/oauth2/gitea/callback",
        "http://localhost:3000/admin/callback",
      ],
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],

  auth: {
    userRepository: {
      type: "memory",
      memory: {},
    },
    providers: {
      local: {
        enabled: true,
        displayName: "本地密码",
        priority: 1,
        config: {
          passwordFile: ".htpasswd",
          passwordFormat: "bcrypt",
          adminUsers: ["admin"],
          lockoutPolicy: {
            enabled: true,
            maxAttempts: 5,
            lockoutDuration: 900,
          },
        },
      },
    },
    stateStore: {
      type: "memory",
    },
  },

  admin: {
    enabled: true,
    basePath: "/admin",
    allowedGroups: ["gitea-oidc-admins"],
    sessionTtlSeconds: 3600,
  },

  providerApi: {
    enabled: false,
    tokenEncryptionKey: "",
    refreshSkewSeconds: 300,
    probeIntervalSeconds: 300,
    requestTimeoutMs: 10000,
    responseBodyLimitBytes: 1048576,
    sdkProxy: true,
    allowedClientIds: [],
    providers: {
      feishu: {
        enabled: false,
        baseUrl: "https://open.feishu.cn/open-apis",
        allowedOperations: ["authen.user_info", "contact.user.get"],
        defaultAppOwnerId: "default",
      },
      dingtalk: {
        enabled: false,
        baseUrl: "https://api.dingtalk.com",
        allowedOperations: [],
        defaultAppOwnerId: "default",
      },
    },
  },

  adapter: {
    type: "sqlite",
    sqlite: {
      dbPath: "./oidc.db",
    },
  },

  jwks: {
    filePath: "./jwks.json",
    keyId: "default-key",
  },
};

/**
 * 配置加载函数
 *
 * 按优先级顺序加载配置文件：
 * 1. gitea-oidc.config.js (支持动态配置、环境变量、函数导出)
 * 2. gitea-oidc.config.json (静态配置)
 * 3. 默认配置 (兜底方案)
 *
 * 特性：
 * - 自动检测配置文件格式
 * - 支持函数式配置导出
 * - 深度合并用户配置和默认配置
 * - 配置验证确保关键选项正确
 * - 错误处理和回退机制
 *
 * @returns {GiteaOidcConfig} 合并后的完整配置对象
 */
export async function loadConfig(): Promise<GiteaOidcConfig> {
  const jsConfigPath = join(process.cwd(), "gitea-oidc.config.js");
  const jsonConfigPath = join(process.cwd(), "gitea-oidc.config.json");

  let configPath = "";
  let userConfig: Partial<GiteaOidcConfig> = {};

  // 优先查找 .js 配置文件
  if (existsSync(jsConfigPath)) {
    configPath = jsConfigPath;
    try {
      // 动态导入 .js 配置文件 (使用 import() 而不是 require)
      const configModule = await import(`file://${jsConfigPath}`);
      userConfig =
        typeof configModule.default === "function"
          ? configModule.default()
          : configModule.default || configModule;
      console.log(`✅ JS 配置文件已加载: ${configPath}`);
    } catch (error) {
      throw new Error(`JS 配置文件加载失败: ${formatConfigLoadError(error)}`);
    }
  } else if (existsSync(jsonConfigPath)) {
    configPath = jsonConfigPath;
    try {
      const configFile = readFileSync(jsonConfigPath, "utf-8");
      userConfig = JSON.parse(configFile);
      console.log(`✅ JSON 配置文件已加载: ${configPath}`);
    } catch (error) {
      throw new Error(`JSON 配置文件解析失败: ${formatConfigLoadError(error)}`);
    }
  } else {
    console.log(`⚠️  配置文件未找到，查找路径:`);
    console.log(`   - ${jsConfigPath}`);
    console.log(`   - ${jsonConfigPath}`);
    if (isProductionRuntime()) {
      throw new Error("生产环境必须提供 gitea-oidc.config.js 或 gitea-oidc.config.json");
    }
    console.log("💡 提示: 创建 gitea-oidc.config.js 或 gitea-oidc.config.json 文件来自定义配置");
    return validateLoadedConfig(defaultConfig);
  }

  // 认证提供者是安全边界：用户声明 providers 时，不能把默认 local/.htpasswd
  // 隐式带入生产配置。其他字段继续按现有规则深度合并。
  const mergedConfig = deepMerge(defaultConfig, userConfig);

  return validateLoadedConfig(mergedConfig);
}

async function validateLoadedConfig(config: GiteaOidcConfig): Promise<GiteaOidcConfig> {
  // 使用 Zod 验证配置
  const { validateConfig: zodValidateConfig, printValidationResult } = await import(
    "./utils/configValidator"
  );
  const validation = zodValidateConfig(config);

  printValidationResult(validation);

  if (!validation.valid) {
    throw new Error(
      `配置验证失败:\n${validation.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("\n")}`,
    );
  }

  return validation.config!;
}

/**
 * 深度合并对象函数
 *
 * 将源对象的属性递归合并到目标对象中：
 * - 支持嵌套对象的深度合并
 * - 数组会被完全替换（不进行合并）
 * - undefined 值不会覆盖目标对象的属性
 * - 保持目标对象的类型安全
 *
 * 用途：将用户配置与默认配置合并，用户配置优先级更高
 *
 * @template T - 目标对象的类型
 * @param {T} target - 目标对象（通常是默认配置）
 * @param {Partial<T>} source - 源对象（用户配置）
 * @returns {T} 合并后的对象
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (key === "auth" && (source as any).auth?.providers !== undefined) {
        (result as any).auth = {
          ...deepMerge((result as any).auth, (source as any).auth),
          providers: (source as any).auth.providers,
        };
      } else if (
        typeof source[key] === "object" &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(result[key], source[key] as any);
      } else {
        result[key] = source[key] as any;
      }
    }
  }

  return result;
}

function formatConfigLoadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isProductionRuntime(): boolean {
  // 未显式声明 development/test 的直接启动必须默认走安全的生产校验，避免 Docker
  // 或 node dist/server.js 因漏设 NODE_ENV 而静默降级。
  return process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
}

export function defineConfig(config: GiteaOidcConfig): GiteaOidcConfig {
  return config;
}
