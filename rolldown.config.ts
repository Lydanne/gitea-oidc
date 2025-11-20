import { builtinModules } from "node:module";
import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/server.ts",

  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    sourcemap: true,
    // 压缩输出 (可选,生产环境建议开启)
    minify: false,
  },

  // 自动将所有 Node.js 内置模块和 node_modules 依赖标记为 external
  external: (id) => {
    // Node.js 内置模块 (包括 node: 前缀)
    if (id.startsWith("node:") || builtinModules.includes(id)) {
      return true;
    }

    // 所有 node_modules 依赖
    if (!id.startsWith(".") && !id.startsWith("/")) {
      return true;
    }

    return false;
  },

  resolve: {
    extensions: [".ts", ".js", ".json"],
  },

  platform: "node",

  // 优化选项
  treeshake: {
    // 启用更激进的 tree-shaking
    moduleSideEffects: false,
  },
});
