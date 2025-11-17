/**
 * MemoryUserRepository 单元测试
 */

import { MemoryUserRepository } from '../MemoryUserRepository';
import type { UserInfo, ListOptions } from '../../types/auth';

describe('MemoryUserRepository', () => {
  let repository: MemoryUserRepository;

  beforeEach(() => {
    repository = new MemoryUserRepository();
  });

  afterEach(async () => {
    await repository.clear();
  });

  const mockUserData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'> = {
    username: 'testuser',
    name: 'Test User',
    email: 'test@example.com',
    picture: 'https://example.com/avatar.jpg',
    phone: '+1234567890',
    authProvider: 'local',
    emailVerified: true,
    phoneVerified: false,
    groups: ['users', 'admins'],
    externalId: 'ext123',
    metadata: { role: 'user' },
  };

  const stripUserData = (
    user: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'>
  ): Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt' | 'externalId' | 'authProvider'> => {
    const { authProvider: _provider, externalId: _externalId, ...rest } = user;
    return rest;
  };

  describe('create', () => {
    it('应该成功创建用户', async () => {
      const user = await repository.create(mockUserData);

      expect(user).toMatchObject(mockUserData);
      expect(user.sub).toBeDefined();
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('应该为创建的用户建立提供者索引', async () => {
      const user = await repository.create(mockUserData);
      const found = await repository.findByProviderAndExternalId('local', 'ext123');

      expect(found).toEqual(user);
    });

    it('应该使用提供的创建和更新时间', async () => {
      const customTime = new Date('2023-01-01T00:00:00Z');
      const user = await repository.create({
        ...mockUserData,
        createdAt: customTime,
        updatedAt: customTime,
      });

      expect(user.createdAt).toEqual(customTime);
      expect(user.updatedAt).toEqual(customTime);
    });
  });

  describe('findById', () => {
    it('应该根据 ID 找到用户', async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findById(created.sub);

      expect(found).toEqual(created);
    });

    it('应该为不存在的 ID 返回 null', async () => {
      const found = await repository.findById('nonexistent');

      expect(found).toBeNull();
    });
  });

  describe('findByUsername', () => {
    it('应该根据用户名找到用户', async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findByUsername('testuser');

      expect(found).toEqual(created);
    });

    it('应该为不存在的用户名返回 null', async () => {
      const found = await repository.findByUsername('nonexistent');

      expect(found).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('应该根据邮箱找到用户', async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findByEmail('test@example.com');

      expect(found).toEqual(created);
    });

    it('应该为不存在的邮箱返回 null', async () => {
      const found = await repository.findByEmail('nonexistent@example.com');

      expect(found).toBeNull();
    });
  });

  describe('findByProviderAndExternalId', () => {
    it('应该根据提供者和外部 ID 找到用户', async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findByProviderAndExternalId('local', 'ext123');

      expect(found).toEqual(created);
    });

    it('应该为不存在的提供者外部 ID 返回 null', async () => {
      const found = await repository.findByProviderAndExternalId('unknown', 'ext123');

      expect(found).toBeNull();
    });
  });

  describe('findOrCreate', () => {
    it('应该找到现有用户', async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findOrCreate('local', 'ext123', stripUserData(mockUserData));

      expect(found).toEqual(created);
    });

    it('应该创建新用户当不存在时', async () => {
      const found = await repository.findOrCreate('local', 'newExt123', stripUserData(mockUserData));

      expect(found).toMatchObject({
        ...mockUserData,
        externalId: 'newExt123',
      });
      expect(found.sub).toBeDefined();
      expect(found.createdAt).toBeInstanceOf(Date);
      expect(found.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('应该成功更新用户', async () => {
      const created = await repository.create(mockUserData);
      const updates = {
        name: 'Updated Name',
        emailVerified: false,
        groups: ['users'],
      };

      // 等待一毫秒确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 1));

      const updated = await repository.update(created.sub, updates);

      expect(updated.name).toBe('Updated Name');
      expect(updated.emailVerified).toBe(false);
      expect(updated.groups).toEqual(['users']);
      expect(updated.sub).toBe(created.sub);
      expect(updated.updatedAt).toBeInstanceOf(Date);
      expect(updated.updatedAt!.getTime()).toBeGreaterThan(created.updatedAt!.getTime());
    });

    it('应该为不存在的用户抛出错误', async () => {
      await expect(repository.update('nonexistent', { name: 'test' })).rejects.toThrow(
        'User not found: nonexistent'
      );
    });
  });

  describe('delete', () => {
    it('应该成功删除用户', async () => {
      const created = await repository.create(mockUserData);
      await repository.delete(created.sub);

      const found = await repository.findById(created.sub);
      expect(found).toBeNull();
    });

    it('应该清理提供者索引', async () => {
      const created = await repository.create(mockUserData);
      await repository.delete(created.sub);

      const found = await repository.findByProviderAndExternalId('local', 'ext123');
      expect(found).toBeNull();
    });

    it('应该安静处理不存在的用户', async () => {
      await expect(repository.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // 创建测试用户
      await repository.create({ ...mockUserData, username: 'user1', email: 'user1@example.com' });
      await repository.create({ ...mockUserData, username: 'user2', email: 'user2@example.com', authProvider: 'oauth' });
      await repository.create({ ...mockUserData, username: 'user3', email: 'user3@example.com' });
    });

    it('应该返回所有用户', async () => {
      const users = await repository.list();

      expect(users).toHaveLength(3);
      expect(users.map(u => u.username)).toEqual(['user1', 'user2', 'user3']);
    });

    it('应该支持过滤', async () => {
      const users = await repository.list({ filter: { authProvider: 'local' } });

      expect(users).toHaveLength(2);
      expect(users.every(u => u.authProvider === 'local')).toBe(true);
    });

    it('应该支持排序', async () => {
      const users = await repository.list({ sortBy: 'username', sortOrder: 'desc' });

      expect(users).toHaveLength(3);
      expect(users[0].username).toBe('user3');
      expect(users[1].username).toBe('user2');
      expect(users[2].username).toBe('user1');
    });

    it('应该支持分页', async () => {
      const users = await repository.list({ offset: 1, limit: 2 });

      expect(users).toHaveLength(2);
      expect(users[0].username).toBe('user2');
      expect(users[1].username).toBe('user3');
    });

    it('应该支持组合查询选项', async () => {
      const users = await repository.list({
        filter: { authProvider: 'local' },
        sortBy: 'username',
        sortOrder: 'desc',
        offset: 0,
        limit: 1,
      });

      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('user3');
      expect(users[0].authProvider).toBe('local');
    });
  });

  describe('clear', () => {
    it('应该清空所有用户和索引', async () => {
      await repository.create(mockUserData);
      await repository.create({ ...mockUserData, username: 'user2', email: 'user2@example.com' });

      expect(repository.size()).toBe(2);

      await repository.clear();

      expect(repository.size()).toBe(0);
      expect(await repository.list()).toHaveLength(0);
    });
  });

  describe('size', () => {
    it('应该返回用户数量', async () => {
      expect(repository.size()).toBe(0);

      await repository.create(mockUserData);
      expect(repository.size()).toBe(1);

      await repository.create({ ...mockUserData, username: 'user2', email: 'user2@example.com' });
      expect(repository.size()).toBe(2);
    });
  });
});
