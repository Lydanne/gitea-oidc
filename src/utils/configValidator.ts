/**
 * 配置验证工具
 * 
 * 提供配置验证、警告检查和错误格式化功能
 */

import { ZodError } from 'zod';
import { GiteaOidcConfigSchema } from '../schemas/configSchema';
import type { GiteaOidcConfig } from '../config';

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
  config?: GiteaOidcConfig;
}

/**
 * 验证配置
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result = GiteaOidcConfigSchema.safeParse(config);
  
  if (result.success) {
    const warnings = checkConfigWarnings(result.data);
    return {
      valid: true,
      errors: [],
      warnings,
      config: result.data as GiteaOidcConfig,
    };
  }
  
  const errors: ConfigValidationError[] = (result.error as ZodError).issues.map((err: any) => ({
    path: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
  
  return {
    valid: false,
    errors,
    warnings: [],
  };
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
  const defaultKeys = [
    'change-this-to-a-random-string-in-production',
    'and-another-one-for-key-rotation',
    'your-secret-cookie-key-change-in-production',
    'another-secret-key-for-rotation',
  ];
  
  if (config.oidc?.cookieKeys) {
    config.oidc.cookieKeys.forEach((key: string) => {
      if (defaultKeys.includes(key)) {
        warnings.push(`⚠️  检测到默认 Cookie 密钥，生产环境中必须更换为随机字符串`);
      }
    });
  }
  
  // 检查客户端密钥强度
  if (config.clients) {
    config.clients.forEach((client: any, index: number) => {
      if (client.client_secret && client.client_secret.length < 16) {
        warnings.push(`客户端 #${index + 1} (${client.client_id}) 的密钥长度小于 16 字符，建议使用更长的密钥`);
      }
      
      // 检查是否使用默认密钥
      const defaultSecrets = [
        'secret',
        'gitea-client-secret-change-in-production',
      ];
      
      if (defaultSecrets.includes(client.client_secret)) {
        warnings.push(`⚠️  客户端 "${client.client_id}" 使用默认密钥，生产环境中必须更换`);
      }
    });
  }
  
  // 检查是否启用了任何认证提供者
  if (config.auth?.providers) {
    const enabledProviders = Object.entries(config.auth.providers)
      .filter(([_, p]: [string, any]) => p.enabled);
    
    if (enabledProviders.length === 0) {
      warnings.push('⚠️  没有启用任何认证提供者，用户将无法登录');
    }
  }
  
  // 检查本地认证配置
  if (config.auth?.providers?.local?.enabled) {
    const localConfig = config.auth.providers.local.config;
    if (!localConfig.passwordFile) {
      warnings.push('本地认证已启用但未配置 passwordFile');
    }
  }
  
  // 检查飞书认证配置
  if (config.auth?.providers?.feishu?.enabled) {
    const feishuConfig = config.auth.providers.feishu.config;
    if (!feishuConfig.appId || !feishuConfig.appSecret) {
      warnings.push('飞书认证已启用但未配置 appId 或 appSecret');
    }
  }
  
  // 检查 HTTPS
  if (config.server?.url && !config.server.url.startsWith('https://')) {
    warnings.push('⚠️  服务器 URL 未使用 HTTPS，生产环境中建议使用 HTTPS');
  }
  
  // 检查 redirect_uris 是否使用 HTTPS
  if (config.clients) {
    config.clients.forEach((client: any) => {
      if (client.redirect_uris) {
        client.redirect_uris.forEach((uri: string) => {
          if (!uri.startsWith('https://') && !uri.startsWith('http://localhost')) {
            warnings.push(`客户端 "${client.client_id}" 的重定向 URI "${uri}" 未使用 HTTPS`);
          }
        });
      }
    });
  }
  
  return warnings;
}

/**
 * 格式化验证错误
 */
export function formatValidationErrors(errors: ConfigValidationError[]): string {
  if (errors.length === 0) {
    return '';
  }
  
  return errors
    .map(err => {
      const path = err.path ? `  配置项 "${err.path}": ` : '  ';
      return `${path}${err.message}`;
    })
    .join('\n');
}

/**
 * 格式化警告
 */
export function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) {
    return '';
  }
  
  return warnings
    .map(warning => `  - ${warning}`)
    .join('\n');
}

/**
 * 打印验证结果
 */
export function printValidationResult(result: ConfigValidationResult): void {
  if (!result.valid) {
    console.error('\n❌ 配置验证失败:\n');
    console.error(formatValidationErrors(result.errors));
    console.error('');
  } else {
    console.log('✅ 配置验证通过');
    
    if (result.warnings.length > 0) {
      console.warn('\n⚠️  配置警告:');
      console.warn(formatWarnings(result.warnings));
      console.warn('');
    }
  }
}
