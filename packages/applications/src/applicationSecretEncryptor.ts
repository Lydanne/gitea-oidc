import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { SecretConfigurationError, SecretDecryptionError } from "./errors.js";
import type { EncryptedApplicationSecret } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const SECRET_BYTES = 32;

export interface ApplicationSecretEncryptorOptions {
  keyId: string;
  masterKey: Uint8Array;
}

export interface CreateApplicationSecretOptions {
  oidcClientId: string;
  now?: Date;
  expiresAt?: Date;
}

export interface EncryptApplicationSecretOptions extends CreateApplicationSecretOptions {
  plaintext: string;
}

export interface CreatedApplicationSecret {
  plaintext: string;
  encrypted: EncryptedApplicationSecret;
}

function buildAdditionalAuthenticatedData(secret: {
  id: string;
  oidcClientId: string;
  keyId: string;
  fingerprint: string;
  createdAt: string;
  expiresAt?: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      id: secret.id,
      oidcClientId: secret.oidcClientId,
      keyId: secret.keyId,
      fingerprint: secret.fingerprint,
      createdAt: secret.createdAt,
      expiresAt: secret.expiresAt ?? null,
    }),
    "utf8",
  );
}

function decodeMasterKey(value: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    throw new SecretConfigurationError("应用密钥主密钥必须是有效的 Base64 或 Base64URL");
  }

  const encoding = trimmed.includes("-") || trimmed.includes("_") ? "base64url" : "base64";
  return Buffer.from(trimmed, encoding);
}

export class ApplicationSecretEncryptor {
  private readonly keyId: string;
  private readonly masterKey: Buffer;

  public constructor(options: ApplicationSecretEncryptorOptions) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(options.keyId)) {
      throw new SecretConfigurationError("应用密钥 keyId 格式无效");
    }

    if (options.masterKey.byteLength !== MASTER_KEY_BYTES) {
      throw new SecretConfigurationError("应用密钥主密钥必须恰好为 32 字节");
    }

    this.keyId = options.keyId;
    this.masterKey = Buffer.from(options.masterKey);
  }

  public static fromBase64(options: {
    keyId: string;
    masterKey: string;
  }): ApplicationSecretEncryptor {
    return new ApplicationSecretEncryptor({
      keyId: options.keyId,
      masterKey: decodeMasterKey(options.masterKey),
    });
  }

  public createSecret(options: CreateApplicationSecretOptions): CreatedApplicationSecret {
    const plaintext = `xos_${randomBytes(SECRET_BYTES).toString("base64url")}`;
    return this.encryptSecret({ ...options, plaintext });
  }

  /** 加密迁移进来的既有 Client Secret，不改变其协议值。 */
  public encryptSecret(options: EncryptApplicationSecretOptions): CreatedApplicationSecret {
    const { plaintext } = options;
    if (
      plaintext.length < 8 ||
      plaintext.length > 8192 ||
      [...plaintext].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      })
    ) {
      throw new SecretConfigurationError("OIDC Client Secret 必须是 8 到 8192 个无控制字符的字符");
    }
    const id = randomUUID();
    const createdAt = (options.now ?? new Date()).toISOString();
    const expiresAt = options.expiresAt?.toISOString();
    const fingerprint = `hmac-sha256:${createHmac("sha256", this.masterKey)
      .update("x-oidc/application-secret-fingerprint/v1\0", "utf8")
      .update(plaintext, "utf8")
      .digest("hex")
      .slice(0, 24)}`;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const authenticatedFields = {
      id,
      oidcClientId: options.oidcClientId,
      keyId: this.keyId,
      fingerprint,
      createdAt,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
    cipher.setAAD(buildAdditionalAuthenticatedData(authenticatedFields));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final(),
    ]);

    return {
      plaintext,
      encrypted: {
        ...authenticatedFields,
        ciphertext: ciphertext.toString("base64url"),
        iv: iv.toString("base64url"),
        authTag: cipher.getAuthTag().toString("base64url"),
        status: "active",
        deliveredAt: createdAt,
      },
    };
  }

  public decrypt(secret: EncryptedApplicationSecret): string {
    if (secret.keyId !== this.keyId || secret.status !== "active") {
      throw new SecretDecryptionError();
    }

    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        this.masterKey,
        Buffer.from(secret.iv, "base64url"),
      );
      decipher.setAAD(buildAdditionalAuthenticatedData(secret));
      decipher.setAuthTag(Buffer.from(secret.authTag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(secret.ciphertext, "base64url")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch (error) {
      if (error instanceof SecretDecryptionError) {
        throw error;
      }
      throw new SecretDecryptionError({ cause: error });
    }
  }
}
