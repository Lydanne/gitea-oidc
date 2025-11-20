/**
 * SQLite 用户仓储实现
 * 用于生产环境的持久化存储
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { ListOptions, UserInfo, UserRepository } from "../types/auth";
import { generateUserId } from "../utils/userIdGenerator";

export class SqliteUserRepository implements UserRepository {
  private db: Database.Database;

  constructor(uri: string = ":memory:") {
    this.db = new Database(uri);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS users (
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
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users("authProvider");
      CREATE INDEX IF NOT EXISTS idx_users_provider_external ON users("authProvider", "externalId");
    `;

    this.db.exec(createTableSQL);
    this.ensureExternalIdColumn();
  }

  private userFromRow(row: any): UserInfo {
    return {
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
    };
  }

  private userToRow(user: UserInfo): any {
    return {
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
      groups: user.groups ? JSON.stringify(user.groups) : null,
      createdAt: user.createdAt ? user.createdAt.getTime() : Date.now(),
      updatedAt: user.updatedAt ? user.updatedAt.getTime() : Date.now(),
      metadata: user.metadata ? JSON.stringify(user.metadata) : null,
    };
  }

  async findById(sub: string): Promise<UserInfo | null> {
    const stmt = this.db.prepare("SELECT * FROM users WHERE sub = ?");
    const row = stmt.get(sub) as any;
    return row ? this.userFromRow(row) : null;
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
    userData: Omit<UserInfo, "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider">,
  ): Promise<UserInfo> {
    const existingUser = await this.findByProviderAndExternalId(provider, externalId);

    if (existingUser) {
      // 用户已存在，更新用户信息（保持 sub 和 createdAt 不变）
      return await this.update(existingUser.sub, {
        ...userData,
        authProvider: provider,
        externalId,
      });
    }

    // 创建新用户
    const userToCreate: Omit<UserInfo, "sub"> = {
      ...userData,
      authProvider: provider,
      externalId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return await this.create(userToCreate);
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
    };

    const row = this.userToRow(user);

    const sql = `
      INSERT INTO users (
        sub, username, name, email, picture, phone, "authProvider",
        "externalId", "emailVerified", "phoneVerified", groups, "createdAt", "updatedAt", metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = this.db.prepare(sql);
    stmt.run(
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
    );

    return user;
  }

  async update(sub: string, updates: Partial<UserInfo>): Promise<UserInfo> {
    const user = await this.findById(sub);
    if (!user) {
      throw new Error(`User not found: ${sub}`);
    }

    const updatedUser: UserInfo = {
      ...user,
      ...updates,
      sub: user.sub,
      updatedAt: new Date(Date.now() + 1),
    };

    const row = this.userToRow(updatedUser);

    const sql = `
      UPDATE users SET
        username = ?, name = ?, email = ?, picture = ?, phone = ?, "authProvider" = ?,
        "externalId" = ?,
        "emailVerified" = ?, "phoneVerified" = ?, groups = ?, "updatedAt" = ?, metadata = ?
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
      sub,
    );

    return updatedUser;
  }

  private ensureExternalIdColumn(): void {
    const pragmaStmt = this.db.prepare(`PRAGMA table_info(users)`);
    const columns = pragmaStmt.all() as { name: string }[];
    const hasExternalId = columns.some((col) => col.name === "externalId");

    if (!hasExternalId) {
      this.db.exec('ALTER TABLE users ADD COLUMN "externalId" TEXT');
    }
  }

  async delete(sub: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM users WHERE sub = ?");
    stmt.run(sub);
  }

  async list(options?: ListOptions): Promise<UserInfo[]> {
    let sql = "SELECT * FROM users";
    const params: any[] = [];

    // 过滤
    const conditions: string[] = [];
    if (options?.filter) {
      for (const [key, value] of Object.entries(options.filter)) {
        if (["username", "name", "email", "authProvider"].includes(key)) {
          const columnName = key === "authProvider" ? '"authProvider"' : key;
          conditions.push(`${columnName} = ?`);
          params.push(value);
        }
      }
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    // 排序
    if (options?.sortBy) {
      const sortBy = options.sortBy === "authProvider" ? '"authProvider"' : options.sortBy;
      const sortOrder = options.sortOrder === "desc" ? "DESC" : "ASC";
      sql += ` ORDER BY ${sortBy} ${sortOrder}`;
    }

    // 分页
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit;
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
}
