/**
 * 后台 BFF 会话存储
 */

import { randomBytes } from "crypto";
import type { AdminSession } from "../types/admin";
import type { StateStore } from "../types/auth";

interface AdminLoginState {
  returnTo: string;
  expiresAt: number;
}

export interface AdminSessionStoreLike {
  createSession(userId: string): AdminSession | Promise<AdminSession>;
  getSession(id: string): AdminSession | null | Promise<AdminSession | null>;
  deleteSession(id: string): void | Promise<void>;
  createLoginState(returnTo: string): string | Promise<string>;
  consumeLoginState(state: string): string | null | Promise<string | null>;
  clear(): void | Promise<void>;
}

/**
 * 后台 BFF 会话存储
 */
export class AdminSessionStore {
  private sessions = new Map<string, AdminSession>();
  private loginStates = new Map<string, AdminLoginState>();
  private loginStateTtlMs: number;
  private maxLoginStates: number;
  private maxSessions: number;

  constructor(
    private sessionTtlSeconds: number,
    loginStateTtlSeconds: number = 600,
    maxLoginStates: number = 1000,
    maxSessions: number = 1000,
  ) {
    this.loginStateTtlMs = Math.max(1, loginStateTtlSeconds) * 1000;
    this.maxLoginStates = Math.max(1, maxLoginStates);
    this.maxSessions = Math.max(1, maxSessions);
  }

  /**
   * 创建后台会话
   * @param userId 用户 ID
   * @returns 会话记录
   */
  createSession(userId: string): AdminSession {
    this.purgeExpiredSessions();
    this.enforceSessionLimit();

    const session: AdminSession = {
      id: randomBytes(32).toString("hex"),
      userId,
      expiresAt: Date.now() + this.sessionTtlSeconds * 1000,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * 获取后台会话
   * @param id 会话 ID
   */
  getSession(id: string): AdminSession | null {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(id);
      return null;
    }

    return session;
  }

  /**
   * 删除后台会话
   * @param id 会话 ID
   */
  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  /**
   * 创建 OAuth state
   */
  createLoginState(returnTo: string): string {
    this.purgeExpiredLoginStates();
    this.enforceLoginStateLimit();

    const state = randomBytes(32).toString("hex");
    this.loginStates.set(state, {
      returnTo,
      expiresAt: Date.now() + this.loginStateTtlMs,
    });
    return state;
  }

  /**
   * 验证并消费 OAuth state
   * @param state OAuth state
   */
  consumeLoginState(state: string): string | null {
    this.purgeExpiredLoginStates();

    const loginState = this.loginStates.get(state);
    if (!loginState) {
      return null;
    }

    this.loginStates.delete(state);
    if (Date.now() > loginState.expiresAt) {
      return null;
    }

    return loginState.returnTo;
  }

  /**
   * 清空会话
   */
  clear(): void {
    this.sessions.clear();
    this.loginStates.clear();
  }

  private purgeExpiredLoginStates(): void {
    const now = Date.now();
    for (const [state, loginState] of this.loginStates.entries()) {
      if (now > loginState.expiresAt) {
        this.loginStates.delete(state);
      }
    }
  }

  private purgeExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }

  private enforceSessionLimit(): void {
    while (this.sessions.size >= this.maxSessions) {
      const oldestSessionId = this.sessions.keys().next().value;
      if (!oldestSessionId) {
        return;
      }
      this.sessions.delete(oldestSessionId);
    }
  }

  private enforceLoginStateLimit(): void {
    while (this.loginStates.size >= this.maxLoginStates) {
      const oldestState = this.loginStates.keys().next().value;
      if (!oldestState) {
        return;
      }
      this.loginStates.delete(oldestState);
    }
  }
}

/**
 * Redis stateStore 的后台会话实现。OAuth state 用 take() 原子消费，后台 session
 * 可在任意实例读取，避免负载均衡时登录回调或后续请求落到不同节点而失效。
 */
export class DistributedAdminSessionStore implements AdminSessionStoreLike {
  constructor(
    private readonly stateStore: StateStore,
    private readonly sessionTtlSeconds: number,
    private readonly loginStateTtlSeconds = 600,
  ) {}

  async createSession(userId: string): Promise<AdminSession> {
    const session: AdminSession = {
      id: randomBytes(32).toString("hex"),
      userId,
      expiresAt: Date.now() + this.sessionTtlSeconds * 1000,
    };
    await this.stateStore.set(this.sessionKey(session.id), session, this.sessionTtlSeconds);
    return session;
  }

  async getSession(id: string): Promise<AdminSession | null> {
    const session = (await this.stateStore.get(this.sessionKey(id))) as AdminSession | null;
    if (!session || Date.now() > session.expiresAt) {
      if (session) await this.deleteSession(id);
      return null;
    }
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await this.stateStore.delete(this.sessionKey(id));
  }

  async createLoginState(returnTo: string): Promise<string> {
    const state = randomBytes(32).toString("hex");
    await this.stateStore.set(this.loginStateKey(state), { returnTo }, this.loginStateTtlSeconds);
    return state;
  }

  async consumeLoginState(state: string): Promise<string | null> {
    const entry = (await this.stateStore.take(this.loginStateKey(state))) as AdminLoginState | null;
    return entry?.returnTo ?? null;
  }

  async clear(): Promise<void> {
    // 所有 Redis key 都有 TTL；实例本地没有可枚举的 session 列表。
  }

  private sessionKey(id: string): string {
    return `admin:session:${id}`;
  }

  private loginStateKey(state: string): string {
    return `admin:login-state:${state}`;
  }
}
