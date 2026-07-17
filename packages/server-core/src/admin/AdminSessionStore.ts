/**
 * 后台 BFF 会话存储
 */

import { randomBytes } from "crypto";
import type { AdminSession } from "../types/admin.js";
import type { StateStore } from "../types/auth.js";

export const ADMIN_LOGIN_STATE_TTL_SECONDS = 600;
export const ADMIN_LOGIN_START_RATE_LIMIT = 30;
export const ADMIN_LOGIN_START_RATE_WINDOW_SECONDS = 60;

export interface AdminLoginState {
  returnTo: string;
  bindingHash: string;
}

interface StoredAdminLoginState extends AdminLoginState {
  expiresAt: number;
}

interface AdminLoginRateEntry {
  count: number;
  expiresAt: number;
}

export class AdminLoginStateLimitError extends Error {
  constructor() {
    super("Too many admin login states");
    this.name = "AdminLoginStateLimitError";
  }
}

export interface AdminSessionStoreLike {
  createSession(userId: string): AdminSession | Promise<AdminSession>;
  getSession(id: string): AdminSession | null | Promise<AdminSession | null>;
  deleteSession(id: string): void | Promise<void>;
  checkLoginRateLimit(keys: string[]): void | Promise<void>;
  createLoginState(returnTo: string, bindingHash: string): string | Promise<string>;
  consumeLoginState(state: string): AdminLoginState | null | Promise<AdminLoginState | null>;
  clear(): void | Promise<void>;
}

/**
 * 后台 BFF 会话存储
 */
export class AdminSessionStore {
  private sessions = new Map<string, AdminSession>();
  private loginStates = new Map<string, StoredAdminLoginState>();
  private loginRateEntries = new Map<string, AdminLoginRateEntry>();
  private loginStateTtlMs: number;
  private maxLoginStates: number;
  private maxSessions: number;
  private loginRateLimit: number;
  private loginRateWindowMs: number;

  constructor(
    private sessionTtlSeconds: number,
    loginStateTtlSeconds: number = ADMIN_LOGIN_STATE_TTL_SECONDS,
    maxLoginStates: number = 1000,
    maxSessions: number = 1000,
    loginRateLimit: number = ADMIN_LOGIN_START_RATE_LIMIT,
    loginRateWindowSeconds: number = ADMIN_LOGIN_START_RATE_WINDOW_SECONDS,
  ) {
    this.loginStateTtlMs = Math.max(1, loginStateTtlSeconds) * 1000;
    this.maxLoginStates = Math.max(1, maxLoginStates);
    this.maxSessions = Math.max(1, maxSessions);
    this.loginRateLimit = Math.max(1, loginRateLimit);
    this.loginRateWindowMs = Math.max(1, loginRateWindowSeconds) * 1000;
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
   * 按来源和浏览器限制登录启动频率。
   */
  checkLoginRateLimit(keys: string[]): void {
    const now = Date.now();
    for (const [key, entry] of this.loginRateEntries.entries()) {
      if (entry.expiresAt <= now) {
        this.loginRateEntries.delete(key);
      }
    }
    const uniqueKeys = [...new Set(keys)];
    const newKeyCount = uniqueKeys.filter((key) => !this.loginRateEntries.has(key)).length;
    if (this.loginRateEntries.size + newKeyCount > this.maxLoginStates) {
      throw new AdminLoginStateLimitError();
    }
    const entries = uniqueKeys.map((key) => {
      const current = this.loginRateEntries.get(key);
      return {
        key,
        entry:
          current && current.expiresAt > now
            ? current
            : { count: 0, expiresAt: now + this.loginRateWindowMs },
      };
    });

    if (entries.some(({ entry }) => entry.count >= this.loginRateLimit)) {
      throw new AdminLoginStateLimitError();
    }

    for (const { key, entry } of entries) {
      this.loginRateEntries.set(key, { ...entry, count: entry.count + 1 });
    }
  }

  /**
   * 创建 OAuth state
   */
  createLoginState(returnTo: string, bindingHash: string): string {
    this.purgeExpiredLoginStates();
    if (this.loginStates.size >= this.maxLoginStates) {
      throw new AdminLoginStateLimitError();
    }

    const state = randomBytes(32).toString("hex");
    this.loginStates.set(state, {
      returnTo,
      bindingHash,
      expiresAt: Date.now() + this.loginStateTtlMs,
    });
    return state;
  }

  /**
   * 验证并消费 OAuth state
   * @param state OAuth state
   */
  consumeLoginState(state: string): AdminLoginState | null {
    this.purgeExpiredLoginStates();

    const loginState = this.loginStates.get(state);
    if (!loginState) {
      return null;
    }

    this.loginStates.delete(state);
    if (Date.now() > loginState.expiresAt) {
      return null;
    }

    return {
      returnTo: loginState.returnTo,
      bindingHash: loginState.bindingHash,
    };
  }

  /**
   * 清空会话
   */
  clear(): void {
    this.sessions.clear();
    this.loginStates.clear();
    this.loginRateEntries.clear();
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
}

/**
 * Redis stateStore 的后台会话实现。OAuth state 用 take() 原子消费，后台 session
 * 可在任意实例读取，避免负载均衡时登录回调或后续请求落到不同节点而失效。
 */
export class DistributedAdminSessionStore implements AdminSessionStoreLike {
  private readonly loginStateTtlSeconds: number;
  private readonly maxLoginStates: number;
  private readonly loginRateLimit: number;
  private readonly loginRateWindowSeconds: number;

  constructor(
    private readonly stateStore: StateStore,
    private readonly sessionTtlSeconds: number,
    loginStateTtlSeconds = ADMIN_LOGIN_STATE_TTL_SECONDS,
    maxLoginStates = 1000,
    loginRateLimit = ADMIN_LOGIN_START_RATE_LIMIT,
    loginRateWindowSeconds = ADMIN_LOGIN_START_RATE_WINDOW_SECONDS,
  ) {
    this.loginStateTtlSeconds = Math.max(1, loginStateTtlSeconds);
    this.maxLoginStates = Math.max(1, maxLoginStates);
    this.loginRateLimit = Math.max(1, loginRateLimit);
    this.loginRateWindowSeconds = Math.max(1, loginRateWindowSeconds);
  }

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

  async checkLoginRateLimit(keys: string[]): Promise<void> {
    const window = Math.floor(Date.now() / (this.loginRateWindowSeconds * 1000));
    for (const key of new Set(keys)) {
      const count = await this.stateStore.increment(
        `admin:login-start-rate:${key}:${window}`,
        this.loginRateWindowSeconds,
      );
      if (count > this.loginRateLimit) {
        throw new AdminLoginStateLimitError();
      }
    }
  }

  async createLoginState(returnTo: string, bindingHash: string): Promise<string> {
    const state = randomBytes(32).toString("hex");
    const stateKey = this.loginStateKey(state);
    if (this.stateStore.setBounded) {
      const stored = await this.stateStore.setBounded(
        stateKey,
        { returnTo, bindingHash },
        this.loginStateTtlSeconds,
        this.loginStateCollectionKey(),
        this.maxLoginStates,
      );
      if (!stored) {
        throw new AdminLoginStateLimitError();
      }
      return state;
    }

    // 自定义 StateStore 可能尚未实现有界集合能力；用原子固定窗口计数
    // 限制最多创建的 state 数，避免退回到无界写入。
    const window = Math.floor(Date.now() / (this.loginStateTtlSeconds * 1000));
    const count = await this.stateStore.increment(
      `admin:login-state-rate:${window}`,
      this.loginStateTtlSeconds,
    );
    if (count > this.maxLoginStates) {
      throw new AdminLoginStateLimitError();
    }

    await this.stateStore.set(stateKey, { returnTo, bindingHash }, this.loginStateTtlSeconds);
    return state;
  }

  async consumeLoginState(state: string): Promise<AdminLoginState | null> {
    const entry = (await this.stateStore.take(
      this.loginStateKey(state),
      this.loginStateCollectionKey(),
    )) as AdminLoginState | null;
    if (!entry || typeof entry.returnTo !== "string" || typeof entry.bindingHash !== "string") {
      return null;
    }
    return { returnTo: entry.returnTo, bindingHash: entry.bindingHash };
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

  private loginStateCollectionKey(): string {
    return "admin:login-states";
  }
}
