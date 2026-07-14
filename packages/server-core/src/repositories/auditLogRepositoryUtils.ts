import { randomUUID } from "crypto";
import type { AuditLogInput, AuditLogListOptions, AuditLogRecord } from "../types/audit.js";

export interface NormalizedAuditLogListOptions
  extends Omit<AuditLogListOptions, "offset" | "limit"> {
  offset: number;
  limit: number;
}

/** 在持久化前限制审计摘要长度，避免请求数据无界写入。 */
export function normalizeAuditLogInput(input: AuditLogInput): AuditLogRecord {
  return {
    id: randomUUID(),
    eventType: input.eventType,
    outcome: input.outcome,
    source: input.source,
    ...optionalText("userId", input.userId, 255),
    ...optionalText("actorUserId", input.actorUserId, 255),
    ...optionalText("username", input.username, 255),
    ...optionalText("provider", input.provider, 64),
    ...optionalText("clientId", input.clientId, 255),
    ...optionalText("ipAddress", input.ipAddress, 128),
    ...optionalText("userAgent", input.userAgent, 512),
    ...(input.changedFields
      ? {
          changedFields: [...new Set(input.changedFields.map((field) => field.trim()))]
            .filter(Boolean)
            .slice(0, 64),
        }
      : {}),
    ...(input.statusFrom ? { statusFrom: input.statusFrom } : {}),
    ...(input.statusTo ? { statusTo: input.statusTo } : {}),
    ...optionalText("reason", input.reason, 128),
    createdAt:
      input.createdAt && Number.isFinite(input.createdAt.getTime()) ? input.createdAt : new Date(),
  };
}

export function normalizeAuditLogListOptions(
  options: AuditLogListOptions = {},
): NormalizedAuditLogListOptions {
  return {
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.eventType ? { eventType: options.eventType } : {}),
    ...(options.outcome ? { outcome: options.outcome } : {}),
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    offset: Math.max(0, Math.floor(options.offset ?? 0)),
    limit: Math.min(500, Math.max(1, Math.floor(options.limit ?? 100))),
  };
}

export function matchesAuditLog(
  record: AuditLogRecord,
  options: Omit<AuditLogListOptions, "offset" | "limit">,
): boolean {
  if (options.userId && record.userId !== options.userId && record.actorUserId !== options.userId) {
    return false;
  }
  if (options.eventType && record.eventType !== options.eventType) return false;
  if (options.outcome && record.outcome !== options.outcome) return false;
  if (options.from && record.createdAt < options.from) return false;
  if (options.to && record.createdAt > options.to) return false;
  return true;
}

function optionalText<K extends keyof AuditLogRecord>(
  key: K,
  value: unknown,
  maxLength: number,
): Partial<Pick<AuditLogRecord, K>> {
  if (typeof value !== "string") return {};
  const normalized = value.trim().slice(0, maxLength);
  return normalized ? ({ [key]: normalized } as Partial<Pick<AuditLogRecord, K>>) : {};
}
