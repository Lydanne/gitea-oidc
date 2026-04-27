/**
 * 后台 BFF 会话存储
 */

import { randomBytes } from "crypto";
import type { AdminSession } from "../types/admin";

/**
 * 后台 BFF 会话存储
 */
export class AdminSessionStore {
  private sessions = new Map<string, AdminSession>();
  private loginStates = new Map<string, string>();

  constructor(private sessionTtlSeconds: number) {}

  /**
   * 创建后台会话
   * @param userId 用户 ID
   * @returns 会话记录
   */
  createSession(userId: string): AdminSession {
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
    const state = randomBytes(32).toString("hex");
    this.loginStates.set(state, returnTo);
    return state;
  }

  /**
   * 验证并消费 OAuth state
   * @param state OAuth state
   */
  consumeLoginState(state: string): string | null {
    const returnTo = this.loginStates.get(state);
    if (!returnTo) {
      return null;
    }

    this.loginStates.delete(state);
    return returnTo;
  }

  /**
   * 清空会话
   */
  clear(): void {
    this.sessions.clear();
    this.loginStates.clear();
  }
}
