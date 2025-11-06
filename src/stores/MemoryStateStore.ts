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
  }

  async get(state: string): Promise<OAuthStateData | null> {
    const entry = this.states.get(state);
    
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.states.delete(state);
      return null;
    }

    return entry.data;
  }

  async delete(state: string): Promise<void> {
    this.states.delete(state);
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
}
