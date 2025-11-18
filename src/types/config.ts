/**
 * 认证系统配置类型扩展
 */

import type { GiteaOidcConfig } from '../config';
import type { AuthProviderConfig } from './auth';
import type { OidcAdapterConfig } from '../adapters/OidcAdapterFactory';

export type RepositoryType = 'memory' | 'sqlite' | 'pgsql';

/**
 * SQLite 仓储配置
 */
export interface SqliteRepositoryConfig {
  /** 数据库文件路径 */
  dbPath?: string;
}

/**
 * PostgreSQL 仓储配置
 */
export interface PgsqlRepositoryConfig {
  /** 数据库连接字符串 */
  connectionString?: string;
  /** 主机地址 */
  host?: string;
  /** 端口 */
  port?: number;
  /** 数据库名 */
  database?: string;
  /** 用户名 */
  user?: string;
  /** 密码 */
  password?: string;
}

/**
 * 用户仓储配置
 */
export interface UserRepositoryConfig {
  /** 仓储类型 */
  type: RepositoryType;
  
  /** SQLite 配置 */
  sqlite?: SqliteRepositoryConfig;
  
  /** PostgreSQL 配置 */
  pgsql?: PgsqlRepositoryConfig;
  
  /** Memory 配置 (无需额外配置) */
  memory?: Record<string, never>;
}

/**
 * 认证系统配置
 */
export interface AuthConfig {
  /** 用户仓储配置 */
  userRepository: UserRepositoryConfig;
  
  /** 认证提供者配置 */
  providers: Record<string, AuthProviderConfig>;
}

/**
 * 扩展的 Gitea OIDC 配置
 * 包含新的认证系统配置
 * 
 * 注意：现在 GiteaOidcConfig 已经包含 auth 字段，
 * 所以这个接口实际上就是 GiteaOidcConfig 的别名
 */
export type ExtendedGiteaOidcConfig = GiteaOidcConfig;

/**
 * 完整配置示例
 */
export const exampleConfig: ExtendedGiteaOidcConfig = {
  server: {
    host: '0.0.0.0',
    port: 3000,
    url: 'http://localhost:3000',
    trustProxy: false,
  },
  
  logging: {
    enabled: true,
    level: 'info',
  },
  
  oidc: {
    issuer: 'http://localhost:3000',
    cookieKeys: ['secret-key-1', 'secret-key-2'],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
    claims: {
      openid: ['sub'],
      profile: ['name', 'email', 'email_verified'],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
    },
  },
  
  clients: [
    {
      client_id: 'gitea',
      client_secret: 'gitea-secret',
      redirect_uris: ['http://localhost:3001/user/oauth2/gitea/callback'],
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_basic',
    },
  ],
  
  auth: {
    userRepository: {
      type: 'memory',
      memory: {},
    },
    
    providers: {
      local: {
        enabled: true,
        displayName: '本地密码',
        priority: 1,
        config: {
          passwordFile: '.htpasswd',
          passwordFormat: 'bcrypt',
        },
      },
      
      feishu: {
        enabled: true,
        displayName: '飞书登录',
        priority: 2,
        config: {
          appId: 'cli_xxx',
          appSecret: 'xxx',
          redirectUri: 'http://localhost:3000/auth/feishu/callback',
          scope: 'contact:user.base:readonly',
          autoCreateUser: true,
        },
      },
    },
  },
};
