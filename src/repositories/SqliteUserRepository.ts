/**
 * SQLite 用户仓储实现
 * 用于生产环境的持久化存储
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { UserRepository, UserInfo, ListOptions } from '../types/auth';

export class SqliteUserRepository implements UserRepository {
  private db: Database.Database;

  constructor(uri: string = ':memory:') {
    this.db = new Database(uri);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        picture TEXT,
        phone TEXT,
        auth_provider TEXT NOT NULL,
        email_verified INTEGER,
        phone_verified INTEGER,
        groups TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);
    `;

    this.db.exec(createTableSQL);
  }

  private userFromRow(row: any): UserInfo {
    return {
      sub: row.id,
      username: row.username,
      name: row.name,
      email: row.email,
      picture: row.picture || undefined,
      phone: row.phone || undefined,
      authProvider: row.auth_provider,
      ...(row.email_verified !== null ? { email_verified: !!row.email_verified } : {}),
      ...(row.phone_verified !== null ? { phone_verified: !!row.phone_verified } : {}),
      groups: row.groups ? JSON.parse(row.groups) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private userToRow(user: UserInfo): any {
    return {
      id: user.sub,
      username: user.username,
      name: user.name,
      email: user.email,
      picture: user.picture,
      phone: user.phone,
      auth_provider: user.authProvider,
      email_verified: user.email_verified !== undefined ? (user.email_verified ? 1 : 0) : null,
      phone_verified: user.phone_verified !== undefined ? (user.phone_verified ? 1 : 0) : null,
      groups: user.groups ? JSON.stringify(user.groups) : null,
      created_at: user.createdAt ? user.createdAt.getTime() : Date.now(),
      updated_at: user.updatedAt ? user.updatedAt.getTime() : Date.now(),
      metadata: user.metadata ? JSON.stringify(user.metadata) : null,
    };
  }

  async findById(userId: string): Promise<UserInfo | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(userId) as any;
    return row ? this.userFromRow(row) : null;
  }

  async findByUsername(username: string): Promise<UserInfo | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    const row = stmt.get(username) as any;
    return row ? this.userFromRow(row) : null;
  }

  async findByEmail(email: string): Promise<UserInfo | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const row = stmt.get(email) as any;
    return row ? this.userFromRow(row) : null;
  }

  async findByProviderAndExternalId(
    provider: string,
    externalId: string
  ): Promise<UserInfo | null> {
    const sql = `
      SELECT * FROM users
      WHERE auth_provider = ?
      AND metadata LIKE ?
    `;
    const stmt = this.db.prepare(sql);
    const row = stmt.get(provider, `%${externalId}%`) as any;
    return row ? this.userFromRow(row) : null;
  }

  async findOrCreate(
    criteria: { provider: string; externalId: string },
    userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'>
  ): Promise<UserInfo> {
    const existingUser = await this.findByProviderAndExternalId(
      criteria.provider,
      criteria.externalId
    );

    if (existingUser) {
      return existingUser;
    }

    // 创建新用户
    const userToCreate: Omit<UserInfo, 'sub'> = {
      ...userData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return await this.create(userToCreate);
  }

  async create(userData: Omit<UserInfo, 'sub'>): Promise<UserInfo> {
    const now = new Date();
    const user: UserInfo = {
      ...userData,
      sub: randomUUID(),
      createdAt: userData.createdAt || now,
      updatedAt: userData.updatedAt || now,
    };

    const row = this.userToRow(user);

    const sql = `
      INSERT INTO users (
        id, username, name, email, picture, phone, auth_provider,
        email_verified, phone_verified, groups, created_at, updated_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = this.db.prepare(sql);
    stmt.run(
      row.id, row.username, row.name, row.email, row.picture, row.phone, row.auth_provider,
      row.email_verified, row.phone_verified, row.groups, row.created_at, row.updated_at, row.metadata
    );

    return user;
  }

  async update(userId: string, updates: Partial<UserInfo>): Promise<UserInfo> {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
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
        username = ?, name = ?, email = ?, picture = ?, phone = ?, auth_provider = ?,
        email_verified = ?, phone_verified = ?, groups = ?, updated_at = ?, metadata = ?
      WHERE id = ?
    `;

    const stmt = this.db.prepare(sql);
    stmt.run(
      row.username, row.name, row.email, row.picture, row.phone, row.auth_provider,
      row.email_verified, row.phone_verified, row.groups, row.updated_at, row.metadata,
      userId
    );

    return updatedUser;
  }

  async delete(userId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM users WHERE id = ?');
    stmt.run(userId);
  }

  async list(options?: ListOptions): Promise<UserInfo[]> {
    let sql = 'SELECT * FROM users';
    const params: any[] = [];

    // 过滤
    const conditions: string[] = [];
    if (options?.filter) {
      for (const [key, value] of Object.entries(options.filter)) {
        if (['username', 'name', 'email', 'authProvider'].includes(key)) {
          conditions.push(`${key === 'authProvider' ? 'auth_provider' : key} = ?`);
          params.push(value);
        }
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // 排序
    if (options?.sortBy) {
      const sortBy = options.sortBy === 'authProvider' ? 'auth_provider' : options.sortBy;
      const sortOrder = options.sortOrder === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${sortBy} ${sortOrder}`;
    }

    // 分页
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit;
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit || -1, offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];
    return rows.map(row => this.userFromRow(row));
  }

  async clear(): Promise<void> {
    this.db.exec('DELETE FROM users');
  }

  /**
   * 获取用户数量（用于调试）
   */
  async size(): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
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