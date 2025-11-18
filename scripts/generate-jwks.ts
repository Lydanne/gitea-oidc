#!/usr/bin/env tsx
/**
 * JWKS 密钥生成脚本
 * 
 * 用于手动生成 JWKS 密钥文件
 * 
 * 使用方法:
 *   pnpm tsx scripts/generate-jwks.ts [输出文件路径] [密钥ID]
 * 
 * 示例:
 *   pnpm tsx scripts/generate-jwks.ts
 *   pnpm tsx scripts/generate-jwks.ts ./my-jwks.json my-key-id
 */

import { join } from 'path';
import { generateJWKS } from '../src/utils/jwksManager';

async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0] || join(process.cwd(), 'jwks.json');
  const keyId = args[1] || `key-${Date.now()}`;
  
  console.log('='.repeat(60));
  console.log('🔐 JWKS 密钥生成工具');
  console.log('='.repeat(60));
  console.log(`📁 输出文件: ${filePath}`);
  console.log(`🔑 密钥 ID: ${keyId}`);
  console.log('');
  
  try {
    await generateJWKS(filePath, keyId);
    console.log('');
    console.log('✅ 密钥生成成功!');
    console.log('');
    console.log('⚠️  安全提示:');
    console.log('   1. 请将此文件添加到 .gitignore');
    console.log('   2. 不要将密钥文件提交到版本控制系统');
    console.log('   3. 在生产环境中妥善保管此文件');
    console.log('   4. 定期轮换密钥以提高安全性');
    console.log('');
  } catch (error) {
    console.error('❌ 密钥生成失败:', error);
    process.exit(1);
  }
}

main();
