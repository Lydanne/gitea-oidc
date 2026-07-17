import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // 发布产物使用相对路径，服务端负责注入实际的 portal.basePath。
  base: command === "build" ? "./" : "/portal/",
  plugins: [vue()],
  server: {
    proxy: {
      "/portal/api": "http://localhost:3000",
      "/portal/login/start": "http://localhost:3000",
      "/portal/logout": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
}));
