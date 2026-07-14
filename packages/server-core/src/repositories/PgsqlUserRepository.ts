import { randomUUID } from "crypto";
import { Pool, type PoolClient } from "pg";
import type {
  ListOptions,
  UserDeleteResult,
  UserFindOrCreateResult,
  UserInfo,
  UserRepository,
  UserUpdateResult,
} from "../types/auth.js";
import { withUserDefaults } from "../utils/userDefaults.js";
import { normalizeUserGroups } from "../utils/userGroups.js";
import { generateUserId } from "../utils/userIdGenerator.js";
import { getUserListSortColumn, normalizeUserListOptions } from "./userListOptions.js";

export class PgsqlUserRepository implements UserRepository {
  private pool: Pool;
  private ready: Promise<void>;

  constructor(uri: string) {
    this.pool = new Pool({
      connectionString: uri,
      // 连接池配置
      max: 20, // 最大连接数
      min: 2, // 最小连接数
      idleTimeoutMillis: 30000, // 空闲连接超时
      connectionTimeoutMillis: 2000, // 连接超时
    });

    this.ready = this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT,
        sub TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        picture TEXT,
        phone TEXT,
        "authProvider" TEXT NOT NULL,
        "externalId" TEXT,
        "emailVerified" INTEGER,
        "phoneVerified" INTEGER,
        groups JSONB,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        metadata JSONB,
        status TEXT DEFAULT 'active',
        roles JSONB,
        "lastLoginAt" TIMESTAMP WITH TIME ZONE,
        "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
        "providerProfile" JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users("authProvider");
      CREATE INDEX IF NOT EXISTS idx_users_provider_external ON users("authProvider", "externalId");
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_external_unique
      ON users("authProvider", "externalId")
      WHERE "externalId" IS NOT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS roles JSONB;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP WITH TIME ZONE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "providerProfile" JSONB;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS id TEXT;
    `;

    const client = await this.pool.connect();
    try {
      await client.query(createTableSQL);
      const missingIds = await client.query<{ sub: string }>(
        "SELECT sub FROM users WHERE id IS NULL OR id = ''",
      );
      for (const row of missingIds.rows) {
        await client.query("UPDATE users SET id = $1 WHERE sub = $2 AND (id IS NULL OR id = '')", [
          randomUUID(),
          row.sub,
        ]);
      }
      await client.query(`
        ALTER TABLE users ALTER COLUMN id SET NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id ON users(id);
      `);
    } finally {
      client.release();
    }
  }

  private userFromRow(row: any): UserInfo {
    return withUserDefaults({
      id: row.id,
      sub: row.sub,
      username: row.username,
      name: row.name,
      email: row.email,
      picture: row.picture || undefined,
      phone: row.phone || undefined,
      authProvider: row.authProvider,
      externalId: row.externalId || undefined,
      ...(row.emailVerified !== null && row.emailVerified !== undefined
        ? { emailVerified: !!row.emailVerified }
        : {}),
      ...(row.phoneVerified !== null && row.phoneVerified !== undefined
        ? { phoneVerified: !!row.phoneVerified }
        : {}),
      groups: row.groups || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadata || undefined,
      status: row.status || undefined,
      ...(row.roles ? { roles: row.roles } : {}),
      ...(row.lastLoginAt ? { lastLoginAt: row.lastLoginAt } : {}),
      ...(row.lastSyncedAt ? { lastSyncedAt: row.lastSyncedAt } : {}),
      ...(row.providerProfile ? { providerProfile: row.providerProfile } : {}),
    });
  }

  private userToRow(user: UserInfo): any {
    return {
      id: user.id,
      sub: user.sub,
      username: user.username,
      name: user.name,
      email: user.email,
      picture: user.picture,
      phone: user.phone,
      authProvider: user.authProvider,
      externalId: user.externalId ?? null,
      emailVerified: user.emailVerified !== undefined ? (user.emailVerified ? 1 : 0) : null,
      phoneVerified: user.phoneVerified !== undefined ? (user.phoneVerified ? 1 : 0) : null,
      groups: user.groups ? normalizeUserGroups(user.groups) : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      metadata: user.metadata || null,
      status: user.status ?? "active",
      roles: user.roles || null,
      lastLoginAt: user.lastLoginAt || null,
      lastSyncedAt: user.lastSyncedAt || null,
      providerProfile: user.providerProfile || null,
    };
  }

  async findById(sub: string): Promise<UserInfo | null> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      const result = await client.query("SELECT * FROM users WHERE sub = $1", [sub]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findByUsername(username: string): Promise<UserInfo | null> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      const result = await client.query("SELECT * FROM users WHERE username = $1", [username]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findByEmail(email: string): Promise<UserInfo | null> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      const result = await client.query("SELECT * FROM users WHERE email = $1", [email]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findByProviderAndExternalId(
    provider: string,
    externalId: string,
  ): Promise<UserInfo | null> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      const sql = `
        SELECT * FROM users
        WHERE "authProvider" = $1
        AND "externalId" = $2
      `;
      const result = await client.query(sql, [provider, externalId]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findOrCreate(
    provider: string,
    externalId: string,
    userData: Omit<
      UserInfo,
      "id" | "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider"
    >,
  ): Promise<UserInfo> {
    return (await this.findOrCreateWithResult(provider, externalId, userData)).user;
  }

  async findOrCreateWithResult(
    provider: string,
    externalId: string,
    userData: Omit<
      UserInfo,
      "id" | "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider"
    >,
  ): Promise<UserFindOrCreateResult> {
    const existingUser = await this.findByProviderAndExternalId(provider, externalId);

    if (existingUser) {
      // 用户已存在，更新用户信息（保持 sub 和 createdAt 不变）
      const result = await this.updateWithResult(existingUser.sub, {
        ...userData,
        authProvider: provider,
        externalId,
      });
      return { ...result, created: false };
    }

    // 创建新用户
    const userToCreate: Omit<UserInfo, "id" | "sub"> = {
      ...userData,
      authProvider: provider,
      externalId: externalId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const user = await this.create(userToCreate);
      return { user, before: null, created: true };
    } catch (err) {
      // PostgreSQL 的唯一索引是最终并发仲裁；仅在同一 provider identity 已被另一
      // 请求创建时重试读取，其他约束错误（如用户名冲突）仍需原样暴露。
      const concurrentUser = await this.findByProviderAndExternalId(provider, externalId);
      if (concurrentUser) {
        const result = await this.updateWithResult(concurrentUser.sub, {
          ...userData,
          authProvider: provider,
          externalId,
        });
        return { ...result, created: false };
      }
      throw err;
    }
  }

  async create(userData: Omit<UserInfo, "id" | "sub">): Promise<UserInfo> {
    await this.ready;
    const now = new Date();

    // 如果提供了 authProvider 和 externalId，使用哈希生成确定性的 sub
    const sub =
      userData.authProvider && userData.externalId
        ? generateUserId(userData.authProvider, userData.externalId)
        : randomUUID();

    const user: UserInfo = {
      ...userData,
      id: randomUUID(),
      sub,
      createdAt: userData.createdAt || now,
      updatedAt: userData.updatedAt || now,
    };

    await this.assertProviderIdentityAvailable(user, user.sub);

    const row = this.userToRow(user);

    const sql = `
      INSERT INTO users (
        id, sub, username, name, email, picture, phone, "authProvider",
        "externalId", "emailVerified", "phoneVerified", groups, "createdAt", "updatedAt",
        metadata, status, roles, "lastLoginAt", "lastSyncedAt", "providerProfile"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
    `;

    const client = await this.pool.connect();
    try {
      await client.query(sql, [
        row.id,
        row.sub,
        row.username,
        row.name,
        row.email,
        row.picture,
        row.phone,
        row.authProvider,
        row.externalId,
        row.emailVerified,
        row.phoneVerified,
        row.groups,
        row.createdAt,
        row.updatedAt,
        row.metadata,
        row.status,
        row.roles,
        row.lastLoginAt,
        row.lastSyncedAt,
        row.providerProfile,
      ]);
      return withUserDefaults(user);
    } finally {
      client.release();
    }
  }

  async update(sub: string, updates: Partial<UserInfo>): Promise<UserInfo> {
    return (await this.updateWithResult(sub, updates)).user;
  }

  async updateWithResult(sub: string, updates: Partial<UserInfo>): Promise<UserUpdateResult> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await this.findByIdWithClient(client, sub, true);
      if (!before) {
        throw new Error(`User not found: ${sub}`);
      }
      const user = await this.updateWithClient(client, before, updates);
      await client.query("COMMIT");
      return { before, user };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(sub: string): Promise<void> {
    await this.deleteWithResult(sub);
  }

  async deleteWithResult(sub: string): Promise<UserDeleteResult> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await this.findByIdWithClient(client, sub, true);
      if (deleted) {
        await client.query("DELETE FROM users WHERE sub = $1", [sub]);
      }
      await client.query("COMMIT");
      return { deleted };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(options?: ListOptions): Promise<UserInfo[]> {
    const listOptions = normalizeUserListOptions(options);
    await this.ready;
    let sql = "SELECT * FROM users";
    const params: any[] = [];
    let paramIndex = 1;

    // 过滤
    const conditions: string[] = [];
    if (listOptions.filter) {
      for (const [key, value] of Object.entries(listOptions.filter)) {
        const columnName = key === "authProvider" ? '"authProvider"' : key;
        conditions.push(`${columnName} = $${paramIndex++}`);
        params.push(value);
      }
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    // 排序
    if (listOptions.sortBy) {
      const sortBy = getUserListSortColumn(listOptions.sortBy);
      const sortOrder = listOptions.sortOrder === "desc" ? "DESC" : "ASC";
      sql += ` ORDER BY ${sortBy} ${sortOrder}`;
    }

    // 分页
    if (listOptions.limit !== undefined) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(listOptions.limit);
    }
    if (listOptions.offset !== undefined) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(listOptions.offset);
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows.map((row) => this.userFromRow(row));
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("DELETE FROM users");
    } finally {
      client.release();
    }
  }

  /**
   * 获取用户数量（用于调试）
   */
  async size(): Promise<number> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      const result = await client.query("SELECT COUNT(*) as count FROM users");
      return parseInt(result.rows[0].count, 10);
    } finally {
      client.release();
    }
  }

  /**
   * 关闭连接池
   */
  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    await this.pool.end();
  }

  private async assertProviderIdentityAvailable(user: UserInfo, sub: string): Promise<void> {
    if (!user.externalId) {
      return;
    }

    const existing = await this.findByProviderAndExternalId(user.authProvider, user.externalId);
    if (existing && existing.sub !== sub) {
      throw new Error(`Provider identity already exists: ${user.authProvider}/${user.externalId}`);
    }
  }

  private async findByIdWithClient(
    client: PoolClient,
    sub: string,
    lock: boolean,
  ): Promise<UserInfo | null> {
    const result = await client.query(
      `SELECT * FROM users WHERE sub = $1${lock ? " FOR UPDATE" : ""}`,
      [sub],
    );
    return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
  }

  private async updateWithClient(
    client: PoolClient,
    before: UserInfo,
    updates: Partial<UserInfo>,
  ): Promise<UserInfo> {
    const updatedUser: UserInfo = {
      ...before,
      ...updates,
      id: before.id,
      sub: before.sub,
      updatedAt: new Date(),
    };
    await this.assertProviderIdentityAvailableWithClient(client, updatedUser, before.sub);
    const row = this.userToRow(updatedUser);
    await client.query(
      `UPDATE users SET
        username = $1, name = $2, email = $3, picture = $4, phone = $5, "authProvider" = $6,
        "externalId" = $7,
        "emailVerified" = $8, "phoneVerified" = $9, groups = $10, "updatedAt" = $11,
        metadata = $12, status = $13, roles = $14, "lastLoginAt" = $15,
        "lastSyncedAt" = $16, "providerProfile" = $17
       WHERE sub = $18`,
      [
        row.username,
        row.name,
        row.email,
        row.picture,
        row.phone,
        row.authProvider,
        row.externalId,
        row.emailVerified,
        row.phoneVerified,
        row.groups,
        row.updatedAt,
        row.metadata,
        row.status,
        row.roles,
        row.lastLoginAt,
        row.lastSyncedAt,
        row.providerProfile,
        before.sub,
      ],
    );
    return updatedUser;
  }

  private async assertProviderIdentityAvailableWithClient(
    client: PoolClient,
    user: UserInfo,
    sub: string,
  ): Promise<void> {
    if (!user.externalId) return;
    const result = await client.query(
      `SELECT sub FROM users WHERE "authProvider" = $1 AND "externalId" = $2`,
      [user.authProvider, user.externalId],
    );
    const existingSub = result.rows[0]?.sub;
    if (existingSub && existingSub !== sub) {
      throw new Error(`Provider identity already exists: ${user.authProvider}/${user.externalId}`);
    }
  }
}
