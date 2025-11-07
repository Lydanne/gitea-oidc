import { defineConfig } from 'rolldown';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  input: 'src/server.ts',
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: '[name].js',
    sourcemap: true,
  },
  external: [
    // Node.js 内置模块
    /^node:/,
    'fs',
    'path',
    'url',
    'crypto',
    'stream',
    'util',
    'events',
    'http',
    'https',
    'net',
    'tls',
    'zlib',
    'querystring',
    
    // 所有 npm 依赖都标记为 external
    'fastify',
    '@fastify/cors',
    '@fastify/middie',
    'oidc-provider',
    'bcrypt',
    'zod',
  ],
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  platform: 'node',
});
