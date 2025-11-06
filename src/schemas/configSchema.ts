/**
 * 配置验证 Schema
 * 使用 Zod 进行配置验证
 */

import { z } from 'zod';

/**
 * 服务器配置 Schema
 */
export const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(3000),
  url: z.url({ message: '服务器 URL 必须是有效的 URL' }),
});

/**
 * 日志配置 Schema
 */
export const LoggingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
  issuer: z.url({ message: 'OIDC issuer 必须是有效的 URL' }),
  cookieKeys: z
    .array(z.string().min(32, 'Cookie 密钥长度至少 32 个字符'))
    .min(1, '至少需要一个 Cookie 密钥'),
  ttl: OidcTTLSchema,
  claims: z.record(z.string(), z.array(z.string())),
  features: OidcFeaturesSchema,
});

/**
 * 客户端配置 Schema
 */
export const ClientConfigSchema = z.object({
  client_id: z.string().min(1, '客户端 ID 不能为空'),
  client_secret: z.string().min(8, '客户端密钥长度至少 8 个字符'),
  redirect_uris: z
    .array(z.url({ message: '重定向 URI 必须是有效的 URL' }))
    .min(1, '至少需要一个重定向 URI'),
  response_types: z.array(z.string()).min(1),
  grant_types: z.array(z.string()).min(1),
  token_endpoint_auth_method: z.string(),
});

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
 * 用户仓储配置 Schema
 */
export const UserRepositoryConfigSchema = z.object({
  type: z.enum(['memory', 'database', 'config'], {
    message: '用户仓储类型必须是 memory、database 或 config',
  }),
  config: z.record(z.string(), z.any()),
});

/**
 * 认证配置 Schema
 */
export const AuthConfigSchema = z.object({
  userRepository: UserRepositoryConfigSchema,
  providers: z.record(z.string(), AuthProviderConfigSchema),
});

/**
 * 完整配置 Schema
 */
export const GiteaOidcConfigSchema = z.object({
  server: ServerConfigSchema,
  logging: LoggingConfigSchema,
  oidc: OidcConfigSchema,
  clients: z.array(ClientConfigSchema).min(1, '至少需要配置一个客户端'),
  auth: AuthConfigSchema,
});

/**
 * 验证后的配置类型
 */
export type ValidatedGiteaOidcConfig = z.infer<typeof GiteaOidcConfigSchema>;
