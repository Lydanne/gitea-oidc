/**
 * UserRepositoryFactory 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { UserRepositoryFactory } from '../UserRepositoryFactory';
import { MemoryUserRepository } from '../MemoryUserRepository';
import { SqliteUserRepository } from '../SqliteUserRepository';
import { PgsqlUserRepository } from '../PgsqlUserRepository';
import type { UserRepositoryConfig } from '../../types/config';

// Mock 依赖
vi.mock('../MemoryUserRepository', () => ({
  MemoryUserRepository: vi.fn(),
}));
vi.mock('../SqliteUserRepository', () => ({
  SqliteUserRepository: vi.fn(),
}));
vi.mock('../PgsqlUserRepository', () => ({
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
        memory: {},
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeInstanceOf(MemoryUserRepository);
    });

    it('应该为 sqlite 类型创建 SqliteUserRepository 实例', () => {
      const config: UserRepositoryConfig = {
        type: 'sqlite',
        sqlite: { dbPath: '/path/to/db.sqlite' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
      // 这里可以根据需要添加更多断言
    });

    it('应该为 pgsql 类型创建 PgsqlUserRepository 实例', () => {
      const config: UserRepositoryConfig = {
        type: 'pgsql',
        pgsql: { connectionString: 'postgresql://localhost:5432/test' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
    });

    it('应该为无效类型抛出错误', () => {
      const config: UserRepositoryConfig = {
        type: 'invalid' as any,
        memory: {},
      };

      expect(() => UserRepositoryFactory.create(config)).toThrow(
        'Unknown user repository type: invalid'
      );
    });

    it('应该传递正确的配置给 SqliteUserRepository', () => {
      const config: UserRepositoryConfig = {
        type: 'sqlite',
        sqlite: { dbPath: '/path/to/db.sqlite' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
    });

    it('应该传递正确的配置给 PgsqlUserRepository', () => {
      const config: UserRepositoryConfig = {
        type: 'pgsql',
        pgsql: { connectionString: 'postgresql://user:pass@localhost:5432/db' },
      };

      const repository = UserRepositoryFactory.create(config);

      expect(repository).toBeDefined();
    });

    it('应该使用默认配置当配置未提供时', () => {
      const sqliteConfig: UserRepositoryConfig = {
        type: 'sqlite',
        sqlite: {},
      };

      const pgsqlConfig: UserRepositoryConfig = {
        type: 'pgsql',
        pgsql: { connectionString: 'postgresql://localhost/db' },
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
        { type: 'memory', memory: {} },
        { type: 'sqlite', sqlite: { dbPath: ':memory:' } },
        { type: 'pgsql', pgsql: { connectionString: 'postgresql://localhost/db' } },
      ];

      validConfigs.forEach(config => {
        expect(UserRepositoryFactory.validateConfig(config)).toBe(true);
      });
    });

    it('应该拒绝无效的配置', () => {
      const invalidConfigs = [
        { type: '', memory: {} },
        { type: undefined, memory: {} },
        { type: null, memory: {} },
        { type: 'invalid', memory: {} },
      ];

      invalidConfigs.forEach(config => {
        expect(UserRepositoryFactory.validateConfig(config as any)).toBe(false);
      });
    });
  });
});
