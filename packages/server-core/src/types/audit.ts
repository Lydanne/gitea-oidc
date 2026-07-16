/**
 * 审计日志类型与仓储契约。
 */

import type { UserStatus } from "./user.js";

export const AUDIT_EVENT_TYPES = [
  "user.login",
  "user.logout",
  "admin.login",
  "admin.logout",
  "user.created",
  "user.updated",
  "user.deleted",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditOutcome = "success" | "failure";
export type AuditSource = "admin" | "portal" | "provider" | "oidc" | "system";

export interface AuditConfig {
  enabled: boolean;
  /** 审计记录保留天数，超过该期限的记录会自动删除。 */
  retentionDays: number;
}

/** 持久化的审计日志，只保存必要摘要，不保存凭据或 Provider 原始档案。 */
export interface AuditLogRecord {
  id: string;
  eventType: AuditEventType;
  outcome: AuditOutcome;
  source: AuditSource;
  /** 事件影响的用户，登录/登出时也是当前用户。 */
  userId?: string;
  /** 执行管理操作的用户。 */
  actorUserId?: string;
  /** 用户名快照或失败登录尝试的用户名。 */
  username?: string;
  provider?: string;
  clientId?: string;
  ipAddress?: string;
  userAgent?: string;
  /** 更新仅记录字段名，不持久化字段值。 */
  changedFields?: string[];
  statusFrom?: UserStatus;
  statusTo?: UserStatus;
  /** 稳定的原因码，不保存原始异常或请求数据。 */
  reason?: string;
  createdAt: Date;
}

export type AuditLogInput = Omit<AuditLogRecord, "id" | "createdAt"> & {
  createdAt?: Date;
};

export interface AuditLogListOptions {
  userId?: string;
  eventType?: AuditEventType;
  outcome?: AuditOutcome;
  from?: Date;
  to?: Date;
  offset?: number;
  limit?: number;
}

export interface AuditLogPage {
  items: AuditLogRecord[];
  total: number;
}

export interface AuditLogRepository {
  append(input: AuditLogInput): Promise<AuditLogRecord>;
  list(options?: AuditLogListOptions): Promise<AuditLogRecord[]>;
  count(options?: Omit<AuditLogListOptions, "offset" | "limit">): Promise<number>;
  deleteOlderThan(before: Date): Promise<number>;
  close?(): Promise<void> | void;
}

/** 用户变更调用方传入的审计上下文。 */
export interface UserMutationAuditContext {
  source: Extract<AuditSource, "admin" | "provider" | "system">;
  actorUserId?: string;
}

/** OAuth 回调与本地登录之间传递的审计摘要。 */
export interface AuthenticationAuditContext {
  provider: string;
  clientId?: string;
  ipAddress?: string;
  userAgent?: string;
  username?: string;
}

/** 有效登录流程中 Provider 认证失败时可安全持久化的事件摘要。 */
export interface AuthenticationAuditEvent extends AuthenticationAuditContext {
  outcome: "failure";
  userId?: string;
  reason?: string;
}
