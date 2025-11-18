import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { generateUserId } from '../utils/userIdGenerator';
import type { UserRepository, UserInfo, ListOptions } from '../types/auth';

export class PgsqlUserRepository implements UserRepository {
  private pool: Pool;

  constructor(uri: string) {
    this.pool = new Pool({
      connectionString: uri,
      // 连接池配置
      max: 20, // 最大连接数
      min: 2,  // 最小连接数
      idleTimeoutMillis: 30000, // 空闲连接超时
      connectionTimeoutMillis: 2000, // 连接超时
    });

    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
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
        groups JSONB,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users("authProvider");
      CREATE INDEX IF NOT EXISTS idx_users_provider_external ON users("authProvider", "externalId");
    `;

    const client = await this.pool.connect();
    try {
      await client.query(createTableSQL);
    } finally {
      client.release();
    }
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
      groups: row.groups || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadata || undefined,
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
      groups: user.groups || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      metadata: user.metadata || null,
    };
  }

  async findById(sub: string): Promise<UserInfo | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM users WHERE sub = $1', [sub]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findByUsername(username: string): Promise<UserInfo | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM users WHERE username = $1', [username]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findByEmail(email: string): Promise<UserInfo | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findByProviderAndExternalId(
    provider: string,
    externalId: string
  ): Promise<UserInfo | null> {
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
    userData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt' | 'externalId' | 'authProvider'>
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
    const userToCreate: Omit<UserInfo, 'sub'> = {
      ...userData,
      authProvider: provider,
      externalId: externalId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return await this.create(userToCreate);
  }

  async create(userData: Omit<UserInfo, 'sub'>): Promise<UserInfo> {
    const now = new Date();

    // 如果提供了 authProvider 和 externalId，使用哈希生成确定性的 sub
    const sub = userData.authProvider && userData.externalId
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `;

    const client = await this.pool.connect();
    try {
      await client.query(sql, [
        row.sub, row.username, row.name, row.email, row.picture, row.phone, row.authProvider,
        row.externalId, row.emailVerified, row.phoneVerified, row.groups,
        row.createdAt, row.updatedAt, row.metadata
      ]);
      return user;
    } finally {
      client.release();
    }
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
      updatedAt: new Date(),
    };

    const row = this.userToRow(updatedUser);

    const sql = `
      UPDATE users SET
        username = $1, name = $2, email = $3, picture = $4, phone = $5, "authProvider" = $6,
        "externalId" = $7,
        "emailVerified" = $8, "phoneVerified" = $9, groups = $10, "updatedAt" = $11, metadata = $12
      WHERE sub = $13
    `;

    const client = await this.pool.connect();
    try {
      await client.query(sql, [
        row.username, row.name, row.email, row.picture, row.phone, row.authProvider,
        row.externalId,
        row.emailVerified, row.phoneVerified, row.groups, row.updatedAt, row.metadata,
        sub
      ]);
      return updatedUser;
    } finally {
      client.release();
    }
  }

  async delete(sub: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM users WHERE sub = $1', [sub]);
    } finally {
      client.release();
    }
  }

  async list(options?: ListOptions): Promise<UserInfo[]> {
    let sql = 'SELECT * FROM users';
    const params: any[] = [];
    let paramIndex = 1;

    // 过滤
    const conditions: string[] = [];
    if (options?.filter) {
      for (const [key, value] of Object.entries(options.filter)) {
        if (['username', 'name', 'email', 'authProvider'].includes(key)) {
          const columnName = key === 'authProvider' ? '"authProvider"' : key;
          conditions.push(`${columnName} = $${paramIndex++}`);
          params.push(value);
        }
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // 排序
    if (options?.sortBy) {
      const sortBy = options.sortBy === 'authProvider' ? '"authProvider"' : options.sortBy;
      const sortOrder = options.sortOrder === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${sortBy} ${sortOrder}`;
    }

    // 分页
    if (options?.limit !== undefined) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }
    if (options?.offset !== undefined) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(options.offset);
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows.map(row => this.userFromRow(row));
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM users');
    } finally {
      client.release();
    }
  }

  /**
   * 获取用户数量（用于调试）
   */
  async size(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT COUNT(*) as count FROM users');
      return parseInt(result.rows[0].count, 10);
    } finally {
      client.release();
    }
  }

  /**
   * 关闭连接池
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}