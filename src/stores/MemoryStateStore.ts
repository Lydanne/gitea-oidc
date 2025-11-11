/**
 * 内存 State 存储实现
 * 用于开发和测试环境
 */

import type { StateStore } from '../types/auth';

interface StateEntry {
  data: any;
  expiresAt: number;
}

export class MemoryStateStore implements StateStore {
  private states = new Map<string, StateEntry>();
  private cleanupInterval?: NodeJS.Timeout;
  
  // 配置参数
  private readonly maxSize: number;
  private readonly cleanupIntervalMs: number;
  
  // 统计信息
  private stats = {
    hits: 0,
    misses: 0,
    expired: 0,
    evicted: 0,
  };

  constructor(options: {
    maxSize?: number;           // 最大存储数量，默认10000
    cleanupIntervalMs?: number; // 清理间隔，默认60000ms
  } = {}) {
    this.maxSize = options.maxSize || 10000;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60000;
    
    // 定期清理过期的 state
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  async set(state: string, data: any, ttl: number): Promise<void> {
    // 检查内存限制，必要时清理过期数据
    if (this.states.size >= this.maxSize) {
      await this.cleanup();
      
      // 如果仍然超过限制，使用LRU策略清理
      if (this.states.size >= this.maxSize) {
        await this.evictOldest();
      }
    }
    
    const expiresAt = Date.now() + ttl * 1000;
    this.states.set(state, { data, expiresAt });
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MemoryStateStore] Stored state: ${state.substring(0, 8)}..., type: ${this.getDataType(data)}, total: ${this.states.size}/${this.maxSize}`);
    }
  }

  async get(state: string): Promise<any> {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MemoryStateStore] Getting state: ${state.substring(0, 8)}..., total: ${this.states.size}`);
    }
    
    const entry = this.states.get(state);
    
    if (!entry) {
      this.stats.misses++;
      if (process.env.NODE_ENV === 'development') {
        console.log(`[MemoryStateStore] State not found: ${state.substring(0, 8)}...`);
      }
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.stats.expired++;
      this.states.delete(state);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[MemoryStateStore] State expired: ${state.substring(0, 8)}...`);
      }
      return null;
    }

    this.stats.hits++;
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MemoryStateStore] State found: ${state.substring(0, 8)}..., type: ${this.getDataType(entry.data)}`);
    }
    return entry.data;
  }

  async delete(state: string): Promise<void> {
    const existed = this.states.has(state);
    this.states.delete(state);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MemoryStateStore] Deleted state: ${state.substring(0, 8)}..., existed: ${existed}, remaining: ${this.states.size}`);
    }
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const expiredStates: string[] = [];

    for (const [state, entry] of this.states.entries()) {
      if (now > entry.expiresAt) {
        expiredStates.push(state);
      }
    }

    for (const state of expiredStates) {
      this.states.delete(state);
    }

    if (expiredStates.length > 0) {
      console.log(`[StateStore] Cleaned up ${expiredStates.length} expired states`);
    }
  }

  /**
   * LRU清理：移除最旧的数据
   */
  private async evictOldest(): Promise<void> {
    const now = Date.now();
    let oldestKey: string | null = null;
    let oldestTime = now;

    // 找到最旧的数据（过期时间最早的）
    for (const [key, entry] of this.states.entries()) {
      if (entry.expiresAt < oldestTime) {
        oldestTime = entry.expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.states.delete(oldestKey);
      this.stats.evicted++;
      console.log(`[StateStore] Evicted oldest state: ${oldestKey.substring(0, 8)}...`);
    }
  }

  /**
   * 销毁存储，清理定时器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.states.clear();
  }

  /**
   * 获取当前存储的 state 数量（用于调试）
   */
  size(): number {
    return this.states.size;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    totalRequests: number;
    hits: number;
    misses: number;
    expired: number;
    evicted: number;
  } {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

    return {
      size: this.states.size,
      maxSize: this.maxSize,
      hitRate: Math.round(hitRate * 100) / 100, // 保留2位小数
      totalRequests,
      hits: this.stats.hits,
      misses: this.stats.misses,
      expired: this.stats.expired,
      evicted: this.stats.evicted,
    };
  }

  /**
   * 列出所有存储的 state（用于调试）
   */
  listAll(): Array<{ state: string; type: string; age: number; data: any }> {
    const now = Date.now();
    const result: Array<{ state: string; type: string; age: number; data: any }> = [];

    for (const [state, entry] of this.states.entries()) {
      result.push({
        state: state.substring(0, 16) + '...',
        type: this.getDataType(entry.data),
        age: now - (entry.data.createdAt || entry.data.timestamp || 0),
        data: entry.data,
      });
    }

    return result;
  }

  /**
   * 获取数据的类型描述
   */
  private getDataType(data: any): string {
    if (!data) return 'null';

    if (typeof data === 'object') {
      if ('type' in data) {
        return data.type;
      }
      if ('provider' in data) {
        return 'oauth_state';
      }
      if ('userId' in data) {
        return 'auth_result';
      }
      return 'object';
    }

    return typeof data;
  }
}
