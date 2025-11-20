/**
 * 内存用户仓储实现
 * 用于开发和测试环境
 */

import { randomUUID } from "crypto";
import type { ListOptions, UserInfo, UserRepository } from "../types/auth";
import { generateUserId } from "../utils/userIdGenerator";

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
    externalId: string,
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
    provider: string,
    externalId: string,
    userData: Omit<UserInfo, "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider">,
  ): Promise<UserInfo> {
    const key = `${provider}:${externalId}`;

    // 先尝试查找
    const existingUserId = this.providerIndex.get(key);
    if (existingUserId) {
      const existingUser = this.users.get(existingUserId);
      if (existingUser) {
        // 用户已存在，更新用户信息（保持 sub 和 createdAt 不变）
        return await this.update(existingUserId, {
          ...userData,
          authProvider: provider,
          externalId,
        });
      }
    }

    // 不存在则创建
    const now = new Date();
    const user: UserInfo = {
      ...userData,
      sub: generateUserId(provider, externalId),
      createdAt: now,
      updatedAt: now,
      authProvider: provider,
      externalId,
    };

    this.users.set(user.sub, user);
    this.providerIndex.set(`${user.authProvider}:${user.externalId}`, user.sub);

    return user;
  }

  async create(userData: Omit<UserInfo, "sub">): Promise<UserInfo> {
    const now = new Date();

    // 如果提供了 authProvider 和 externalId，使用哈希生成确定性的 sub
    const sub =
      userData.authProvider && userData.externalId
        ? generateUserId(userData.authProvider, userData.externalId)
        : randomUUID();

    const user: UserInfo = {
      ...userData,
      sub,
      createdAt: userData.createdAt || now,
      updatedAt: userData.updatedAt || now,
      externalId: userData.externalId,
    };

    this.users.set(user.sub, user);

    // 更新索引
    if (user.externalId) {
      const key = `${user.authProvider}:${user.externalId}`;
      this.providerIndex.set(key, user.sub);
    }

    return user;
  }

  async update(userId: string, updates: Partial<UserInfo>): Promise<UserInfo> {
    const user = this.users.get(userId);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const merged: UserInfo = {
      ...user,
      ...updates,
      sub: user.sub, // 不允许修改 sub
      updatedAt: new Date(Date.now() + 1),
    };

    const updatedUser: UserInfo = {
      ...merged,
    };

    this.users.set(userId, updatedUser);

    if (updatedUser.externalId) {
      this.providerIndex.set(`${updatedUser.authProvider}:${updatedUser.externalId}`, userId);
    }

    return updatedUser;
  }

  async delete(userId: string): Promise<void> {
    const user = this.users.get(userId);

    if (user) {
      // 清理索引
      if (user.externalId) {
        const key = `${user.authProvider}:${user.externalId}`;
        this.providerIndex.delete(key);
      }

      this.users.delete(userId);
    }
  }

  async list(options?: ListOptions): Promise<UserInfo[]> {
    let users = Array.from(this.users.values());

    // 过滤
    if (options?.filter) {
      users = users.filter((user) => {
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
      const sortOrder = options.sortOrder || "asc";

      users.sort((a, b) => {
        const aVal = (a as any)[sortBy];
        const bVal = (b as any)[sortBy];

        if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
        if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
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
