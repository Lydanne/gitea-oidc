/**
 * 用户门户 BFF 会话与登录 state 存储。
 */

import { randomBytes } from "crypto";
import type { StateStore } from "../types/auth.js";
import type { PortalSession } from "../types/portal.js";

export const PORTAL_LOGIN_STATE_TTL_SECONDS = 600;
export const PORTAL_LOGIN_START_RATE_LIMIT = 30;
export const PORTAL_LOGIN_START_RATE_WINDOW_SECONDS = 60;

export interface PortalLoginState {
  returnTo: string;
  bindingHash: string;
  codeVerifier: string;
}

interface StoredPortalLoginState extends PortalLoginState {
  expiresAt: number;
}

interface PortalLoginRateEntry {
  count: number;
  expiresAt: number;
}

export class PortalLoginStateLimitError extends Error {
  constructor() {
    super("Too many portal login states");
    this.name = "PortalLoginStateLimitError";
  }
}

export interface PortalSessionStoreLike {
  createSession(userId: string): PortalSession | Promise<PortalSession>;
  getSession(id: string): PortalSession | null | Promise<PortalSession | null>;
  deleteSession(id: string): void | Promise<void>;
  checkLoginRateLimit(keys: string[]): void | Promise<void>;
  createLoginState(
    returnTo: string,
    bindingHash: string,
    codeVerifier: string,
  ): string | Promise<string>;
  consumeLoginState(state: string): PortalLoginState | null | Promise<PortalLoginState | null>;
  clear(): void | Promise<void>;
}

/** 单实例使用的有界内存存储。 */
export class PortalSessionStore implements PortalSessionStoreLike {
  private readonly sessions = new Map<string, PortalSession>();
  private readonly loginStates = new Map<string, StoredPortalLoginState>();
  private readonly loginRateEntries = new Map<string, PortalLoginRateEntry>();
  private readonly loginStateTtlMs: number;
  private readonly maxLoginStates: number;
  private readonly maxSessions: number;
  private readonly loginRateLimit: number;
  private readonly loginRateWindowMs: number;

  constructor(
    private readonly sessionTtlSeconds: number,
    loginStateTtlSeconds = PORTAL_LOGIN_STATE_TTL_SECONDS,
    maxLoginStates = 1000,
    maxSessions = 10_000,
    loginRateLimit = PORTAL_LOGIN_START_RATE_LIMIT,
    loginRateWindowSeconds = PORTAL_LOGIN_START_RATE_WINDOW_SECONDS,
  ) {
    this.loginStateTtlMs = Math.max(1, loginStateTtlSeconds) * 1000;
    this.maxLoginStates = Math.max(1, maxLoginStates);
    this.maxSessions = Math.max(1, maxSessions);
    this.loginRateLimit = Math.max(1, loginRateLimit);
    this.loginRateWindowMs = Math.max(1, loginRateWindowSeconds) * 1000;
  }

  createSession(userId: string): PortalSession {
    this.purgeExpiredSessions();
    this.enforceSessionLimit();
    const session: PortalSession = {
      id: randomBytes(32).toString("hex"),
      userId,
      expiresAt: Date.now() + Math.max(1, this.sessionTtlSeconds) * 1000,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): PortalSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  checkLoginRateLimit(keys: string[]): void {
    const now = Date.now();
    for (const [key, entry] of this.loginRateEntries.entries()) {
      if (entry.expiresAt <= now) this.loginRateEntries.delete(key);
    }

    const uniqueKeys = [...new Set(keys)];
    const newKeyCount = uniqueKeys.filter((key) => !this.loginRateEntries.has(key)).length;
    if (this.loginRateEntries.size + newKeyCount > this.maxLoginStates) {
      throw new PortalLoginStateLimitError();
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
      throw new PortalLoginStateLimitError();
    }
    for (const { key, entry } of entries) {
      this.loginRateEntries.set(key, { ...entry, count: entry.count + 1 });
    }
  }

  createLoginState(returnTo: string, bindingHash: string, codeVerifier: string): string {
    this.purgeExpiredLoginStates();
    if (this.loginStates.size >= this.maxLoginStates) {
      throw new PortalLoginStateLimitError();
    }
    const state = randomBytes(32).toString("hex");
    this.loginStates.set(state, {
      returnTo,
      bindingHash,
      codeVerifier,
      expiresAt: Date.now() + this.loginStateTtlMs,
    });
    return state;
  }

  consumeLoginState(state: string): PortalLoginState | null {
    this.purgeExpiredLoginStates();
    const entry = this.loginStates.get(state);
    if (!entry) return null;
    this.loginStates.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return {
      returnTo: entry.returnTo,
      bindingHash: entry.bindingHash,
      codeVerifier: entry.codeVerifier,
    };
  }

  clear(): void {
    this.sessions.clear();
    this.loginStates.clear();
    this.loginRateEntries.clear();
  }

  private purgeExpiredLoginStates(): void {
    const now = Date.now();
    for (const [state, entry] of this.loginStates.entries()) {
      if (now > entry.expiresAt) this.loginStates.delete(state);
    }
  }

  private purgeExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) this.sessions.delete(id);
    }
  }

  private enforceSessionLimit(): void {
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) return;
      this.sessions.delete(oldest);
    }
  }
}

/** Redis stateStore 下可跨实例读取的门户会话实现。 */
export class DistributedPortalSessionStore implements PortalSessionStoreLike {
  private readonly loginStateTtlSeconds: number;
  private readonly maxLoginStates: number;
  private readonly loginRateLimit: number;
  private readonly loginRateWindowSeconds: number;

  constructor(
    private readonly stateStore: StateStore,
    private readonly sessionTtlSeconds: number,
    loginStateTtlSeconds = PORTAL_LOGIN_STATE_TTL_SECONDS,
    maxLoginStates = 1000,
    loginRateLimit = PORTAL_LOGIN_START_RATE_LIMIT,
    loginRateWindowSeconds = PORTAL_LOGIN_START_RATE_WINDOW_SECONDS,
  ) {
    this.loginStateTtlSeconds = Math.max(1, loginStateTtlSeconds);
    this.maxLoginStates = Math.max(1, maxLoginStates);
    this.loginRateLimit = Math.max(1, loginRateLimit);
    this.loginRateWindowSeconds = Math.max(1, loginRateWindowSeconds);
  }

  async createSession(userId: string): Promise<PortalSession> {
    const ttl = Math.max(1, this.sessionTtlSeconds);
    const session: PortalSession = {
      id: randomBytes(32).toString("hex"),
      userId,
      expiresAt: Date.now() + ttl * 1000,
    };
    await this.stateStore.set(this.sessionKey(session.id), session, ttl);
    return session;
  }

  async getSession(id: string): Promise<PortalSession | null> {
    const session = (await this.stateStore.get(this.sessionKey(id))) as unknown;
    if (!isPortalSession(session) || Date.now() > session.expiresAt) {
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
        `portal:login-start-rate:${key}:${window}`,
        this.loginRateWindowSeconds,
      );
      if (count > this.loginRateLimit) throw new PortalLoginStateLimitError();
    }
  }

  async createLoginState(
    returnTo: string,
    bindingHash: string,
    codeVerifier: string,
  ): Promise<string> {
    const state = randomBytes(32).toString("hex");
    const key = this.loginStateKey(state);
    const entry: PortalLoginState = { returnTo, bindingHash, codeVerifier };
    if (this.stateStore.setBounded) {
      const stored = await this.stateStore.setBounded(
        key,
        entry,
        this.loginStateTtlSeconds,
        this.loginStateCollectionKey(),
        this.maxLoginStates,
      );
      if (!stored) throw new PortalLoginStateLimitError();
      return state;
    }

    const window = Math.floor(Date.now() / (this.loginStateTtlSeconds * 1000));
    const count = await this.stateStore.increment(
      `portal:login-state-rate:${window}`,
      this.loginStateTtlSeconds,
    );
    if (count > this.maxLoginStates) throw new PortalLoginStateLimitError();
    await this.stateStore.set(key, entry, this.loginStateTtlSeconds);
    return state;
  }

  async consumeLoginState(state: string): Promise<PortalLoginState | null> {
    const entry = (await this.stateStore.take(
      this.loginStateKey(state),
      this.loginStateCollectionKey(),
    )) as PortalLoginState | null;
    if (
      !entry ||
      typeof entry.returnTo !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.bindingHash) ||
      !/^[A-Za-z0-9._~-]{43,128}$/u.test(entry.codeVerifier)
    ) {
      return null;
    }
    return entry;
  }

  async clear(): Promise<void> {
    // 所有共享 key 都有 TTL，单个实例不枚举或清理其他实例的会话。
  }

  private sessionKey(id: string): string {
    return `portal:session:${id}`;
  }

  private loginStateKey(state: string): string {
    return `portal:login-state:${state}`;
  }

  private loginStateCollectionKey(): string {
    return "portal:login-states";
  }
}

function isPortalSession(value: unknown): value is PortalSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.id === "string" &&
    /^[a-f0-9]{64}$/u.test(session.id) &&
    typeof session.userId === "string" &&
    session.userId.length > 0 &&
    typeof session.expiresAt === "number" &&
    Number.isFinite(session.expiresAt)
  );
}
