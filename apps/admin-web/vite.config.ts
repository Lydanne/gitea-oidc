import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // 发布产物使用相对路径，运行时由服务端注入真实 admin.basePath。
  base: command === "build" ? "./" : "/admin/",
  plugins: [vue()],
  server: {
    proxy: {
      "/admin/api": "http://localhost:3000",
      "/admin/login/start": "http://localhost:3000",
      "/admin/logout": "http://localhost:3000",
      "/admin/callback": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
}));
