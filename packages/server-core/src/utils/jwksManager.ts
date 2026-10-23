/**
 * JWKS 密钥管理工具
 *
 * 用于生成和加载持久化的 JWKS (JSON Web Key Set)
 * 解决 oidc-provider 的开发密钥警告
 */

import { randomBytes } from "crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { join, resolve } from "path";

export interface JWKSConfig {
  keys: JWK[];
}

const JWKS_FILE_MODE = 0o600;
const GROUP_OR_OTHER_ACCESS_MASK = 0o077;
const JWKS_LOCK_STALE_MS = 30_000;
const inFlightLoads = new Map<string, Promise<JWKSConfig>>();

/**
 * 生成 RSA 密钥对并保存为 JWKS 格式
 *
 * @param filePath JWKS 文件保存路径
 * @param keyId 密钥 ID (kid)
 */
export async function generateJWKS(
  filePath: string,
  keyId: string = "default-key",
): Promise<JWKSConfig> {
  const jwks = await createJWKS(keyId);
  writeJWKSAtomically(filePath, jwks);
  console.log(`✅ JWKS 已保存到: ${filePath}`);
  console.log(`⚠️  请妥善保管此文件,不要提交到版本控制系统!`);

  return jwks;
}

/**
 * 从文件加载 JWKS
 *
 * @param filePath JWKS 文件路径
 * @returns JWKS 配置对象
 */
export function loadJWKS(filePath: string): JWKSConfig {
  if (!existsSync(filePath)) {
    throw new Error(`JWKS 文件不存在: ${filePath}`);
  }

  restrictJWKSFilePermissions(filePath);
  const content = readFileSync(filePath, "utf-8");
  const jwks = JSON.parse(content) as JWKSConfig;

  if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error("无效的 JWKS 文件格式");
  }

  return jwks;
}

/**
 * 获取或生成 JWKS
 *
 * 如果文件存在则加载,否则生成新的密钥
 *
 * @param filePath JWKS 文件路径
 * @param keyId 密钥 ID (仅在生成新密钥时使用)
 * @returns JWKS 配置对象
 */
export async function getOrGenerateJWKS(
  filePath: string = join(process.cwd(), "jwks.json"),
  keyId: string = "default-key",
): Promise<JWKSConfig> {
  const normalizedPath = resolve(filePath);
  const active = inFlightLoads.get(normalizedPath);
  if (active) return active;

  const task = getOrGenerateJWKSOnce(normalizedPath, keyId).finally(() => {
    inFlightLoads.delete(normalizedPath);
  });
  inFlightLoads.set(normalizedPath, task);
  return task;
}

async function getOrGenerateJWKSOnce(filePath: string, keyId: string): Promise<JWKSConfig> {
  if (existsSync(filePath)) {
    console.log(`📂 加载现有 JWKS: ${filePath}`);
    return loadJWKS(filePath);
  }

  const releaseLock = await acquireJWKSLock(filePath);
  try {
    // 另一进程可能已在我们等待锁时完成写入。
    if (existsSync(filePath)) {
      return loadJWKS(filePath);
    }

    console.log(`🆕 JWKS 文件不存在,正在生成新密钥...`);
    const jwks = await createJWKS(keyId);
    writeJWKSAtomically(filePath, jwks);
    console.log(`✅ JWKS 已保存到: ${filePath}`);
    return jwks;
  } finally {
    releaseLock();
  }
}

async function createJWKS(keyId: string): Promise<JWKSConfig> {
  console.log(`🔐 正在生成 RSA 密钥对...`);
  const { privateKey } = await generateKeyPair("RS256", {
    modulusLength: 2048,
    extractable: true,
  });
  const privateJWK = await exportJWK(privateKey);
  const jwk: JWK = { ...privateJWK, kid: keyId, alg: "RS256", use: "sig" };
  return { keys: [jwk] };
}

function writeJWKSAtomically(filePath: string, jwks: JWKSConfig): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(jwks, null, 2), {
      encoding: "utf-8",
      mode: JWKS_FILE_MODE,
    });
    restrictJWKSFilePermissions(temporaryPath);
    renameSync(temporaryPath, filePath);
    restrictJWKSFilePermissions(filePath);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

async function acquireJWKSLock(filePath: string): Promise<() => void> {
  const lockPath = `${filePath}.lock`;
  while (true) {
    try {
      const descriptor = openSync(lockPath, "wx", JWKS_FILE_MODE);
      return () => {
        closeSync(descriptor);
        if (existsSync(lockPath)) unlinkSync(lockPath);
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > JWKS_LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch (statErr: any) {
        if (statErr?.code !== "ENOENT") throw statErr;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function restrictJWKSFilePermissions(filePath: string): void {
  if (process.platform === "win32") {
    return;
  }

  const mode = statSync(filePath).mode & 0o777;
  if ((mode & GROUP_OR_OTHER_ACCESS_MASK) === 0) {
    return;
  }

  chmodSync(filePath, JWKS_FILE_MODE);
}
