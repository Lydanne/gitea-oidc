/**
 * JWKS 密钥管理工具
 * 
 * 用于生成和加载持久化的 JWKS (JSON Web Key Set)
 * 解决 oidc-provider 的开发密钥警告
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { generateKeyPair, exportJWK, type JWK } from 'jose';

export interface JWKSConfig {
  keys: JWK[];
}

/**
 * 生成 RSA 密钥对并保存为 JWKS 格式
 * 
 * @param filePath JWKS 文件保存路径
 * @param keyId 密钥 ID (kid)
 */
export async function generateJWKS(filePath: string, keyId: string = 'default-key'): Promise<JWKSConfig> {
  console.log(`🔐 正在生成 RSA 密钥对...`);
  
  // 生成 RSA 2048 位密钥对 (设置为可导出)
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  
  // 导出为 JWK 格式
  const publicJWK = await exportJWK(publicKey);
  const privateJWK = await exportJWK(privateKey);
  
  // 添加密钥元数据
  const jwk: JWK = {
    ...privateJWK,
    kid: keyId,
    alg: 'RS256',
    use: 'sig',
  };
  
  const jwks: JWKSConfig = {
    keys: [jwk],
  };
  
  // 保存到文件
  writeFileSync(filePath, JSON.stringify(jwks, null, 2), 'utf-8');
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
  
  const content = readFileSync(filePath, 'utf-8');
  const jwks = JSON.parse(content) as JWKSConfig;
  
  if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error('无效的 JWKS 文件格式');
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
  filePath: string = join(process.cwd(), 'jwks.json'),
  keyId: string = 'default-key'
): Promise<JWKSConfig> {
  if (existsSync(filePath)) {
    console.log(`📂 加载现有 JWKS: ${filePath}`);
    return loadJWKS(filePath);
  } else {
    console.log(`🆕 JWKS 文件不存在,正在生成新密钥...`);
    return await generateJWKS(filePath, keyId);
  }
}
