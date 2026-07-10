/**
 * 内存用户仓储实现
 * 用于开发和测试环境
 */

import { randomUUID } from "crypto";
import type { ListOptions, UserInfo, UserRepository } from "../types/auth";
import { withUserDefaults } from "../utils/userDefaults";
import { generateUserId } from "../utils/userIdGenerator";
import { normalizeUserListOptions } from "./userListOptions";

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

    const normalizedUser = withUserDefaults(user);

    this.users.set(normalizedUser.sub, normalizedUser);
    this.providerIndex.set(
      `${normalizedUser.authProvider}:${normalizedUser.externalId}`,
      normalizedUser.sub,
    );

    return normalizedUser;
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

    const normalizedUser = withUserDefaults(user);

    if (this.users.has(normalizedUser.sub)) {
      throw new Error(`User already exists: ${normalizedUser.sub}`);
    }

    this.assertProviderIdentityAvailable(normalizedUser, normalizedUser.sub);

    this.users.set(normalizedUser.sub, normalizedUser);

    // 更新索引
    const key = getProviderIndexKey(normalizedUser);
    if (key) {
      this.providerIndex.set(key, normalizedUser.sub);
    }

    return normalizedUser;
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

    const updatedUser: UserInfo = withUserDefaults({
      ...merged,
    });

    this.assertProviderIdentityAvailable(updatedUser, userId);

    this.users.set(userId, updatedUser);

    const oldKey = getProviderIndexKey(user);
    const newKey = getProviderIndexKey(updatedUser);
    if (oldKey && oldKey !== newKey && this.providerIndex.get(oldKey) === userId) {
      this.providerIndex.delete(oldKey);
    }
    if (newKey) {
      this.providerIndex.set(newKey, userId);
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
    const listOptions = normalizeUserListOptions(options);
    let users = Array.from(this.users.values());

    // 过滤
    if (listOptions.filter) {
      users = users.filter((user) => {
        for (const [key, value] of Object.entries(listOptions.filter!)) {
          if ((user as any)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // 排序
    if (listOptions.sortBy) {
      const sortBy = listOptions.sortBy;
      const sortOrder = listOptions.sortOrder || "asc";

      users.sort((a, b) => {
        const aVal = (a as any)[sortBy];
        const bVal = (b as any)[sortBy];

        if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
        if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }

    // 分页
    if (listOptions.offset !== undefined || listOptions.limit !== undefined) {
      const offset = listOptions.offset || 0;
      const limit = listOptions.limit || users.length;
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

  private assertProviderIdentityAvailable(user: UserInfo, userId: string): void {
    const key = getProviderIndexKey(user);
    if (!key) {
      return;
    }

    const existingUserId = this.providerIndex.get(key);
    if (existingUserId && existingUserId !== userId) {
      throw new Error(`Provider identity already exists: ${user.authProvider}/${user.externalId}`);
    }
  }
}

function getProviderIndexKey(user: Pick<UserInfo, "authProvider" | "externalId">): string | null {
  return user.externalId ? `${user.authProvider}:${user.externalId}` : null;
}
