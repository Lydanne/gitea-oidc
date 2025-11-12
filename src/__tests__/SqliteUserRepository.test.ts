/**
 * SQLite UserRepository 测试
 * 验证 SQLite 实现的正确性
 */

import { SqliteUserRepository } from '../repositories/SqliteUserRepository.js';
import type { UserInfo } from '../types/auth.js';

describe('SqliteUserRepository', () => {
  let repository: SqliteUserRepository;

  beforeEach(() => {
    // 使用内存数据库进行测试
    repository = new SqliteUserRepository(':memory:');
  });

  afterEach(async () => {
    await repository.close();
  });

  describe('基本 CRUD 操作', () => {
    it('应该能够创建用户', async () => {
      const userData = {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        authProvider: 'local',
      };

      const user = await repository.create(userData);

      expect(user.sub).toBeDefined();
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('应该能够通过 ID 查找用户', async () => {
      const userData = {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        authProvider: 'local',
      };

      const created = await repository.create(userData);
      const found = await repository.findById(created.sub);

      expect(found).toEqual(created);
    });

    it('应该能够通过用户名查找用户', async () => {
      const userData = {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        authProvider: 'local',
      };

      const created = await repository.create(userData);
      const found = await repository.findByUsername('testuser');

      expect(found).toEqual(created);
    });

    it('应该能够通过邮箱查找用户', async () => {
      const userData = {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        authProvider: 'local',
      };

      const created = await repository.create(userData);
      const found = await repository.findByEmail('test@example.com');

      expect(found).toEqual(created);
    });

    it('应该能够更新用户', async () => {
      const userData = {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        authProvider: 'local',
      };

      const created = await repository.create(userData);
      const updated = await repository.update(created.sub, {
        name: 'Updated Name',
        email: 'updated@example.com',
      });

      expect(updated.sub).toBe(created.sub);
      expect(updated.name).toBe('Updated Name');
      expect(updated.email).toBe('updated@example.com');
      expect(updated.updatedAt!.getTime()).toBeGreaterThan(created.updatedAt!.getTime());
    });

    it('应该能够删除用户', async () => {
      const userData = {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        authProvider: 'local',
      };

      const created = await repository.create(userData);
      await repository.delete(created.sub);

      const found = await repository.findById(created.sub);
      expect(found).toBeNull();
    });
  });

  describe('provider 和 externalId 查询', () => {
    it('应该能够通过 provider 和 externalId 查找用户', async () => {
      const userData = {
        username: 'feishu-user',
        name: 'Feishu User',
        email: 'user@feishu.com',
        authProvider: 'feishu',
        metadata: { externalId: 'feishu-123' },
      };

      const created = await repository.create(userData);
      const found = await repository.findByProviderAndExternalId('feishu', 'feishu-123');

      expect(found).toEqual(created);
    });

    it('findOrCreate 应该在用户不存在时创建', async () => {
      const user = await repository.findOrCreate(
        { provider: 'feishu', externalId: 'feishu-123' },
        {
          username: 'testuser',
          name: 'Test User',
          email: 'test@example.com',
          authProvider: 'feishu',
          metadata: { externalId: 'feishu-123' },
        }
      );

      expect(user.sub).toBeDefined();
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('findOrCreate 应该在用户存在时返回现有用户', async () => {
      // 第一次创建
      const user1 = await repository.findOrCreate(
        { provider: 'feishu', externalId: 'feishu-123' },
        {
          username: 'testuser',
          name: 'Test User',
          email: 'test@example.com',
          authProvider: 'feishu',
          metadata: { externalId: 'feishu-123' },
        }
      );

      // 第二次应该返回相同用户
      const user2 = await repository.findOrCreate(
        { provider: 'feishu', externalId: 'feishu-123' },
        {
          username: 'testuser2', // 不同的数据
          name: 'Test User 2',
          email: 'test2@example.com',
          authProvider: 'feishu',
          metadata: { externalId: 'feishu-123' },
        }
      );

      expect(user2.sub).toBe(user1.sub);
      expect(user2.username).toBe(user1.username); // 应该是原来的数据
      expect(user2.email).toBe(user1.email);
    });
  });

  describe('列表查询', () => {
    beforeEach(async () => {
      // 创建测试数据
      await repository.create({
        username: 'user1',
        name: 'User One',
        email: 'user1@example.com',
        authProvider: 'local',
      });

      await repository.create({
        username: 'user2',
        name: 'User Two',
        email: 'user2@example.com',
        authProvider: 'feishu',
      });

      await repository.create({
        username: 'user3',
        name: 'User Three',
        email: 'user3@example.com',
        authProvider: 'local',
      });
    });

    it('应该能够查询所有用户', async () => {
      const users = await repository.list();
      expect(users.length).toBe(3);
    });

    it('应该能够按条件过滤', async () => {
      const localUsers = await repository.list({
        filter: { authProvider: 'local' },
      });

      expect(localUsers.length).toBe(2);
      expect(localUsers.every(u => u.authProvider === 'local')).toBe(true);
    });

    it('应该能够排序', async () => {
      const users = await repository.list({
        sortBy: 'username',
        sortOrder: 'desc',
      });

      expect(users.length).toBe(3);
      expect(users[0].username).toBe('user3');
      expect(users[1].username).toBe('user2');
      expect(users[2].username).toBe('user1');
    });

    it('应该能够分页', async () => {
      const users = await repository.list({
        offset: 1,
        limit: 2,
      });

      expect(users.length).toBe(2);
    });
  });

  describe('数据持久性', () => {
    it('应该正确处理 JSON 数据', async () => {
      const userData = {
        username: 'json-user',
        name: 'JSON User',
        email: 'json@example.com',
        authProvider: 'feishu',
        groups: ['group1', 'group2'],
        metadata: {
          externalId: 'ext-123',
          unionId: 'union-456',
          nested: { key: 'value' },
        },
      };

      const created = await repository.create(userData);
      const found = await repository.findById(created.sub);

      expect(found?.groups).toEqual(['group1', 'group2']);
      expect(found?.metadata).toEqual(userData.metadata);
    });

    it('应该正确处理布尔值', async () => {
      const userData = {
        username: 'bool-user',
        name: 'Bool User',
        email: 'bool@example.com',
        authProvider: 'local',
        email_verified: true,
        phone_verified: false,
      };

      const created = await repository.create(userData);
      const found = await repository.findById(created.sub);

      expect(found?.email_verified).toBe(true);
      expect(found?.phone_verified).toBe(false);
    });
  });
});
