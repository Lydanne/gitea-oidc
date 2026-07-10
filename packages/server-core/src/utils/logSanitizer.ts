/**
 * 日志脱敏工具。
 *
 * 调试日志可以帮助排障，但不能输出密码、token、OAuth code、Cookie 或第三方原始用户档案。
 */

import type { UserInfo } from "../types/auth.js";
import { redactTokenLikeText } from "./tokenCrypto.js";

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = 5;
const MAX_ARRAY_LENGTH = 20;

const SENSITIVE_KEYS = new Set([
  "access_token",
  "accessToken",
  "app_secret",
  "appSecret",
  "authorization",
  "challenge",
  "client_secret",
  "clientSecret",
  "code",
  "cookie",
  "encrypt",
  "id_token",
  "idToken",
  "jwt",
  "password",
  "refresh_token",
  "refreshToken",
  "secret",
  "session",
  "state",
  "token",
  "tokenEncryptionKey",
]);

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|credential|jwt|password|private.*key|refresh.*token|secret|session|token)/i;

const PII_KEYS = new Set([
  "avatar",
  "email",
  "enterprise_email",
  "externalId",
  "metadata",
  "mobile",
  "name",
  "phone",
  "picture",
  "providerProfile",
  "raw",
  "tenant_key",
  "tenantKey",
  "union_id",
  "unionId",
  "username",
  "userName",
]);

/**
 * 递归脱敏任意日志对象。
 */
export function sanitizeForLog(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>(), 0);
}

/**
 * 输出用户排障摘要，不包含个人联系方式、Provider 原始档案或 metadata。
 */
export function summarizeUserForLog(user: UserInfo | null | undefined): unknown {
  if (!user) {
    return null;
  }

  return {
    sub: user.sub,
    authProvider: user.authProvider,
    status: user.status ?? "active",
    hasExternalId: Boolean(user.externalId),
    groupCount: user.groups?.length ?? 0,
    roleCount: user.roles?.length ?? 0,
    hasEmail: Boolean(user.email),
    hasPhone: Boolean(user.phone),
    hasProviderProfile: Boolean(user.providerProfile),
    hasMetadata: Boolean(user.metadata),
  };
}

/**
 * 输出 claims 摘要，不记录具体邮箱、电话、姓名、头像等 PII。
 */
export function summarizeClaimsForLog(claims: Record<string, unknown>): unknown {
  return {
    claimKeys: Object.keys(claims).sort(),
    groupCount: Array.isArray(claims.groups) ? claims.groups.length : 0,
    roleCount: Array.isArray(claims.roles) ? claims.roles.length : 0,
    status: claims.status,
    hasEmail: Boolean(claims.email),
    hasPhone: Boolean(claims.phone),
    hasPicture: Boolean(claims.picture),
  };
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return typeof value === "string" ? redactTokenLikeText(value) : value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactTokenLikeText(value.message),
    };
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = shouldRedactKey(key) ? REDACTED : sanitizeValue(child, seen, depth + 1);
  }
  return result;
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || PII_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key);
}
