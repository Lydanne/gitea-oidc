/**
 * Provider token 自动探活调度器
 */

import type { ProviderTokenRepository } from "../types/providerApi";
import { Logger } from "../utils/Logger";
import { sanitizeForLog } from "../utils/logSanitizer";
import { summarizeTokenError } from "../utils/tokenCrypto";
import { ProviderApiService } from "./ProviderApiService";

const DEFAULT_MAX_TOKENS_PER_RUN = 100;

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

  /** 每轮最多探活多少个 token */
  maxTokensPerRun?: number;
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
        Logger.warn("[ProviderTokenProbe] 探活失败:", sanitizeForLog(err));
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
    const threshold = Date.now() + this.options.refreshSkewSeconds * 1000;
    const tokens = await this.listProbeCandidates(new Date(threshold));

    for (const token of tokens) {
      if (token.status === "revoked") {
        continue;
      }

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
          error: summarizeTokenError(err),
        });
      }
    }
  }

  private async listProbeCandidates(expiresBefore: Date) {
    const limit = normalizeMaxTokensPerRun(this.options.maxTokensPerRun);
    if (this.options.tokenRepository.listProbeCandidates) {
      return this.options.tokenRepository.listProbeCandidates({ expiresBefore, limit });
    }

    return this.options.tokenRepository.list({ limit });
  }
}

function normalizeMaxTokensPerRun(value?: number): number {
  if (value === undefined) {
    return DEFAULT_MAX_TOKENS_PER_RUN;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Provider token probe maxTokensPerRun must be a positive integer");
  }

  return Math.min(value, 500);
}
