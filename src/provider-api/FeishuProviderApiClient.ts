/**
 * 飞书 Provider API 客户端
 */

import type { FeishuAuthConfig } from "../types/auth";
import type {
  ProviderTokenRecord,
  ProviderTokenRepository,
  ProviderTokenStatus,
} from "../types/providerApi";
import { summarizeTokenError } from "../utils/tokenCrypto";
import { BaseProviderApiClient } from "./BaseProviderApiClient";

interface FeishuTokenResponse {
  code: number;
  msg: string;
  app_access_token?: string;
  tenant_access_token?: string;
  expire?: number;
  expires_in?: number;
  data?: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    token_type?: string;
    scope?: string;
  };
}

/**
 * 飞书 Provider API 客户端配置
 */
export interface FeishuProviderApiClientOptions {
  /** 飞书认证配置 */
  config: FeishuAuthConfig;

  /** token 仓储 */
  tokenRepository: ProviderTokenRepository;

  /** API 基础 URL */
  baseUrl: string;

  /** 过期前多少秒刷新 */
  refreshSkewSeconds: number;

  /** SDK 代理允许的操作 */
  allowedOperations?: string[];

  /** 默认应用 token 所属 ID */
  defaultAppOwnerId?: string;
}

/**
 * 飞书 Provider API 客户端
 */
export class FeishuProviderApiClient extends BaseProviderApiClient {
  private config: FeishuAuthConfig;

  constructor(options: FeishuProviderApiClientOptions) {
    super({
      provider: "feishu",
      baseUrl: options.baseUrl,
      tokenRepository: options.tokenRepository,
      refreshSkewSeconds: options.refreshSkewSeconds,
      allowedOperations: options.allowedOperations,
      defaultAppOwnerId: options.defaultAppOwnerId,
    });
    this.config = options.config;
  }

  async getAppToken(ownerId: string = this.defaultAppOwnerId): Promise<ProviderTokenRecord | null> {
    const existing = await this.tokenRepository.find(this.provider, "app", ownerId);
    if (existing && !this.shouldRefresh(existing)) {
      return existing;
    }

    const response = await fetch(`${this.baseUrl}/auth/v3/app_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });
    const data = (await response.json()) as FeishuTokenResponse;

    if (!response.ok || data.code !== 0 || !data.app_access_token) {
      throw new Error(`Failed to fetch Feishu app token: ${data.msg ?? response.status}`);
    }

    return this.tokenRepository.upsert({
      provider: this.provider,
      ownerType: "app",
      ownerId,
      accessToken: data.app_access_token,
      expiresAt: new Date(Date.now() + (data.expire ?? data.expires_in ?? 7200) * 1000),
      status: "valid",
      tokenType: "Bearer",
    });
  }

  async refreshUserToken(userId: string): Promise<ProviderTokenRecord> {
    const existing = await this.tokenRepository.find(this.provider, "user", userId);
    if (!existing?.refreshToken) {
      throw new Error(`Feishu refresh token not found for user: ${userId}`);
    }

    try {
      const appToken = await this.getAppToken();
      if (!appToken) {
        throw new Error("Feishu app token not found");
      }

      const response = await fetch(`${this.baseUrl}/authen/v1/refresh_access_token`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appToken.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: existing.refreshToken,
        }),
      });
      const data = (await response.json()) as FeishuTokenResponse;

      if (!response.ok || data.code !== 0 || !data.data?.access_token) {
        throw new Error(`Failed to refresh Feishu user token: ${data.msg ?? response.status}`);
      }

      return this.tokenRepository.upsert({
        ...existing,
        accessToken: data.data.access_token,
        refreshToken: data.data.refresh_token ?? existing.refreshToken,
        tokenType: data.data.token_type ?? existing.tokenType ?? "Bearer",
        scope: data.data.scope ?? existing.scope,
        expiresAt: data.data.expires_in
          ? new Date(Date.now() + data.data.expires_in * 1000)
          : existing.expiresAt,
        refreshExpiresAt: data.data.refresh_expires_in
          ? new Date(Date.now() + data.data.refresh_expires_in * 1000)
          : existing.refreshExpiresAt,
        lastRefreshAt: new Date(),
        lastError: undefined,
        status: "valid",
      });
    } catch (err) {
      await this.tokenRepository.updateStatus(
        this.provider,
        "user",
        userId,
        "refresh_failed",
        summarizeTokenError(err),
      );
      throw err;
    }
  }

  async probeToken(record: ProviderTokenRecord): Promise<ProviderTokenStatus> {
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      await this.tokenRepository.updateStatus(
        record.provider,
        record.ownerType,
        record.ownerId,
        "expired",
      );
      return "expired";
    }

    if (record.ownerType === "app") {
      await this.tokenRepository.updateStatus(record.provider, "app", record.ownerId, "valid");
      return "valid";
    }

    try {
      await this.send({
        method: "GET",
        path: "/authen/v1/user_info",
        headers: { Authorization: `Bearer ${record.accessToken}` },
      });
      await this.tokenRepository.updateStatus(record.provider, "user", record.ownerId, "valid");
      return "valid";
    } catch (err) {
      await this.tokenRepository.updateStatus(
        record.provider,
        "user",
        record.ownerId,
        "unknown",
        summarizeTokenError(err),
      );
      return "unknown";
    }
  }
}
