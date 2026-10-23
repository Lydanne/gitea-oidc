/**
 * X OIDC TypeScript SDK
 */

import type { ProviderApiRequest, ProviderApiResponse } from "../types/providerApi.js";

/**
 * SDK 客户端配置
 */
export interface XOidcClientOptions {
  /** X OIDC 服务基础 URL */
  baseUrl: string;

  /** 当前 OIDC access token */
  accessToken?: string;
}

/**
 * X OIDC SDK 客户端
 */
export class XOidcClient {
  private baseUrl: string;
  private accessToken?: string;

  constructor(options: XOidcClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.accessToken = options.accessToken;
  }

  /**
   * 设置 OIDC access token
   * @param accessToken access token
   */
  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /**
   * 调用统一 Provider API 代理
   * @param provider Provider 名称
   * @param request Provider API 请求
   */
  async providerRequest<T = unknown>(
    provider: string,
    request: ProviderApiRequest,
  ): Promise<ProviderApiResponse<T>> {
    if (!this.accessToken) {
      throw new Error("Access token is required");
    }

    const response = await fetch(`${this.baseUrl}/api/provider/${provider}/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data?.error ?? `Provider request failed: ${response.status}`);
    }

    return data as ProviderApiResponse<T>;
  }
}

export type { ProviderApiRequest, ProviderApiResponse };
