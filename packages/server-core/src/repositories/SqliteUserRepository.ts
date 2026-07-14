/**
 * SQLite 用户仓储实现
 * 用于生产环境的持久化存储
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
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

export class SqliteUserRepository implements UserRepository {
  private db: Database.Database;

  constructor(uri: string = ":memory:") {
    this.db = new Database(uri);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT NOT NULL,
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
        groups TEXT,
        "createdAt" INTEGER NOT NULL,
        "updatedAt" INTEGER NOT NULL,
        metadata TEXT,
        status TEXT,
        roles TEXT,
        "lastLoginAt" INTEGER,
        "lastSyncedAt" INTEGER,
        "providerProfile" TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users("authProvider");
      CREATE INDEX IF NOT EXISTS idx_users_provider_external ON users("authProvider", "externalId");
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_external_unique
      ON users("authProvider", "externalId")
      WHERE "externalId" IS NOT NULL;
    `;

    this.db.exec(createTableSQL);
    this.ensureUserColumns();
    this.ensureUserIds();
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
      groups: row.groups ? JSON.parse(row.groups) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status || undefined,
      ...(row.roles ? { roles: JSON.parse(row.roles) } : {}),
      ...(row.lastLoginAt ? { lastLoginAt: new Date(row.lastLoginAt) } : {}),
      ...(row.lastSyncedAt ? { lastSyncedAt: new Date(row.lastSyncedAt) } : {}),
      ...(row.providerProfile ? { providerProfile: JSON.parse(row.providerProfile) } : {}),
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
      groups: user.groups ? JSON.stringify(normalizeUserGroups(user.groups)) : null,
      createdAt: user.createdAt ? user.createdAt.getTime() : Date.now(),
      updatedAt: user.updatedAt ? user.updatedAt.getTime() : Date.now(),
      metadata: user.metadata ? JSON.stringify(user.metadata) : null,
      status: user.status ?? "active",
      roles: user.roles ? JSON.stringify(user.roles) : null,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.getTime() : null,
      lastSyncedAt: user.lastSyncedAt ? user.lastSyncedAt.getTime() : null,
      providerProfile: user.providerProfile ? JSON.stringify(user.providerProfile) : null,
    };
  }

  async findById(sub: string): Promise<UserInfo | null> {
    return this.findByIdSync(sub);
  }

  async findByUsername(username: string): Promise<UserInfo | null> {
    const stmt = this.db.prepare("SELECT * FROM users WHERE username = ?");
    const row = stmt.get(username) as any;
    return row ? this.userFromRow(row) : null;
  }

  async findByEmail(email: string): Promise<UserInfo | null> {
    const stmt = this.db.prepare("SELECT * FROM users WHERE email = ?");
    const row = stmt.get(email) as any;
    return row ? this.userFromRow(row) : null;
  }

  async findByProviderAndExternalId(
    provider: string,
    externalId: string,
  ): Promise<UserInfo | null> {
    return this.findByProviderAndExternalIdSync(provider, externalId);
  }

  private findByProviderAndExternalIdSync(provider: string, externalId: string): UserInfo | null {
    const sql = `
      SELECT * FROM users
      WHERE "authProvider" = ?
      AND "externalId" = ?
    `;
    const stmt = this.db.prepare(sql);
    const row = stmt.get(provider, externalId) as any;
    return row ? this.userFromRow(row) : null;
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
    const transaction = this.db.transaction(() => {
      const existingUser = this.findByProviderAndExternalIdSync(provider, externalId);
      if (existingUser) {
        return {
          user: this.updateSync(existingUser, {
            ...userData,
            authProvider: provider,
            externalId,
          }),
          before: existingUser,
          created: false,
        };
      }

      const now = new Date();
      const user = this.createSync({
        ...userData,
        authProvider: provider,
        externalId,
        createdAt: now,
        updatedAt: now,
      });
      return { user, before: null, created: true };
    });

    return transaction.immediate();
  }

  async create(userData: Omit<UserInfo, "id" | "sub">): Promise<UserInfo> {
    return this.createSync(userData);
  }

  private createSync(userData: Omit<UserInfo, "id" | "sub">): UserInfo {
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

    this.assertProviderIdentityAvailableSync(user, user.sub);

    const row = this.userToRow(user);

    const sql = `
      INSERT INTO users (
        id, sub, username, name, email, picture, phone, "authProvider",
        "externalId", "emailVerified", "phoneVerified", groups, "createdAt", "updatedAt",
        metadata, status, roles, "lastLoginAt", "lastSyncedAt", "providerProfile"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = this.db.prepare(sql);
    stmt.run(
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
    );

    return withUserDefaults(user);
  }

  async update(sub: string, updates: Partial<UserInfo>): Promise<UserInfo> {
    return (await this.updateWithResult(sub, updates)).user;
  }

  async updateWithResult(sub: string, updates: Partial<UserInfo>): Promise<UserUpdateResult> {
    const transaction = this.db.transaction(() => {
      const before = this.findByIdSync(sub);
      if (!before) {
        throw new Error(`User not found: ${sub}`);
      }
      return { before, user: this.updateSync(before, updates) };
    });
    return transaction.immediate();
  }

  private updateSync(user: UserInfo, updates: Partial<UserInfo>): UserInfo {
    const sub = user.sub;
    const updatedUser: UserInfo = {
      ...user,
      ...updates,
      id: user.id,
      sub: user.sub,
      updatedAt: new Date(Date.now() + 1),
    };

    this.assertProviderIdentityAvailableSync(updatedUser, sub);

    const row = this.userToRow(updatedUser);

    const sql = `
      UPDATE users SET
        username = ?, name = ?, email = ?, picture = ?, phone = ?, "authProvider" = ?,
        "externalId" = ?,
        "emailVerified" = ?, "phoneVerified" = ?, groups = ?, "updatedAt" = ?, metadata = ?,
        status = ?, roles = ?, "lastLoginAt" = ?, "lastSyncedAt" = ?, "providerProfile" = ?
      WHERE sub = ?
    `;

    const stmt = this.db.prepare(sql);
    stmt.run(
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
      sub,
    );

    return updatedUser;
  }

  private ensureUserColumns(): void {
    const pragmaStmt = this.db.prepare(`PRAGMA table_info(users)`);
    const columns = pragmaStmt.all() as { name: string }[];
    const requiredColumns: Array<{ name: string; definition: string }> = [
      { name: "id", definition: "ALTER TABLE users ADD COLUMN id TEXT" },
      { name: "externalId", definition: 'ALTER TABLE users ADD COLUMN "externalId" TEXT' },
      { name: "status", definition: "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'" },
      { name: "roles", definition: "ALTER TABLE users ADD COLUMN roles TEXT" },
      { name: "lastLoginAt", definition: 'ALTER TABLE users ADD COLUMN "lastLoginAt" INTEGER' },
      { name: "lastSyncedAt", definition: 'ALTER TABLE users ADD COLUMN "lastSyncedAt" INTEGER' },
      {
        name: "providerProfile",
        definition: 'ALTER TABLE users ADD COLUMN "providerProfile" TEXT',
      },
    ];

    for (const column of requiredColumns) {
      if (!columns.some((col) => col.name === column.name)) {
        this.db.exec(column.definition);
      }
    }
  }

  private ensureUserIds(): void {
    const rows = this.db
      .prepare("SELECT sub FROM users WHERE id IS NULL OR id = ''")
      .all() as Array<{ sub: string }>;
    const update = this.db.prepare(
      "UPDATE users SET id = ? WHERE sub = ? AND (id IS NULL OR id = '')",
    );
    this.db.transaction(() => {
      for (const row of rows) {
        update.run(randomUUID(), row.sub);
      }
    })();
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id ON users(id)");
  }

  async delete(sub: string): Promise<void> {
    await this.deleteWithResult(sub);
  }

  async deleteWithResult(sub: string): Promise<UserDeleteResult> {
    const transaction = this.db.transaction(() => {
      const deleted = this.findByIdSync(sub);
      if (deleted) {
        this.db.prepare("DELETE FROM users WHERE sub = ?").run(sub);
      }
      return { deleted };
    });
    return transaction.immediate();
  }

  async list(options?: ListOptions): Promise<UserInfo[]> {
    const listOptions = normalizeUserListOptions(options);
    let sql = "SELECT * FROM users";
    const params: any[] = [];

    // 过滤
    const conditions: string[] = [];
    if (listOptions.filter) {
      for (const [key, value] of Object.entries(listOptions.filter)) {
        const columnName = key === "authProvider" ? '"authProvider"' : key;
        conditions.push(`${columnName} = ?`);
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
    if (listOptions.offset !== undefined || listOptions.limit !== undefined) {
      const offset = listOptions.offset || 0;
      const limit = listOptions.limit;
      sql += " LIMIT ? OFFSET ?";
      params.push(limit || -1, offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];
    return rows.map((row) => this.userFromRow(row));
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM users");
  }

  /**
   * 获取用户数量（用于调试）
   */
  async size(): Promise<number> {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM users");
    const row = stmt.get() as any;
    return row.count;
  }

  /**
   * 关闭数据库连接
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close();
      resolve();
    });
  }

  private findByIdSync(sub: string): UserInfo | null {
    const row = this.db.prepare("SELECT * FROM users WHERE sub = ?").get(sub) as any;
    return row ? this.userFromRow(row) : null;
  }

  private assertProviderIdentityAvailableSync(user: UserInfo, sub: string): void {
    if (!user.externalId) {
      return;
    }

    const existing = this.findByProviderAndExternalIdSync(user.authProvider, user.externalId);
    if (existing && existing.sub !== sub) {
      throw new Error(`Provider identity already exists: ${user.authProvider}/${user.externalId}`);
    }
  }
}
