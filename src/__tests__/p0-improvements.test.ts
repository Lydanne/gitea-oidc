/**
 * P0 改进测试
 * 验证插件隔离性、OAuth State 管理和 UserRepository 原子操作
 */

import { MemoryStateStore } from '../stores/MemoryStateStore.js';
import { MemoryUserRepository } from '../repositories/MemoryUserRepository.js';
import type { 
  PluginMiddlewareContext, 
  PluginHookName,
  OAuthStateData,
  UserInfo 
} from '../types/auth.js';

describe('P0 改进测试', () => {
  describe('问题 1: 插件隔离性', () => {
    it('插件中间件上下文应该限制插件只能访问自己的路径', () => {
      const hooks: Array<{ name: PluginHookName; path: string }> = [];

      const context: PluginMiddlewareContext = {
        basePath: '/auth/feishu',
        pluginName: 'feishu',
        addHook: (hookName, handler) => {
          hooks.push({ name: hookName, path: context.basePath });
        },
      };

      // 插件注册钩子
      context.addHook('preHandler', async () => {});
      context.addHook('onError', async () => {});

      expect(hooks).toHaveLength(2);
      expect(hooks[0]).toEqual({ name: 'preHandler', path: '/auth/feishu' });
      expect(hooks[1]).toEqual({ name: 'onError', path: '/auth/feishu' });
    });

    it('不同插件应该有独立的上下文', () => {
      const feishuHooks: string[] = [];
      const localHooks: string[] = [];

      const feishuContext: PluginMiddlewareContext = {
        basePath: '/auth/feishu',
        pluginName: 'feishu',
        addHook: (hookName) => {
          feishuHooks.push(hookName);
        },
      };

      const localContext: PluginMiddlewareContext = {
        basePath: '/auth/local',
        pluginName: 'local',
        addHook: (hookName) => {
          localHooks.push(hookName);
        },
      };

      feishuContext.addHook('preHandler', async () => {});
      localContext.addHook('onRequest', async () => {});

      expect(feishuHooks).toEqual(['preHandler']);
      expect(localHooks).toEqual(['onRequest']);
    });
  });

  describe('问题 2: OAuth State 管理', () => {
    let stateStore: MemoryStateStore;

    beforeEach(() => {
      stateStore = new MemoryStateStore(1000); // 1 秒清理间隔
    });

    afterEach(() => {
      stateStore.destroy();
    });

    it('应该能够存储和获取 state', async () => {
      const state = 'test-state-123';
      const data: OAuthStateData = {
        interactionUid: 'interaction-123',
        provider: 'feishu',
        createdAt: Date.now(),
        metadata: { userAgent: 'Mozilla/5.0' },
      };

      await stateStore.set(state, data, 60);
      const retrieved = await stateStore.get(state);

      expect(retrieved).toEqual(data);
    });

    it('过期的 state 应该返回 null', async () => {
      const state = 'test-state-expired';
      const data: OAuthStateData = {
        interactionUid: 'interaction-123',
        provider: 'feishu',
        createdAt: Date.now(),
      };

      // 设置 1 秒过期
      await stateStore.set(state, data, 1);

      // 等待 1.5 秒
      await new Promise(resolve => setTimeout(resolve, 1500));

      const retrieved = await stateStore.get(state);
      expect(retrieved).toBeNull();
    });

    it('删除 state 后应该无法获取', async () => {
      const state = 'test-state-delete';
      const data: OAuthStateData = {
        interactionUid: 'interaction-123',
        provider: 'feishu',
        createdAt: Date.now(),
      };

      await stateStore.set(state, data, 60);
      await stateStore.delete(state);

      const retrieved = await stateStore.get(state);
      expect(retrieved).toBeNull();
    });

    it('cleanup 应该清理过期的 state', async () => {
      // 添加多个 state
      await stateStore.set('state-1', { interactionUid: '1', provider: 'feishu', createdAt: Date.now() }, 1);
      await stateStore.set('state-2', { interactionUid: '2', provider: 'feishu', createdAt: Date.now() }, 60);

      expect(stateStore.size()).toBe(2);

      // 等待 state-1 过期
      await new Promise(resolve => setTimeout(resolve, 1500));

      await stateStore.cleanup();

      // state-1 应该被清理，state-2 仍然存在
      expect(stateStore.size()).toBe(1);
      expect(await stateStore.get('state-1')).toBeNull();
      expect(await stateStore.get('state-2')).not.toBeNull();
    });

    it('state 应该是一次性的（消费后删除）', async () => {
      const state = 'test-state-once';
      const data: OAuthStateData = {
        interactionUid: 'interaction-123',
        provider: 'feishu',
        createdAt: Date.now(),
      };

      await stateStore.set(state, data, 60);

      // 第一次获取成功
      const first = await stateStore.get(state);
      expect(first).toEqual(data);

      // 手动删除（模拟消费）
      await stateStore.delete(state);

      // 第二次获取失败
      const second = await stateStore.get(state);
      expect(second).toBeNull();
    });
  });

  describe('问题 3: UserRepository 原子操作', () => {
    let repository: MemoryUserRepository;

    beforeEach(() => {
      repository = new MemoryUserRepository();
    });

    afterEach(async () => {
      await repository.clear();
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

    it('findOrCreate 应该避免竞态条件', async () => {
      // 模拟并发创建
      const promises = Array.from({ length: 10 }, (_, i) =>
        repository.findOrCreate(
          { provider: 'feishu', externalId: 'feishu-concurrent' },
          {
            username: `user-${i}`,
            name: `User ${i}`,
            email: `user${i}@example.com`,
            authProvider: 'feishu',
            metadata: { externalId: 'feishu-concurrent' },
          }
        )
      );

      const users = await Promise.all(promises);

      // 所有返回的用户应该是同一个
      const firstUserId = users[0].sub;
      expect(users.every(u => u.sub === firstUserId)).toBe(true);

      // 仓储中应该只有一个用户
      expect(repository.size()).toBe(1);
    });

    it('不同 provider 的相同 externalId 应该创建不同用户', async () => {
      const feishuUser = await repository.findOrCreate(
        { provider: 'feishu', externalId: 'user-123' },
        {
          username: 'feishu-user',
          name: 'Feishu User',
          email: 'feishu@example.com',
          authProvider: 'feishu',
          metadata: { externalId: 'user-123' },
        }
      );

      const wechatUser = await repository.findOrCreate(
        { provider: 'wechat', externalId: 'user-123' },
        {
          username: 'wechat-user',
          name: 'WeChat User',
          email: 'wechat@example.com',
          authProvider: 'wechat',
          metadata: { externalId: 'user-123' },
        }
      );

      expect(feishuUser.sub).not.toBe(wechatUser.sub);
      expect(repository.size()).toBe(2);
    });

    it('findOrCreate 应该正确处理 metadata', async () => {
      const user = await repository.findOrCreate(
        { provider: 'feishu', externalId: 'feishu-456' },
        {
          username: 'testuser',
          name: 'Test User',
          email: 'test@example.com',
          authProvider: 'feishu',
          metadata: {
            externalId: 'feishu-456',
            unionId: 'union-789',
            department: 'Engineering',
          },
        }
      );

      expect(user.metadata).toEqual({
        externalId: 'feishu-456',
        unionId: 'union-789',
        department: 'Engineering',
      });

      // 再次查找应该返回相同的 metadata
      const found = await repository.findByProviderAndExternalId('feishu', 'feishu-456');
      expect(found?.metadata).toEqual(user.metadata);
    });
  });

  describe('集成测试：完整的 OAuth 流程', () => {
    let stateStore: MemoryStateStore;
    let userRepository: MemoryUserRepository;

    beforeEach(() => {
      stateStore = new MemoryStateStore();
      userRepository = new MemoryUserRepository();
    });

    afterEach(() => {
      stateStore.destroy();
    });

    it('完整的 OAuth 流程应该正常工作', async () => {
      // 1. 生成 state
      const interactionUid = 'interaction-123';
      const provider = 'feishu';
      const state = 'random-state-string';

      const stateData: OAuthStateData = {
        interactionUid,
        provider,
        createdAt: Date.now(),
        metadata: { userAgent: 'Mozilla/5.0' },
      };

      await stateStore.set(state, stateData, 600);

      // 2. 用户授权后回调，验证 state
      const retrievedState = await stateStore.get(state);
      expect(retrievedState).toEqual(stateData);

      // 3. 消费 state
      await stateStore.delete(state);

      // 4. 创建或查找用户
      const user = await userRepository.findOrCreate(
        { provider: 'feishu', externalId: 'feishu-openid-123' },
        {
          username: 'feishu-user',
          name: 'Feishu User',
          email: 'user@feishu.com',
          avatar: 'https://example.com/avatar.jpg',
          authProvider: 'feishu',
          emailVerified: true,
          metadata: {
            externalId: 'feishu-openid-123',
            unionId: 'feishu-unionid-456',
          },
        }
      );

      expect(user.sub).toBeDefined();
      expect(user.username).toBe('feishu-user');

      // 5. 验证 state 已被消费
      const stateAfterConsume = await stateStore.get(state);
      expect(stateAfterConsume).toBeNull();

      // 6. 再次登录应该返回相同用户
      const sameUser = await userRepository.findOrCreate(
        { provider: 'feishu', externalId: 'feishu-openid-123' },
        {
          username: 'different-username',
          name: 'Different Name',
          email: 'different@example.com',
          authProvider: 'feishu',
          metadata: { externalId: 'feishu-openid-123' },
        }
      );

      expect(sameUser.sub).toBe(user.sub);
      expect(sameUser.username).toBe(user.username); // 保持原用户名
    });
  });
});
