/**
 * 用户 ID 生成工具
 * 基于 authProvider 和 externalId 生成确定性的用户 ID
 */

import { createHash } from "crypto";

/**
 * 基于 authProvider 和 externalId 生成确定性的用户 ID
 *
 * @param authProvider - 认证提供商标识（如 'feishu', 'local' 等）
 * @param externalId - 外部用户 ID
 * @returns SHA-256 哈希值（64 字符的十六进制字符串）
 *
 * @example
 * ```typescript
 * const userId = generateUserId('feishu', 'ou_123456');
 * // 返回: "a1b2c3d4e5f6..." (64 字符)
 * ```
 */
export function generateUserId(authProvider: string, externalId: string): string {
  const input = `${authProvider}:${externalId}`;
  return createHash("sha256").update(input).digest("hex");
}
