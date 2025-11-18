/**
 * Redis OIDC 适配器
 * 
 * 使用 Redis 作为 OIDC Provider 的持久化存储
 * 适合高并发和分布式部署场景
 */

import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { Adapter } from 'oidc-provider';

export interface RedisOidcAdapterOptions {
  /**
   * Redis 连接 URL
   * 格式: redis://[:password@]host[:port][/db-number]
   * 示例: redis://localhost:6379
   */
  url?: string;
  
  /**
   * Redis 主机地址
   * @default 'localhost'
   */
  host?: string;
  
  /**
   * Redis 端口
   * @default 6379
   */
  port?: number;
  
  /**
   * Redis 密码
   */
  password?: string;
  
  /**
   * Redis 数据库编号
   * @default 0
   */
  database?: number;
  
  /**
   * 键前缀
   * @default 'oidc:'
   */
  keyPrefix?: string;
}

export class RedisOidcAdapter implements Adapter {
  private static client: any = null;
  private static clientPromise: Promise<any> | null = null;
  private name: string;
  private keyPrefix: string;

  constructor(name: string, options: RedisOidcAdapterOptions = {}) {
    this.name = name;
    this.keyPrefix = options.keyPrefix || 'oidc:';
    
    // 确保 Redis 客户端已初始化
    if (!RedisOidcAdapter.client && !RedisOidcAdapter.clientPromise) {
      RedisOidcAdapter.clientPromise = this.initializeClient(options);
    }
  }

  /**
   * 初始化 Redis 客户端
   */
  private async initializeClient(options: RedisOidcAdapterOptions): Promise<any> {
    const client = createClient({
      url: options.url,
      socket: {
        host: options.host || 'localhost',
        port: options.port || 6379,
      },
      password: options.password,
      database: options.database || 0,
    });

    client.on('error', (err: Error) => {
      console.error('[RedisOidcAdapter] Redis Client Error:', err);
    });

    client.on('connect', () => {
      console.log('[RedisOidcAdapter] Redis Client Connected');
    });

    await client.connect();
    RedisOidcAdapter.client = client;
    return client;
  }

  /**
   * 获取 Redis 客户端实例
   */
  private async getClient(): Promise<any> {
    if (RedisOidcAdapter.client) {
      return RedisOidcAdapter.client;
    }
    
    if (RedisOidcAdapter.clientPromise) {
      return await RedisOidcAdapter.clientPromise;
    }
    
    throw new Error('Redis client not initialized');
  }

  /**
   * 生成 Redis 键
   */
  private key(id: string): string {
    return `${this.keyPrefix}${this.name}:${id}`;
  }

  /**
   * 生成用户代码索引键
   */
  private userCodeKey(userCode: string): string {
    return `${this.keyPrefix}userCode:${userCode}`;
  }

  /**
   * 生成 UID 索引键
   */
  private uidKey(uid: string): string {
    return `${this.keyPrefix}uid:${uid}`;
  }

  /**
   * 生成 grantId 索引键
   */
  private grantIdKey(grantId: string): string {
    return `${this.keyPrefix}grantId:${grantId}`;
  }

  /**
   * 插入或更新记录
   */
  async upsert(id: string, payload: any, expiresIn?: number): Promise<void> {
    const client = await this.getClient();
    const key = this.key(id);
    const value = JSON.stringify(payload);

    // 设置主键值
    if (expiresIn) {
      await client.setEx(key, expiresIn, value);
    } else {
      await client.set(key, value);
    }

    // 创建索引
    if (payload.userCode) {
      const userCodeKey = this.userCodeKey(payload.userCode);
      if (expiresIn) {
        await client.setEx(userCodeKey, expiresIn, id);
      } else {
        await client.set(userCodeKey, id);
      }
    }

    if (payload.uid) {
      const uidKey = this.uidKey(payload.uid);
      if (expiresIn) {
        await client.setEx(uidKey, expiresIn, id);
      } else {
        await client.set(uidKey, id);
      }
    }

    if (payload.grantId) {
      const grantIdKey = this.grantIdKey(payload.grantId);
      await client.sAdd(grantIdKey, id);
      if (expiresIn) {
        await client.expire(grantIdKey, expiresIn);
      }
    }
  }

  /**
   * 查找记录
   */
  async find(id: string): Promise<any> {
    const client = await this.getClient();
    const key = this.key(id);
    const value = await client.get(key);

    if (!value) {
      return undefined;
    }

    try {
      return JSON.parse(value);
    } catch (err) {
      console.error('[RedisOidcAdapter] JSON parse error:', err);
      return undefined;
    }
  }

  /**
   * 通过用户代码查找
   */
  async findByUserCode(userCode: string): Promise<any> {
    const client = await this.getClient();
    const userCodeKey = this.userCodeKey(userCode);
    const id = await client.get(userCodeKey);

    if (!id) {
      return undefined;
    }

    return this.find(id);
  }

  /**
   * 通过 UID 查找
   */
  async findByUid(uid: string): Promise<any> {
    const client = await this.getClient();
    const uidKey = this.uidKey(uid);
    const id = await client.get(uidKey);

    if (!id) {
      return undefined;
    }

    return this.find(id);
  }

  /**
   * 消费记录（标记为已使用）
   */
  async consume(id: string): Promise<any> {
    const client = await this.getClient();
    const key = this.key(id);
    
    // 获取当前值
    const value = await client.get(key);
    if (!value) {
      return undefined;
    }

    let payload: any;
    try {
      payload = JSON.parse(value);
    } catch (err) {
      console.error('[RedisOidcAdapter] JSON parse error:', err);
      return undefined;
    }

    // 检查是否已被消费
    if (payload.consumed) {
      return undefined;
    }

    // 标记为已消费
    payload.consumed = Math.floor(Date.now() / 1000);
    
    // 获取剩余 TTL
    const ttl = await client.ttl(key);
    
    // 更新值
    const newValue = JSON.stringify(payload);
    if (ttl > 0) {
      await client.setEx(key, ttl, newValue);
    } else {
      await client.set(key, newValue);
    }

    return payload;
  }

  /**
   * 删除记录
   */
  async destroy(id: string): Promise<void> {
    const client = await this.getClient();
    
    // 获取 payload 以清理索引
    const payload = await this.find(id);
    
    // 删除主键
    const key = this.key(id);
    await client.del(key);

    // 清理索引
    if (payload) {
      if (payload.userCode) {
        await client.del(this.userCodeKey(payload.userCode));
      }
      if (payload.uid) {
        await client.del(this.uidKey(payload.uid));
      }
      if (payload.grantId) {
        const grantIdKey = this.grantIdKey(payload.grantId);
        await client.sRem(grantIdKey, id);
      }
    }
  }

  /**
   * 通过 grantId 撤销所有相关记录
   */
  async revokeByGrantId(grantId: string): Promise<void> {
    const client = await this.getClient();
    const grantIdKey = this.grantIdKey(grantId);
    
    // 获取所有关联的 ID
    const ids = await client.sMembers(grantIdKey);
    
    if (ids.length === 0) {
      return;
    }

    // 删除所有关联的记录
    const pipeline = client.multi();
    
    for (const id of ids) {
      pipeline.del(this.key(id));
    }
    
    // 删除 grantId 索引
    pipeline.del(grantIdKey);
    
    await pipeline.exec();
  }

  /**
   * 关闭 Redis 连接
   * 注意: 这会关闭所有适配器共享的连接
   */
  static async disconnect(): Promise<void> {
    if (RedisOidcAdapter.client) {
      await RedisOidcAdapter.client.quit();
      RedisOidcAdapter.client = null;
      RedisOidcAdapter.clientPromise = null;
      console.log('[RedisOidcAdapter] Redis Client Disconnected');
    }
  }
}
