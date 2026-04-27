/**
 * Provider token 加密工具
 *
 * 使用 AES-256-GCM 对第三方 access/refresh token 做静态加密。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const TOKEN_CRYPTO_VERSION = "v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Provider token 加密器
 */
export class TokenEncryptor {
  private key: Buffer;

  constructor(secret: string) {
    if (!secret || secret.length < 16) {
      throw new Error("providerApi.tokenEncryptionKey must be at least 16 characters");
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
  if (error instanceof Error) {
    return error.message.slice(0, 240);
  }
  return String(error).slice(0, 240);
}
