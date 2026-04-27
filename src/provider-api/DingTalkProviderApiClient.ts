/**
 * 钉钉 Provider API 客户端骨架
 */

import type {
  ProviderApiActor,
  ProviderApiRequest,
  ProviderApiResponse,
  ProviderTokenRecord,
  ProviderTokenStatus,
} from "../types/providerApi";
import { BaseProviderApiClient, type BaseProviderApiClientOptions } from "./BaseProviderApiClient";

/**
 * 钉钉 Provider API 客户端
 *
 * 第一版仅保留统一接口骨架，真实登录和 token 交换后续实现。
 */
export class DingTalkProviderApiClient extends BaseProviderApiClient {
  constructor(options: Omit<BaseProviderApiClientOptions, "provider">) {
    super({ ...options, provider: "dingtalk" });
  }

  async request<T = unknown>(
    _request: ProviderApiRequest,
    _actor: ProviderApiActor,
  ): Promise<ProviderApiResponse<T>> {
    throw new Error("DingTalk Provider API is not implemented yet");
  }

  async getUserToken(_userId: string): Promise<ProviderTokenRecord | null> {
    throw new Error("DingTalk Provider API is not implemented yet");
  }

  async getAppToken(_ownerId?: string): Promise<ProviderTokenRecord | null> {
    throw new Error("DingTalk Provider API is not implemented yet");
  }

  async refreshUserToken(_userId: string): Promise<ProviderTokenRecord> {
    throw new Error("DingTalk user token refresh is not implemented yet");
  }

  async probeToken(_record: ProviderTokenRecord): Promise<ProviderTokenStatus> {
    throw new Error("DingTalk Provider API is not implemented yet");
  }
}
