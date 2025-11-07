import { defineConfig } from 'rolldown';
import { builtinModules } from 'node:module';

/**
 * 生产环境 Rolldown 配置
 * 
 * 特性:
 * - 启用代码压缩
 * - 移除 sourcemap (可选)
 * - 更激进的 tree-shaking
 */
export default defineConfig({
  input: 'src/server.ts',
  
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: '[name].js',
    // 生产环境可以禁用 sourcemap 以减小体积
    sourcemap: false,
    // 启用压缩
    minify: true,
  },
  
  // 自动将所有 Node.js 内置模块和 node_modules 依赖标记为 external
  external: (id) => {
    // Node.js 内置模块 (包括 node: 前缀)
    if (id.startsWith('node:') || builtinModules.includes(id)) {
      return true;
    }
    
    // 所有 node_modules 依赖
    if (!id.startsWith('.') && !id.startsWith('/')) {
      return true;
    }
    
    return false;
  },
  
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  
  platform: 'node',
  
  // 优化选项
  treeshake: {
    // 启用更激进的 tree-shaking
    moduleSideEffects: false,
    // 移除未使用的导出
    propertyReadSideEffects: false,
  },
});
