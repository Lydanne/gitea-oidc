#!/usr/bin/env node

/**
 * 强制使用 pnpm 安装依赖
 * 如果使用 npm 或 yarn 会报错并退出
 */

if (!/pnpm/.test(process.env.npm_execpath || "")) {
  console.error(
    "\n\x1b[31m错误：请使用 pnpm 安装依赖！\x1b[0m\n" +
      "\n如果你还没有安装 pnpm，可以通过以下方式安装：\n" +
      "  npm install -g pnpm\n" +
      "  或\n" +
      "  brew install pnpm\n" +
      "\n然后运行：\n" +
      "  pnpm install\n",
  );
  process.exit(1);
}
