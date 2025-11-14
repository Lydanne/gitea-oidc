import { Pool } from 'pg';
import { randomUUID } from 'crypto';
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
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        picture TEXT,
        phone TEXT,
        auth_provider TEXT NOT NULL,
        email_verified INTEGER,
        phone_verified INTEGER,
        groups JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);
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
      sub: row.id,
      username: row.username,
      name: row.name,
      email: row.email,
      picture: row.picture || undefined,
      phone: row.phone || undefined,
      authProvider: row.auth_provider,
      ...(row.email_verified !== null ? { email_verified: !!row.email_verified } : {}),
      ...(row.phone_verified !== null ? { phone_verified: !!row.phone_verified } : {}),
      groups: row.groups || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata || undefined,
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
      groups: user.groups || null,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      metadata: user.metadata || null,
    };
  }

  async findById(userId: string): Promise<UserInfo | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
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
        WHERE auth_provider = $1
        AND metadata->>'externalId' = $2
      `;
      const result = await client.query(sql, [provider, externalId]);
      return result.rows.length > 0 ? this.userFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
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

    return await this.create(userToCreate, criteria.externalId);
  }

  async create(userData: Omit<UserInfo, 'sub'>, externalId?: string): Promise<UserInfo> {
    const user: UserInfo = {
      ...userData,
      sub: randomUUID(),
      createdAt: userData.createdAt || new Date(),
      updatedAt: userData.updatedAt || new Date(),
      metadata: externalId ? { ...userData.metadata, externalId } : userData.metadata,
    };

    const row = this.userToRow(user);

    const sql = `
      INSERT INTO users (
        id, username, name, email, picture, phone, auth_provider,
        email_verified, phone_verified, groups, created_at, updated_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    const client = await this.pool.connect();
    try {
      await client.query(sql, [
        row.id, row.username, row.name, row.email, row.picture, row.phone, row.auth_provider,
        row.email_verified, row.phone_verified, row.groups, row.created_at, row.updated_at, row.metadata
      ]);
      return user;
    } finally {
      client.release();
    }
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
      updatedAt: new Date(),
    };

    const row = this.userToRow(updatedUser);

    const sql = `
      UPDATE users SET
        username = $1, name = $2, email = $3, picture = $4, phone = $5, auth_provider = $6,
        email_verified = $7, phone_verified = $8, groups = $9, updated_at = $10, metadata = $11
      WHERE id = $12
    `;

    const client = await this.pool.connect();
    try {
      await client.query(sql, [
        row.username, row.name, row.email, row.picture, row.phone, row.auth_provider,
        row.email_verified, row.phone_verified, row.groups, row.updated_at, row.metadata,
        userId
      ]);
      return updatedUser;
    } finally {
      client.release();
    }
  }

  async delete(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
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
          const columnName = key === 'authProvider' ? 'auth_provider' : key;
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
      const sortBy = options.sortBy === 'authProvider' ? 'auth_provider' : options.sortBy;
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