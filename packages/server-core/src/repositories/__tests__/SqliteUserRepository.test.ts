/**
 * SqliteUserRepository 单元测试
 */

import type { UserInfo } from "../../types/auth.js";
import { SqliteUserRepository } from "../SqliteUserRepository.js";

describe("SqliteUserRepository", () => {
  let repository: SqliteUserRepository;

  beforeEach(() => {
    // 使用内存数据库进行测试
    repository = new SqliteUserRepository(":memory:");
  });

  afterEach(async () => {
    await repository.clear();
    await repository.close();
  });

  const mockUserData: Omit<UserInfo, "sub" | "createdAt" | "updatedAt"> = {
    username: "testuser",
    name: "Test User",
    email: "test@example.com",
    picture: "https://example.com/avatar.jpg",
    phone: "+1234567890",
    authProvider: "local",
    emailVerified: true,
    phoneVerified: false,
    groups: ["users", "admins"],
    externalId: "ext123",
    metadata: { role: "user" },
  };

  describe("create", () => {
    it("应该成功创建用户", async () => {
      const user = await repository.create(mockUserData);

      expect(user).toMatchObject(mockUserData);
      expect(user.sub).toBeDefined();
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it("应该在数据库层约束外部身份唯一", () => {
      const indexes = (repository as any).db.prepare("PRAGMA index_list(users)").all();

      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "idx_users_provider_external_unique",
            unique: 1,
          }),
        ]),
      );
    });

    it("应该使用提供的创建和更新时间", async () => {
      const customTime = new Date("2023-01-01T00:00:00Z");
      const user = await repository.create({
        ...mockUserData,
        createdAt: customTime,
        updatedAt: customTime,
      });

      expect(user.createdAt).toEqual(customTime);
      expect(user.updatedAt).toEqual(customTime);
    });

    it("应该为老格式用户默认设置 active 状态并持久化规范字段", async () => {
      const user = await repository.create({
        ...mockUserData,
        roles: ["operator"],
        lastSyncedAt: new Date("2026-01-01T00:00:00Z"),
        providerProfile: {
          provider: "local",
          externalId: "ext123",
          syncedAt: new Date("2026-01-01T00:00:00Z"),
        },
      });
      const found = await repository.findById(user.sub);

      expect(found?.status).toBe("active");
      expect(found?.roles).toEqual(["operator"]);
      expect(found?.providerProfile?.provider).toBe("local");
    });
  });

  describe("findById", () => {
    it("应该根据 ID 找到用户", async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findById(created.sub);

      expect(found).toEqual(created);
    });

    it("应该为不存在的 ID 返回 null", async () => {
      const found = await repository.findById("nonexistent");

      expect(found).toBeNull();
    });
  });

  describe("findByUsername", () => {
    it("应该根据用户名找到用户", async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findByUsername("testuser");

      expect(found).toEqual(created);
    });

    it("应该为不存在的用户名返回 null", async () => {
      const found = await repository.findByUsername("nonexistent");

      expect(found).toBeNull();
    });
  });

  describe("findByEmail", () => {
    it("应该根据邮箱找到用户", async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findByEmail("test@example.com");

      expect(found).toEqual(created);
    });

    it("应该为不存在的邮箱返回 null", async () => {
      const found = await repository.findByEmail("nonexistent@example.com");

      expect(found).toBeNull();
    });
  });

  describe("findByProviderAndExternalId", () => {
    it("应该根据提供者和外部 ID 找到用户", async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findByProviderAndExternalId("local", "ext123");

      expect(found).toEqual(created);
    });

    it("应该为不存在的提供者外部 ID 返回 null", async () => {
      const found = await repository.findByProviderAndExternalId("unknown", "ext123");

      expect(found).toBeNull();
    });
  });

  const stripUserData = (
    user: Omit<UserInfo, "sub" | "createdAt" | "updatedAt">,
  ): Omit<UserInfo, "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider"> => {
    const { authProvider: _provider, externalId: _externalId, ...rest } = user;
    return rest;
  };

  describe("findOrCreate", () => {
    it("应该找到现有用户", async () => {
      const created = await repository.create(mockUserData);
      const found = await repository.findOrCreate("local", "ext123", stripUserData(mockUserData));

      // 现在 findOrCreate 会更新用户，所以 updatedAt 会不同
      expect(found.sub).toEqual(created.sub);
      expect(found.username).toEqual(created.username);
      expect(found.email).toEqual(created.email);
      expect(found.createdAt).toEqual(created.createdAt);
      expect(found.updatedAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();
      if (found.updatedAt && created.updatedAt) {
        expect(found.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
      }
    });

    it("应该创建新用户当不存在时", async () => {
      const found = await repository.findOrCreate(
        "local",
        "newExt123",
        stripUserData(mockUserData),
      );

      expect(found).toMatchObject({
        ...mockUserData,
        externalId: "newExt123",
      });
      expect(found.sub).toBeDefined();
      expect(found.createdAt).toBeInstanceOf(Date);
      expect(found.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("update", () => {
    it("应该成功更新用户", async () => {
      const created = await repository.create(mockUserData);
      const updates = {
        name: "Updated Name",
        emailVerified: false,
        groups: ["users"],
      };

      const updated = await repository.update(created.sub, updates);

      expect(updated.name).toBe("Updated Name");
      expect(updated.emailVerified).toBe(false);
      expect(updated.groups).toEqual(["users"]);
      expect(updated.sub).toBe(created.sub);
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it("应该在更新外部身份后只允许新身份命中用户", async () => {
      const created = await repository.create(mockUserData);

      const updated = await repository.update(created.sub, {
        authProvider: "feishu",
        externalId: "open-new",
      });

      await expect(repository.findByProviderAndExternalId("local", "ext123")).resolves.toBeNull();
      await expect(repository.findByProviderAndExternalId("feishu", "open-new")).resolves.toEqual(
        updated,
      );
    });

    it("应该拒绝把同一外部身份绑定到不同用户", async () => {
      await repository.create({
        ...mockUserData,
        username: "user1",
        email: "user1@example.com",
        externalId: "ext1",
      });
      const user2 = await repository.create({
        ...mockUserData,
        username: "user2",
        email: "user2@example.com",
        externalId: "ext2",
      });

      await expect(
        repository.update(user2.sub, {
          authProvider: "local",
          externalId: "ext1",
        }),
      ).rejects.toThrow("Provider identity already exists: local/ext1");
    });

    it("应该为不存在的用户抛出错误", async () => {
      await expect(repository.update("nonexistent", { name: "test" })).rejects.toThrow(
        "User not found: nonexistent",
      );
    });
  });

  describe("delete", () => {
    it("应该成功删除用户", async () => {
      const created = await repository.create(mockUserData);
      await repository.delete(created.sub);

      const found = await repository.findById(created.sub);
      expect(found).toBeNull();
    });

    it("应该安静处理不存在的用户", async () => {
      await expect(repository.delete("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      // 创建测试用户
      await repository.create({
        ...mockUserData,
        username: "user1",
        email: "user1@example.com",
        externalId: "ext1",
      });
      await repository.create({
        ...mockUserData,
        username: "user2",
        email: "user2@example.com",
        authProvider: "oauth",
        externalId: "ext2",
      });
      await repository.create({
        ...mockUserData,
        username: "user3",
        email: "user3@example.com",
        externalId: "ext3",
      });
    });

    it("应该返回所有用户", async () => {
      const users = await repository.list();

      expect(users).toHaveLength(3);
    });

    it("应该支持过滤", async () => {
      const users = await repository.list({ filter: { authProvider: "local" } });

      expect(users).toHaveLength(2);
      expect(users.every((u) => u.authProvider === "local")).toBe(true);
    });

    it("应该支持排序", async () => {
      const users = await repository.list({ sortBy: "username", sortOrder: "desc" });

      expect(users).toHaveLength(3);
      expect(users[0].username).toBe("user3");
      expect(users[1].username).toBe("user2");
      expect(users[2].username).toBe("user1");
    });

    it("应该拒绝非法排序字段", async () => {
      await expect(repository.list({ sortBy: "username; DROP TABLE users" })).rejects.toThrow(
        /Unsupported user sort field/,
      );
    });

    it("应该支持分页", async () => {
      const users = await repository.list({ offset: 1, limit: 2 });

      expect(users).toHaveLength(2);
    });
  });

  describe("clear", () => {
    it("应该清空所有用户", async () => {
      await repository.create(mockUserData);
      await repository.create({
        ...mockUserData,
        username: "user2",
        email: "user2@example.com",
        externalId: "ext456",
      });

      let count = await repository.size();
      expect(count).toBeGreaterThan(0);

      await repository.clear();

      count = await repository.size();
      expect(count).toBe(0);
    });
  });

  describe("size", () => {
    it("应该返回用户数量", async () => {
      let count = await repository.size();
      expect(count).toBe(0);

      await repository.create(mockUserData);
      count = await repository.size();
      expect(count).toBe(1);

      await repository.create({
        ...mockUserData,
        username: "user2",
        email: "user2@example.com",
        externalId: "ext789",
      });
      count = await repository.size();
      expect(count).toBe(2);
    });
  });

  describe("close", () => {
    it("应该成功关闭数据库连接", async () => {
      const repoForClose = new SqliteUserRepository(":memory:");
      await repoForClose.clear(); // 先清理数据
      await expect(repoForClose.close()).resolves.toBeUndefined();
    });
  });
});
