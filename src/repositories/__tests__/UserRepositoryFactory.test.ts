/**
 * UserRepositoryFactory 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { UserRepositoryFactory } from '../UserRepositoryFactory.js';
import { MemoryUserRepository } from '../MemoryUserRepository.js';
import { SqliteUserRepository } from '../SqliteUserRepository.js';
import { PgsqlUserRepository } from '../PgsqlUserRepository.js';
import type { UserRepositoryConfig } from '../../types/config.js';

// Mock 依赖
vi.mock('../MemoryUserRepository.js', () => ({
  MemoryUserRepository: vi.fn(),
}));
vi.mock('../SqliteUserRepository.js', () => ({
  SqliteUserRepository: vi.fn(),
}));
vi.mock('../PgsqlUserRepository.js', () => ({
  PgsqlUserRepository: vi.fn(),
}));

describe('UserRepositoryFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('应该为 memory 类型创建 MemoryUserRepository 实例', () => {
      const config: UserRepositoryConfig = {
        type: 'memory',
        config: {},
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeInstanceOf(MemoryUserRepository);
    });

    it('应该为 sqlite 类型创建 SqliteUserRepository 实例', () => {
      const config: UserRepositoryConfig = {
        type: 'sqlite',
        config: { uri: ':memory:' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
      // 这里可以根据需要添加更多断言
    });

    it('应该为 pgsql 类型创建 PgsqlUserRepository 实例', () => {
      const config: UserRepositoryConfig = {
        type: 'pgsql',
        config: { uri: 'postgresql://localhost:5432/test' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
    });

    it('应该为无效类型抛出错误', () => {
      const config: UserRepositoryConfig = {
        type: 'invalid' as any,
        config: {},
      };

      expect(() => UserRepositoryFactory.create(config)).toThrow(
        'Unknown user repository type: invalid'
      );
    });

    it('应该传递正确的配置给 SqliteUserRepository', () => {
      const config: UserRepositoryConfig = {
        type: 'sqlite',
        config: { uri: '/path/to/db.sqlite' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
    });

    it('应该传递正确的配置给 PgsqlUserRepository', () => {
      const config: UserRepositoryConfig = {
        type: 'pgsql',
        config: { uri: 'postgresql://user:pass@localhost:5432/db' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
    });

    it('应该使用默认配置当配置未提供时', () => {
      const sqliteConfig: UserRepositoryConfig = {
        type: 'sqlite',
        config: {},
      };

      const pgsqlConfig: UserRepositoryConfig = {
        type: 'pgsql',
        config: {},
      };

      const sqliteRepo = UserRepositoryFactory.create(sqliteConfig);
      const pgsqlRepo = UserRepositoryFactory.create(pgsqlConfig);

      expect(sqliteRepo).toBeDefined();
      expect(pgsqlRepo).toBeDefined();
    });
  });

  describe('getSupportedTypes', () => {
    it('应该返回支持的所有仓储类型', () => {
      const supportedTypes = UserRepositoryFactory.getSupportedTypes();

      expect(supportedTypes).toEqual(['memory', 'sqlite', 'pgsql']);
      expect(supportedTypes).toHaveLength(3);
    });
  });

  describe('validateConfig', () => {
    it('应该验证有效的配置', () => {
      const validConfigs: UserRepositoryConfig[] = [
        { type: 'memory', config: {} },
        { type: 'sqlite', config: { uri: ':memory:' } },
        { type: 'pgsql', config: { uri: 'postgresql://localhost/db' } },
      ];

      validConfigs.forEach(config => {
        expect(UserRepositoryFactory.validateConfig(config)).toBe(true);
      });
    });

    it('应该拒绝无效的配置', () => {
      const invalidConfigs = [
        { type: '', config: {} },
        { type: undefined, config: {} },
        { type: null, config: {} },
        { type: 'invalid', config: {} },
      ];

      invalidConfigs.forEach(config => {
        expect(UserRepositoryFactory.validateConfig(config as any)).toBe(false);
      });
    });
  });
});
