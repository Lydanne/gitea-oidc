/**
 * Redis State 存储。
 *
 * 认证 state、OAuth callback 结果和后台会话都可以复用此存储；所有数据带 TTL，
 * `take` 用 Lua 在 Redis 内原子地读取并删除，适用于多实例部署。
 */

import { createClient } from "redis";
import type { RedisOidcAdapterOptions } from "../adapters/RedisOidcAdapter.js";
import type { StateStore } from "../types/auth.js";

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

  async setBounded(
    state: string,
    data: any,
    ttl: number,
    collection: string,
    maxSize: number,
  ): Promise<boolean> {
    const client = await this.clientPromise;
    const ttlSeconds = Math.max(1, Math.floor(ttl));
    const now = Date.now();
    const result = await client.eval(
      [
        "local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])",
        "for _, stateKey in ipairs(expired) do",
        "  redis.call('DEL', stateKey)",
        "  redis.call('ZREM', KEYS[2], stateKey)",
        "end",
        "local existing = redis.call('ZSCORE', KEYS[2], KEYS[1])",
        "if not existing and redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then",
        "  return 0",
        "end",
        "redis.call('SETEX', KEYS[1], ARGV[3], ARGV[5])",
        "redis.call('ZADD', KEYS[2], ARGV[2], KEYS[1])",
        "redis.call('EXPIRE', KEYS[2], ARGV[3])",
        "return 1",
      ].join("\n"),
      {
        keys: [this.key(state), this.key(collection)],
        arguments: [
          String(now),
          String(now + ttlSeconds * 1000),
          String(ttlSeconds),
          String(Math.max(1, Math.floor(maxSize))),
          JSON.stringify(data),
        ],
      },
    );
    return Number(result) === 1;
  }

  async get(state: string): Promise<any> {
    const client = await this.clientPromise;
    return parseStoredValue(await client.get(this.key(state)));
  }

  async take(state: string, boundedCollection?: string): Promise<any> {
    const client = await this.clientPromise;
    const value = await client.eval(
      [
        "local value = redis.call('GET', KEYS[1])",
        "if value then redis.call('DEL', KEYS[1]) end",
        "if #KEYS > 1 then redis.call('ZREM', KEYS[2], KEYS[1]) end",
        "return value",
      ].join("\n"),
      {
        keys: boundedCollection
          ? [this.key(state), this.key(boundedCollection)]
          : [this.key(state)],
        arguments: [],
      },
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
