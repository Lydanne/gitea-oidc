/**
 * Provider token 加密工具
 *
 * 使用 AES-256-GCM 对第三方 access/refresh token 做静态加密。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const TOKEN_CRYPTO_VERSION = "v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const TOKEN_ERROR_MAX_LENGTH = 240;
const SENSITIVE_ERROR_KEY_SOURCE =
  "authorization_?code|oauth_?code|[a-z0-9_]*(?:access_?token|refresh_?token|id_?token|token|secret|password)|code";

/**
 * Provider token 加密器
 */
export class TokenEncryptor {
  private key: Buffer;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error("providerApi.tokenEncryptionKey must be at least 32 characters");
    }

    this.key = createHash("sha256").update(secret).digest();
  }

  /**
   * 加密明文 token
   * @param plaintext 明文 token
   * @returns 带版本的密文
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      TOKEN_CRYPTO_VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":");
  }

  /**
   * 解密 token 密文
   * @param ciphertext 带版本的密文
   * @returns 明文 token
   */
  decrypt(ciphertext: string): string {
    const [version, ivText, tagText, encryptedText] = ciphertext.split(":");

    if (version !== TOKEN_CRYPTO_VERSION || !ivText || !tagText || !encryptedText) {
      throw new Error("Unsupported provider token ciphertext format");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivText, "base64url"), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }
}

/**
 * 将敏感值压缩成安全错误摘要
 * @param error 原始错误
 * @returns 不含 token 的错误摘要
 */
export function summarizeTokenError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeTokenErrorText(message) ?? "";
}

/**
 * 脱敏并截断将进入 Provider token 仓储或后台摘要的错误文本。
 * @param message 原始错误文本
 * @returns 脱敏后的错误文本；空值返回 undefined
 */
export function sanitizeTokenErrorText(message?: string): string | undefined {
  if (!message) {
    return undefined;
  }

  return redactTokenLikeText(message).slice(0, TOKEN_ERROR_MAX_LENGTH);
}

export function redactTokenLikeText(message: string): string {
  return message
    .replace(/\b(authorization)(["']?\s*[:=]\s*["'])([^"']*)(["'])/gi, "$1$2[REDACTED]$4")
    .replace(/\b(authorization\s*[:=]\s*)Bearer\s+[^\s,;}]+/gi, "$1Bearer [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      new RegExp(`\\b(${SENSITIVE_ERROR_KEY_SOURCE})(["']?\\s*[:=]\\s*["'])([^"']*)(["'])`, "gi"),
      "$1$2[REDACTED]$4",
    )
    .replace(
      new RegExp(`\\b(${SENSITIVE_ERROR_KEY_SOURCE})(\\s*[:=]\\s*)([^&\\s,;}]+)`, "gi"),
      "$1$2[REDACTED]",
    );
}
