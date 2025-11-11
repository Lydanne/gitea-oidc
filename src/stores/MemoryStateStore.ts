/**
 * 内存 State 存储实现
 * 用于开发和测试环境
 */

import type { StateStore, OAuthStateData } from '../types/auth.js';

interface StateEntry {
  data: OAuthStateData;
  expiresAt: number;
}

export class MemoryStateStore implements StateStore {
  private states = new Map<string, StateEntry>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(cleanupIntervalMs = 60000) {
    // 定期清理过期的 state
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async set(state: string, data: OAuthStateData, ttl: number): Promise<void> {
    const expiresAt = Date.now() + ttl * 1000;
    this.states.set(state, { data, expiresAt });
    console.log(`[MemoryStateStore] Stored state: ${state.substring(0, 8)}..., total states: ${this.states.size}, expiresIn: ${ttl}s`);
  }

  async get(state: string): Promise<OAuthStateData | null> {
    console.log(`[MemoryStateStore] Getting state: ${state.substring(0, 8)}..., total states: ${this.states.size}`);
    const entry = this.states.get(state);
    
    if (!entry) {
      console.log(`[MemoryStateStore] State not found: ${state.substring(0, 8)}...`);
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      console.log(`[MemoryStateStore] State expired: ${state.substring(0, 8)}...`);
      this.states.delete(state);
      return null;
    }

    console.log(`[MemoryStateStore] State found: ${state.substring(0, 8)}..., provider: ${entry.data.provider}`);
    return entry.data;
  }

  async delete(state: string): Promise<void> {
    const existed = this.states.has(state);
    this.states.delete(state);
    console.log(`[MemoryStateStore] Deleted state: ${state.substring(0, 8)}..., existed: ${existed}, remaining: ${this.states.size}`);
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
   * 列出所有存储的 state（用于调试）
   */
  listAll(): Array<{ state: string; provider: string; interactionUid: string; age: number }> {
    const now = Date.now();
    const result: Array<{ state: string; provider: string; interactionUid: string; age: number }> = [];
    
    for (const [state, entry] of this.states.entries()) {
      result.push({
        state: state.substring(0, 16) + '...',
        provider: entry.data.provider,
        interactionUid: entry.data.interactionUid,
        age: now - entry.data.createdAt,
      });
    }
    
    return result;
  }
}
