/**
 * 用户仓储工厂
 * 根据配置创建合适的用户仓储实例
 */

import type { UserRepository } from '../types/auth.js';
import type { UserRepositoryConfig } from '../types/config.js';
import { MemoryUserRepository } from './MemoryUserRepository.js';
import { SqliteUserRepository } from './SqliteUserRepository.js';

export class UserRepositoryFactory {
  /**
   * 创建用户仓储实例
   * @param config 用户仓储配置
   * @returns 用户仓储实例
   */
  static create(config: UserRepositoryConfig): UserRepository {
    switch (config.type) {
      case 'memory':
        return new MemoryUserRepository();

      case 'sqlite':
        // 数据库配置，默认为 SQLite
        const dbPath = config.config?.path || ':memory:';
        return new SqliteUserRepository(dbPath);

      default:
        throw new Error(`Unknown user repository type: ${config.type}`);
    }
  }

  /**
   * 获取支持的仓储类型列表
   */
  static getSupportedTypes(): string[] {
    return ['memory', 'sqlite'];
  }

  /**
   * 验证配置
   * @param config 配置对象
   * @returns 是否有效
   */
  static validateConfig(config: UserRepositoryConfig): boolean {
    if (!config.type) {
      return false;
    }

    return this.getSupportedTypes().includes(config.type);
  }
}
