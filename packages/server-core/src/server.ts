import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { start } from "./identityServer.js";
import { Logger } from "./utils/Logger.js";
import { sanitizeForLog } from "./utils/logSanitizer.js";

export * from "./identityServer.js";

/**
 * 运行服务进程并注册优雅退出信号。
 *
 * 进程生命周期只存在于部署入口和旧版直接执行入口中，普通模块导入不会监听端口。
 */
export async function runIdentityServerProcess(
  shutdownTimeoutMs = 10_000,
): Promise<FastifyInstance | undefined> {
  try {
    const app = await start();
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      Logger.info("[服务器] 正在关闭...");
      const forceExitTimer = setTimeout(() => {
        Logger.error(`[服务器] ${shutdownTimeoutMs}ms 内未完成关闭，强制退出`);
        process.exit(1);
      }, shutdownTimeoutMs);
      forceExitTimer.unref();
      try {
        await app.close();
        clearTimeout(forceExitTimer);
        Logger.info("[服务器] 关闭完成");
        process.exit(0);
      } catch (err) {
        clearTimeout(forceExitTimer);
        Logger.error("[服务器] 关闭时资源清理失败:", sanitizeForLog(err));
        process.exit(1);
      }
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    return app;
  } catch (err) {
    Logger.error("服务器启动失败:", sanitizeForLog(err));
    process.exitCode = 1;
    return undefined;
  }
}

export function isMainModulePath(moduleUrl: string, argvPath?: string): boolean {
  if (!argvPath) return false;

  return canonicalizePath(fileURLToPath(moduleUrl)) === canonicalizePath(argvPath);
}

function canonicalizePath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

const isMainModule = isMainModulePath(import.meta.url, process.argv[1]);

if (isMainModule) {
  await runIdentityServerProcess();
}
