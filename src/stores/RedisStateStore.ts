/**
 * Redis State 存储。
 *
 * 认证 state、OAuth callback 结果和后台会话都可以复用此存储；所有数据带 TTL，
 * `take` 用 Lua 在 Redis 内原子地读取并删除，适用于多实例部署。
 */

import { createClient } from "redis";
import type { RedisOidcAdapterOptions } from "../adapters/RedisOidcAdapter";
import type { StateStore } from "../types/auth";

export class RedisStateStore implements StateStore {
  private clientPromise: Promise<any>;
  private readonly keyPrefix: string;

  constructor(options: RedisOidcAdapterOptions, keyPrefix = "gitea-oidc:state:") {
    this.keyPrefix = keyPrefix;
    this.clientPromise = this.createClient(options);
  }

  private async createClient(options: RedisOidcAdapterOptions): Promise<any> {
    const client = createClient({
      url: options.url,
      socket: {
        host: options.host || "localhost",
        port: options.port || 6379,
      },
      password: options.password,
      database: options.database || 0,
    });
    await client.connect();
    return client;
  }

  private key(state: string): string {
    return `${this.keyPrefix}${state}`;
  }

  async set(state: string, data: any, ttl: number): Promise<void> {
    const client = await this.clientPromise;
    await client.setEx(this.key(state), Math.max(1, Math.floor(ttl)), JSON.stringify(data));
  }

  async get(state: string): Promise<any> {
    const client = await this.clientPromise;
    return parseStoredValue(await client.get(this.key(state)));
  }

  async take(state: string): Promise<any> {
    const client = await this.clientPromise;
    const value = await client.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      { keys: [this.key(state)], arguments: [] },
    );
    return parseStoredValue(value);
  }

  async increment(state: string, ttl: number): Promise<number> {
    const client = await this.clientPromise;
    const value = await client.eval(
      "local value = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return value",
      {
        keys: [this.key(state)],
        arguments: [String(Math.max(1, Math.floor(ttl)))],
      },
    );
    return Number(value);
  }

  async delete(state: string): Promise<void> {
    const client = await this.clientPromise;
    await client.del(this.key(state));
  }

  async destroy(): Promise<void> {
    const client = await this.clientPromise;
    if (client.isOpen) {
      await client.quit();
    }
  }
}

function parseStoredValue(value: string | null): any {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
