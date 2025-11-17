/**
 * 测试基于 authProvider + externalId 的确定性 ID 生成
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryUserRepository } from '../MemoryUserRepository';
import { SqliteUserRepository } from '../SqliteUserRepository';
import type { UserInfo } from '../../types/auth';

describe('确定性 ID 生成', () => {
  describe('MemoryUserRepository', () => {
    let repository: MemoryUserRepository;

    beforeEach(() => {
      repository = new MemoryUserRepository();
    });

    afterEach(async () => {
      await repository.clear();
    });

    it('相同的 authProvider + externalId 应该生成相同的 sub', async () => {
      const userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'> = {
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
        authProvider: 'feishu',
        externalId: 'feishu-123',
      };

      const user1 = await repository.create(userData);
      
      // 清空并重新创建
      await repository.clear();
      
      const user2 = await repository.create(userData);

      expect(user1.sub).toBe(user2.sub);
    });

    it('不同的 externalId 应该生成不同的 sub', async () => {
      const user1 = await repository.create({
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
        authProvider: 'feishu',
        externalId: 'feishu-123',
      });

      const user2 = await repository.create({
        username: 'user2',
        name: 'User Two',
        email: 'user2@example.com',
        authProvider: 'feishu',
        externalId: 'feishu-456',
      });

      expect(user1.sub).not.toBe(user2.sub);
    });

    it('不同的 authProvider 应该生成不同的 sub', async () => {
      const user1 = await repository.create({
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
        authProvider: 'feishu',
        externalId: 'ext-123',
      });

      const user2 = await repository.create({
        username: 'user2',
        name: 'User Two',
        email: 'user2@example.com',
        authProvider: 'local',
        externalId: 'ext-123',
      });

      expect(user1.sub).not.toBe(user2.sub);
    });

    it('没有 externalId 时应该使用随机 UUID', async () => {
      const user1 = await repository.create({
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
        authProvider: 'local',
        externalId: undefined as any,
      });

      const user2 = await repository.create({
        username: 'user2',
        name: 'User Two',
        email: 'user2@example.com',
        authProvider: 'local',
        externalId: undefined as any,
      });

      // 没有 externalId，应该生成不同的随机 UUID
      expect(user1.sub).not.toBe(user2.sub);
      // UUID 格式验证
      expect(user1.sub).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(user2.sub).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('SqliteUserRepository', () => {
    let repository: SqliteUserRepository;

    beforeEach(() => {
      repository = new SqliteUserRepository(':memory:');
    });

    afterEach(async () => {
      await repository.close();
    });

    it('相同的 authProvider + externalId 应该生成相同的 sub', async () => {
      const userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'> = {
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
        authProvider: 'feishu',
        externalId: 'feishu-123',
      };

      const user1 = await repository.create(userData);
      
      // 清空并重新创建
      await repository.clear();
      
      const user2 = await repository.create(userData);

      expect(user1.sub).toBe(user2.sub);
    });

    it('findOrCreate 应该使用确定性 ID', async () => {
      const user1 = await repository.findOrCreate('feishu', 'feishu-789', {
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
      });

      // 第二次调用应该返回相同的用户
      const user2 = await repository.findOrCreate('feishu', 'feishu-789', {
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
      });

      expect(user1.sub).toBe(user2.sub);
      expect(await repository.size()).toBe(1);
    });
  });
});
