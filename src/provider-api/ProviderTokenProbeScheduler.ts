/**
 * Provider token 自动探活调度器
 */

import type { ProviderTokenRepository } from "../types/providerApi";
import { Logger } from "../utils/Logger";
import { ProviderApiService } from "./ProviderApiService";

/**
 * Provider token 自动探活调度器配置
 */
export interface ProviderTokenProbeSchedulerOptions {
  /** Provider API 服务 */
  providerApiService: ProviderApiService;

  /** token 仓储 */
  tokenRepository: ProviderTokenRepository;

  /** 探活间隔秒数 */
  probeIntervalSeconds: number;

  /** 过期前多少秒纳入探活 */
  refreshSkewSeconds: number;
}

/**
 * Provider token 自动探活调度器
 */
export class ProviderTokenProbeScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private options: ProviderTokenProbeSchedulerOptions) {}

  /**
   * 启动后台探活
   */
  start(): void {
    if (this.timer || this.options.probeIntervalSeconds <= 0) {
      return;
    }

    this.timer = setInterval(() => {
      this.runOnce().catch((err) => {
        Logger.warn("[ProviderTokenProbe] 探活失败:", err);
      });
    }, this.options.probeIntervalSeconds * 1000);
    this.timer.unref();
  }

  /**
   * 停止后台探活
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * 执行一次探活
   */
  async runOnce(): Promise<void> {
    const tokens = await this.options.tokenRepository.list();
    const threshold = Date.now() + this.options.refreshSkewSeconds * 1000;

    for (const token of tokens) {
      const shouldProbe =
        token.status !== "valid" ||
        !token.lastProbedAt ||
        (token.expiresAt?.getTime() ?? 0) <= threshold;

      if (!shouldProbe) {
        continue;
      }

      try {
        await this.options.providerApiService.probeToken(
          token.provider,
          token.ownerType,
          token.ownerId,
        );
      } catch (err) {
        Logger.warn("[ProviderTokenProbe] token 探活失败:", {
          provider: token.provider,
          ownerType: token.ownerType,
          ownerId: token.ownerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
