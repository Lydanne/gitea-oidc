/**
 * 内存用户仓储实现
 * 用于开发和测试环境
 */

import type { UserRepository, UserInfo, ListOptions } from '../types/auth.js';
import { randomUUID } from 'crypto';

export class MemoryUserRepository implements UserRepository {
  private users = new Map<string, UserInfo>();
  private providerIndex = new Map<string, string>(); // `${provider}:${externalId}` -> userId

  async findById(userId: string): Promise<UserInfo | null> {
    return this.users.get(userId) || null;
  }

  async findByUsername(username: string): Promise<UserInfo | null> {
    for (const user of this.users.values()) {
      if (user.username === username) {
        return user;
      }
    }
    return null;
  }

  async findByEmail(email: string): Promise<UserInfo | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async findByProviderAndExternalId(
    provider: string,
    externalId: string
  ): Promise<UserInfo | null> {
    const key = `${provider}:${externalId}`;
    const userId = this.providerIndex.get(key);
    
    if (!userId) {
      return null;
    }

    return this.findById(userId);
  }

  /**
   * 查找或创建用户（原子操作）
   * 避免并发创建时的竞态条件
   */
  async findOrCreate(
    criteria: { provider: string; externalId: string },
    userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'>
  ): Promise<UserInfo> {
    const key = `${criteria.provider}:${criteria.externalId}`;
    
    // 先尝试查找
    const existingUserId = this.providerIndex.get(key);
    if (existingUserId) {
      const existingUser = this.users.get(existingUserId);
      if (existingUser) {
        return existingUser;
      }
    }

    // 不存在则创建
    const now = new Date();
    const user: UserInfo = {
      ...userData,
      sub: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.sub, user);
    this.providerIndex.set(key, user.sub);

    return user;
  }

  async create(userData: Omit<UserInfo, 'sub'>): Promise<UserInfo> {
    const now = new Date();
    const user: UserInfo = {
      ...userData,
      sub: randomUUID(),
      createdAt: userData.createdAt || now,
      updatedAt: userData.updatedAt || now,
    };

    this.users.set(user.sub, user);

    // 更新索引
    if (userData.metadata?.externalId) {
      const key = `${user.authProvider}:${userData.metadata.externalId}`;
      this.providerIndex.set(key, user.sub);
    }

    return user;
  }

  async update(userId: string, updates: Partial<UserInfo>): Promise<UserInfo> {
    const user = this.users.get(userId);
    
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const updatedUser: UserInfo = {
      ...user,
      ...updates,
      sub: user.sub, // 不允许修改 sub
      updatedAt: new Date(),
    };

    this.users.set(userId, updatedUser);

    return updatedUser;
  }

  async delete(userId: string): Promise<void> {
    const user = this.users.get(userId);
    
    if (user) {
      // 清理索引
      if (user.metadata?.externalId) {
        const key = `${user.authProvider}:${user.metadata.externalId}`;
        this.providerIndex.delete(key);
      }
      
      this.users.delete(userId);
    }
  }

  async list(options?: ListOptions): Promise<UserInfo[]> {
    let users = Array.from(this.users.values());

    // 过滤
    if (options?.filter) {
      users = users.filter(user => {
        for (const [key, value] of Object.entries(options.filter!)) {
          if ((user as any)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // 排序
    if (options?.sortBy) {
      const sortBy = options.sortBy;
      const sortOrder = options.sortOrder || 'asc';
      
      users.sort((a, b) => {
        const aVal = (a as any)[sortBy];
        const bVal = (b as any)[sortBy];
        
        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // 分页
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit || users.length;
      users = users.slice(offset, offset + limit);
    }

    return users;
  }

  async clear(): Promise<void> {
    this.users.clear();
    this.providerIndex.clear();
  }

  /**
   * 获取用户数量（用于调试）
   */
  size(): number {
    return this.users.size;
  }
}
