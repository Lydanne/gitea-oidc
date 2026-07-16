/**
 * 配置验证 Schema
 * 使用 Zod 进行配置验证
 */

import { z } from "zod";

/**
 * 服务器配置 Schema
 */
export const ServerConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().int().min(1).max(65535).default(3000),
  url: z.url({ message: "服务器 URL 必须是有效的 URL" }),
  trustProxy: z.boolean().default(false),
  trustedProxyIps: z.array(z.string().min(1)).optional().default([]),
  corsOrigins: z.array(z.url({ message: "CORS Origin 必须是有效的 URL" })).default([]),
});

/**
 * 日志配置 Schema
 */
export const LoggingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/**
 * 审计日志配置 Schema
 */
export const AuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(3650).default(30),
});

/**
 * OIDC TTL 配置 Schema
 */
export const OidcTTLSchema = z.object({
  AccessToken: z.number().int().positive().default(3600),
  AuthorizationCode: z.number().int().positive().default(600),
  IdToken: z.number().int().positive().default(3600),
  RefreshToken: z.number().int().positive().default(86400),
});

/**
 * OIDC Features 配置 Schema
 */
export const OidcFeaturesSchema = z.object({
  devInteractions: z.object({ enabled: z.boolean() }),
  registration: z.object({ enabled: z.boolean() }),
  revocation: z.object({ enabled: z.boolean() }),
});

/**
 * OIDC 配置 Schema
 */
export const OidcConfigSchema = z.object({
  issuer: z.url({ message: "OIDC issuer 必须是有效的 URL" }),
  cookieKeys: z
    .array(z.string().min(32, "Cookie 密钥长度至少 32 个字符"))
    .min(1, "至少需要一个 Cookie 密钥"),
  ttl: OidcTTLSchema,
  claims: z.record(z.string(), z.array(z.string())),
  features: OidcFeaturesSchema,
});

/**
 * 客户端配置 Schema
 */
export const ClientConfigSchema = z.object({
  client_id: z.string().min(1, "客户端 ID 不能为空"),
  client_secret: z.string().min(8, "客户端密钥长度至少 8 个字符"),
  redirect_uris: z
    .array(z.url({ message: "重定向 URI 必须是有效的 URL" }))
    .min(1, "至少需要一个重定向 URI"),
  post_logout_redirect_uris: z
    .array(z.url({ message: "登出后重定向 URI 必须是有效的 URL" }))
    .optional(),
  response_types: z.array(z.string()).min(1),
  grant_types: z.array(z.string()).min(1),
  token_endpoint_auth_method: z.string(),
  portal: z
    .object({
      enabled: z.boolean().default(true),
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().min(1).max(2000).optional(),
      launch_url: z.url({ message: "门户应用入口必须是有效的 URL" }),
      icon_url: z.url({ message: "门户应用图标必须是有效的 URL" }).optional(),
      order: z.number().int().min(0).max(1_000_000).default(0),
    })
    .superRefine((portal, context) => {
      for (const [field, value] of [
        ["launch_url", portal.launch_url],
        ["icon_url", portal.icon_url],
      ] as const) {
        if (!value) continue;
        try {
          const url = new URL(value);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            context.addIssue({
              code: "custom",
              path: [field],
              message: "门户 URL 只允许使用 HTTP 或 HTTPS",
            });
          }
          if (url.username || url.password) {
            context.addIssue({
              code: "custom",
              path: [field],
              message: "门户 URL 不能包含用户名或密码",
            });
          }
          if (url.hash) {
            context.addIssue({
              code: "custom",
              path: [field],
              message: "门户 URL 不能包含 fragment",
            });
          }
          if (value.includes("*")) {
            context.addIssue({
              code: "custom",
              path: [field],
              message: "门户 URL 不能包含通配符",
            });
          }
          if (url.protocol === "http:" && !isLoopbackPortalHostname(url.hostname)) {
            context.addIssue({
              code: "custom",
              path: [field],
              message: "HTTP 门户 URL 仅允许 localhost 或 loopback 地址",
            });
          }
        } catch {
          // z.url 会提供基础 URL 错误。
        }
      }
    })
    .optional(),
});

function isLoopbackPortalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
  );
}

/**
 * 认证提供者配置 Schema
 */
export const AuthProviderConfigSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string(),
  priority: z.number().int().optional(),
  config: z.record(z.string(), z.any()),
});

/**
 * SQLite 仓储配置 Schema
 */
export const SqliteRepositoryConfigSchema = z.object({
  dbPath: z.string().optional().default("./users.db"),
});

/**
 * PostgreSQL 仓储配置 Schema
 */
export const PgsqlRepositoryConfigSchema = z
  .object({
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional().default(5432),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
  })
  .refine(
    (data) => {
      // 必须提供 connectionString 或 host
      return data.connectionString || data.host;
    },
    {
      message: "PostgreSQL 配置必须提供 connectionString 或 host",
    },
  );

/**
 * 用户仓储配置 Schema
 */
export const UserRepositoryConfigSchema = z
  .object({
    type: z.enum(["memory", "sqlite", "pgsql"], {
      message: "用户仓储类型必须是 memory、sqlite 或 pgsql",
    }),
    sqlite: SqliteRepositoryConfigSchema.optional(),
    pgsql: PgsqlRepositoryConfigSchema.optional(),
    memory: z.object({}).optional(),
  })
  .refine(
    (data) => {
      // 如果类型是 sqlite，建议提供 sqlite 配置
      if (data.type === "sqlite" && !data.sqlite) {
        // 允许没有配置,使用默认值
        return true;
      }
      // 如果类型是 pgsql，必须提供 pgsql 配置
      if (data.type === "pgsql") {
        if (!data.pgsql) {
          return false;
        }
      }
      return true;
    },
    {
      message: "PostgreSQL 仓储必须提供 pgsql 配置",
    },
  );

/**
 * 认证配置 Schema
 */
export const AuthConfigSchema = z.object({
  autoRedirectSingleProvider: z.boolean().default(false),
  userRepository: UserRepositoryConfigSchema,
  providers: z.record(z.string(), AuthProviderConfigSchema),
  stateStore: z
    .object({
      type: z.enum(["memory", "redis"]),
      redis: z
        .object({
          url: z.string().optional(),
          host: z.string().optional(),
          port: z.number().int().min(1).max(65535).optional(),
          password: z.string().optional(),
          database: z.number().int().min(0).max(15).optional().default(0),
          keyPrefix: z.string().optional().default("gitea-oidc:state:"),
        })
        .optional(),
    })
    .refine((data) => data.type !== "redis" || Boolean(data.redis?.url || data.redis?.host), {
      message: "Redis stateStore 必须提供 redis 配置，且必须包含 url 或 host",
    })
    .optional()
    .default({ type: "memory" }),
});

/**
 * 后台管理配置 Schema
 */
export const AdminConfigSchema = z.object({
  enabled: z.boolean().default(false),
  basePath: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/, "后台路径必须以 / 开头"),
  allowedGroups: z.array(z.string().min(1)).default(["gitea-oidc-admins"]),
  sessionTtlSeconds: z.number().int().positive().default(3600),
});

/**
 * 内置用户门户配置 Schema。
 */
export const PortalConfigSchema = z.object({
  enabled: z.boolean().default(false),
  basePath: z
    .string()
    .max(128, "门户路径长度不能超过 128 个字符")
    .regex(/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/, "门户路径必须是非根绝对路径")
    .default("/portal"),
  clientId: z.string().trim().max(255).default(""),
  sessionTtlSeconds: z.number().int().positive().max(2_592_000).default(3600),
});

/**
 * Provider API 单 Provider 配置 Schema
 */
export const ProviderApiProviderConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.url({ message: "Provider API baseUrl 必须是有效的 URL" }).optional(),
  allowedOperations: z.array(z.string()).optional().default([]),
  defaultAppOwnerId: z.string().optional().default("default"),
  config: z.record(z.string(), z.any()).optional(),
});

/**
 * Provider API 配置 Schema
 */
export const ProviderApiConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    tokenEncryptionKey: z.string().optional().default(""),
    refreshSkewSeconds: z.number().int().nonnegative().default(300),
    probeIntervalSeconds: z.number().int().positive().default(300),
    requestTimeoutMs: z.number().int().min(1000).max(60000).default(10000),
    responseBodyLimitBytes: z.number().int().min(1024).max(10485760).default(1048576),
    sdkProxy: z.boolean().default(true),
    allowedClientIds: z.array(z.string().min(1)).default([]),
    providers: z.record(z.string(), ProviderApiProviderConfigSchema).default({}),
  })
  .superRefine((data, ctx) => {
    if (!data.enabled) {
      return;
    }

    const defaultKeys = new Set([
      "change-this-provider-token-key",
      "replace-with-a-long-random-secret",
      "replace-with-a-long-random-provider-token-key",
    ]);

    if (data.tokenEncryptionKey.length < 32 || defaultKeys.has(data.tokenEncryptionKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["tokenEncryptionKey"],
        message: "启用 Provider API 时必须配置至少 32 字符的非默认 providerApi.tokenEncryptionKey",
      });
    }
  });

/**
 * 应用控制面配置。主密钥只允许在启用时校验，避免兼容模式被迫配置无用密钥。
 */
export const ApplicationsConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    clientSource: z.enum(["config", "database"]).default("config"),
    repository: z
      .object({
        type: z.enum(["memory", "sqlite"]).default("sqlite"),
        sqlite: z
          .object({
            dbPath: z.string().min(1).optional().default("./applications.db"),
          })
          .optional(),
      })
      .default({ type: "sqlite", sqlite: { dbPath: "./applications.db" } }),
    secretEncryption: z
      .object({
        keyId: z
          .string()
          .regex(/^[A-Za-z0-9._-]{1,128}$/)
          .default("applications-v1"),
        masterKey: z.string().default(""),
      })
      .default({ keyId: "applications-v1", masterKey: "" }),
  })
  .superRefine((data, context) => {
    if (!data.enabled) {
      return;
    }

    const value = data.secretEncryption.masterKey.trim();
    const isBase64 = /^[A-Za-z0-9+/_-]+={0,2}$/.test(value);
    let decodedKey: Buffer | undefined;
    if (isBase64) {
      try {
        decodedKey = Buffer.from(
          value,
          value.includes("-") || value.includes("_") ? "base64url" : "base64",
        );
      } catch {
        decodedKey = undefined;
      }
    }
    if (!isBase64 || decodedKey?.byteLength !== 32) {
      context.addIssue({
        code: "custom",
        path: ["secretEncryption", "masterKey"],
        message: "启用应用管理时必须配置 Base64/Base64URL 编码的 32 字节独立主密钥",
      });
    } else if (new Set(decodedKey.values()).size < 8) {
      context.addIssue({
        code: "custom",
        path: ["secretEncryption", "masterKey"],
        message: "应用密钥主密钥随机性不足，请使用安全随机源重新生成",
      });
    }
  });

/**
 * SQLite 适配器配置 Schema
 */
export const SqliteAdapterConfigSchema = z.object({
  dbPath: z.string().optional().default("./oidc.db"),
});

/**
 * Redis 适配器配置 Schema
 */
export const RedisAdapterConfigSchema = z.object({
  url: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  password: z.string().optional(),
  database: z.number().int().min(0).max(15).optional().default(0),
  keyPrefix: z.string().optional().default("oidc:"),
});

/**
 * OIDC 适配器配置 Schema
 */
export const OidcAdapterConfigSchema = z
  .object({
    type: z.enum(["sqlite", "redis", "memory"], {
      message: "适配器类型必须是 sqlite、redis 或 memory",
    }),
    sqlite: SqliteAdapterConfigSchema.optional(),
    redis: RedisAdapterConfigSchema.optional(),
  })
  .refine(
    (data) => {
      // 如果类型是 redis，必须提供 redis 配置
      if (data.type === "redis") {
        if (!data.redis) {
          return false;
        }
        // 必须提供 url 或 host
        if (!data.redis.url && !data.redis.host) {
          return false;
        }
      }
      return true;
    },
    {
      message: "Redis 适配器必须提供 redis 配置，且必须包含 url 或 host",
    },
  );

/**
 * JWKS 配置 Schema
 */
export const JwksConfigSchema = z.object({
  filePath: z.string().optional().default("./jwks.json"),
  keyId: z.string().optional().default("default-key"),
});

/**
 * 完整配置 Schema
 */
export const GiteaOidcConfigSchema = z
  .object({
    server: ServerConfigSchema,
    logging: LoggingConfigSchema,
    audit: AuditConfigSchema.default({ enabled: true, retentionDays: 30 }),
    oidc: OidcConfigSchema,
    clients: z.array(ClientConfigSchema).min(1, "至少需要配置一个客户端"),
    auth: AuthConfigSchema,
    admin: AdminConfigSchema.default({
      enabled: false,
      basePath: "/admin",
      allowedGroups: ["gitea-oidc-admins"],
      sessionTtlSeconds: 3600,
    }),
    portal: PortalConfigSchema.default({
      enabled: false,
      basePath: "/portal",
      clientId: "",
      sessionTtlSeconds: 3600,
    }),
    providerApi: ProviderApiConfigSchema.default({
      enabled: false,
      tokenEncryptionKey: "",
      refreshSkewSeconds: 300,
      probeIntervalSeconds: 300,
      requestTimeoutMs: 10000,
      responseBodyLimitBytes: 1048576,
      sdkProxy: true,
      allowedClientIds: [],
      providers: {},
    }),
    applications: ApplicationsConfigSchema.default({
      enabled: false,
      clientSource: "config",
      repository: { type: "sqlite", sqlite: { dbPath: "./applications.db" } },
      secretEncryption: { keyId: "applications-v1", masterKey: "" },
    }),
    adapter: OidcAdapterConfigSchema.optional().default({
      type: "sqlite",
      sqlite: {
        dbPath: "./oidc.db",
      },
    }),
    jwks: JwksConfigSchema.optional().default({
      filePath: "./jwks.json",
      keyId: "default-key",
    }),
  })
  .superRefine((data, context) => {
    if (data.portal.enabled) {
      const reservedBasePaths = ["/oidc", "/auth", "/interaction", "/api"];
      if (
        reservedBasePaths.some(
          (path) => data.portal.basePath === path || data.portal.basePath.startsWith(`${path}/`),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["portal", "basePath"],
          message: "门户路径不能占用 OIDC、认证、交互或 API 路径",
        });
      }
      if (
        data.admin.enabled &&
        (data.portal.basePath === data.admin.basePath ||
          data.portal.basePath.startsWith(`${data.admin.basePath}/`) ||
          data.admin.basePath.startsWith(`${data.portal.basePath}/`))
      ) {
        context.addIssue({
          code: "custom",
          path: ["portal", "basePath"],
          message: "门户路径不能与后台路径重叠",
        });
      }
      if (!data.portal.clientId) {
        context.addIssue({
          code: "custom",
          path: ["portal", "clientId"],
          message: "启用门户时必须配置 portal.clientId",
        });
      }
    }

    const databaseMode = data.applications.clientSource === "database";
    if (data.applications.enabled !== databaseMode) {
      context.addIssue({
        code: "custom",
        path: ["applications", "clientSource"],
        message: "applications.enabled 与 clientSource=database 必须同时启用或同时关闭",
      });
    }
    if (databaseMode && data.adapter.type !== "sqlite") {
      context.addIssue({
        code: "custom",
        path: ["adapter", "type"],
        message: "database Client 模式当前仅支持单实例 SQLite OIDC adapter",
      });
    }
    if (databaseMode && data.applications.repository.type !== "sqlite") {
      context.addIssue({
        code: "custom",
        path: ["applications", "repository", "type"],
        message: "database Client 模式必须使用持久化 SQLite ApplicationRepository",
      });
    }
    if (databaseMode && data.oidc.features.registration.enabled) {
      context.addIssue({
        code: "custom",
        path: ["oidc", "features", "registration", "enabled"],
        message: "database Client 模式禁止绕过 ApplicationService 的动态注册端点",
      });
    }
    if (databaseMode) {
      const clientIds = new Set<string>();
      data.clients.forEach((client, index) => {
        if (clientIds.has(client.client_id)) {
          context.addIssue({
            code: "custom",
            path: ["clients", index, "client_id"],
            message: "database Client 模式不允许重复的 client_id",
          });
        }
        clientIds.add(client.client_id);

        if (client.token_endpoint_auth_method !== "client_secret_basic") {
          context.addIssue({
            code: "custom",
            path: ["clients", index, "token_endpoint_auth_method"],
            message: "database Client 模式当前只支持 client_secret_basic 系统 Client",
          });
        }
        if (client.response_types.length !== 1 || client.response_types[0] !== "code") {
          context.addIssue({
            code: "custom",
            path: ["clients", index, "response_types"],
            message: "database Client 模式当前只支持 response_types=[code]",
          });
        }
        if (
          !client.grant_types.includes("authorization_code") ||
          client.grant_types.some(
            (grantType) => grantType !== "authorization_code" && grantType !== "refresh_token",
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["clients", index, "grant_types"],
            message: "database Client 模式只支持 authorization_code 和可选 refresh_token",
          });
        }
      });
    }
  });

/**
 * 验证后的配置类型
 */
export type ValidatedGiteaOidcConfig = z.infer<typeof GiteaOidcConfigSchema>;
