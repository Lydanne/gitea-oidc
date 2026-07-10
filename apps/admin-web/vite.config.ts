import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/admin/",
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
});
