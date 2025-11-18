/**
 * OIDC 适配器工厂
 * 
 * 根据配置创建不同类型的 OIDC 持久化适配器
 */

import { Adapter } from 'oidc-provider';
import { SqliteOidcAdapter } from './SqliteOidcAdapter';
import { RedisOidcAdapter, RedisOidcAdapterOptions } from './RedisOidcAdapter';

/**
 * 适配器类型
 */
export type AdapterType = 'sqlite' | 'redis' | 'memory';

/**
 * 适配器配置接口
 */
export interface OidcAdapterConfig {
  /**
   * 适配器类型
   * - sqlite: SQLite 文件数据库 (适合单实例)
   * - redis: Redis 内存数据库 (适合分布式)
   * - memory: 内存存储 (仅开发环境)
   */
  type: AdapterType;
  
  /**
   * SQLite 配置
   */
  sqlite?: {
    /**
     * 数据库文件路径
     * @default './oidc.db'
     */
    dbPath?: string;
  };
  
  /**
   * Redis 配置
   */
  redis?: RedisOidcAdapterOptions;
}

/**
 * OIDC 适配器工厂类
 */
export class OidcAdapterFactory {
  private static config: OidcAdapterConfig;
  
  /**
   * 配置适配器工厂
   * 
   * @param config 适配器配置
   */
  static configure(config: OidcAdapterConfig): void {
    this.config = config;
    console.log(`[OidcAdapterFactory] 配置适配器类型: ${config.type}`);
  }
  
  /**
   * 创建适配器实例
   * 
   * @param name OIDC 模型名称 (如 Session, AccessToken 等)
   * @returns 适配器实例
   */
  static create(name: string): Adapter {
    if (!this.config) {
      throw new Error('OidcAdapterFactory not configured. Call configure() first.');
    }
    
    switch (this.config.type) {
      case 'sqlite':
        return new SqliteOidcAdapter(name);
      
      case 'redis':
        if (!this.config.redis) {
          throw new Error('Redis configuration is required when type is "redis"');
        }
        return new RedisOidcAdapter(name, this.config.redis);
      
      case 'memory':
        console.warn('[OidcAdapterFactory] Using memory adapter - data will be lost on restart!');
        // 返回 undefined 让 oidc-provider 使用默认的内存适配器
        return undefined as any;
      
      default:
        throw new Error(`Unknown adapter type: ${(this.config as any).type}`);
    }
  }
  
  /**
   * 获取适配器工厂函数
   * 
   * 用于 OIDC Provider 配置
   * 
   * @returns 适配器工厂函数
   */
  static getAdapterFactory(): (name: string) => Adapter {
    return (name: string) => this.create(name);
  }
  
  /**
   * 清理资源
   * 
   * 关闭数据库连接等
   */
  static async cleanup(): Promise<void> {
    if (!this.config) {
      return;
    }
    
    console.log('[OidcAdapterFactory] 清理适配器资源...');
    
    switch (this.config.type) {
      case 'redis':
        await RedisOidcAdapter.disconnect();
        break;
      
      case 'sqlite':
        // SQLite 适配器暂时没有需要清理的资源
        break;
      
      case 'memory':
        // 内存适配器无需清理
        break;
    }
    
    console.log('[OidcAdapterFactory] 资源清理完成');
  }
  
  /**
   * 获取当前配置
   */
  static getConfig(): OidcAdapterConfig | undefined {
    return this.config;
  }
  
  /**
   * 验证配置
   * 
   * @param config 配置对象
   * @returns 验证结果
   */
  static validateConfig(config: OidcAdapterConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!config.type) {
      errors.push('适配器类型 (type) 是必需的');
    }
    
    if (!['sqlite', 'redis', 'memory'].includes(config.type)) {
      errors.push(`无效的适配器类型: ${config.type}`);
    }
    
    if (config.type === 'redis') {
      if (!config.redis) {
        errors.push('Redis 配置 (redis) 是必需的');
      } else {
        if (!config.redis.url && !config.redis.host) {
          errors.push('Redis URL 或 host 是必需的');
        }
      }
    }
    
    if (config.type === 'memory') {
      errors.push('⚠️  警告: memory 适配器仅适用于开发环境,生产环境请使用 sqlite 或 redis');
    }
    
    return {
      valid: errors.filter(e => !e.startsWith('⚠️')).length === 0,
      errors,
    };
  }
}

/**
 * 默认配置
 */
export const defaultAdapterConfig: OidcAdapterConfig = {
  type: 'sqlite',
  sqlite: {
    dbPath: './oidc.db',
  },
};
