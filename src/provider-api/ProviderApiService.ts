/**
 * Provider API 服务
 */

import type {
  ProviderApiActor,
  ProviderApiClient,
  ProviderApiRequest,
  ProviderApiResponse,
  ProviderTokenRepository,
  ProviderTokenStatus,
} from "../types/providerApi";

/**
 * Provider API 服务配置
 */
export interface ProviderApiServiceOptions {
  /** 后台管理员组 */
  adminGroups: string[];

  /** token 仓储 */
  tokenRepository: ProviderTokenRepository;
}

/**
 * Provider API 服务
 */
export class ProviderApiService {
  private clients = new Map<string, ProviderApiClient>();
  private adminGroups: string[];

  constructor(private options: ProviderApiServiceOptions) {
    this.adminGroups = options.adminGroups;
  }

  /**
   * 注册 Provider API 客户端
   * @param client Provider API 客户端
   */
  registerClient(client: ProviderApiClient): void {
    this.clients.set(client.provider, client);
  }

  /**
   * 获取所有 Provider API 客户端
   */
  getClients(): ProviderApiClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * 获取 Provider API 客户端
   * @param provider Provider 名称
   */
  getClient(provider: string): ProviderApiClient | undefined {
    return this.clients.get(provider);
  }

  /**
   * 发送受控 Provider API 请求
   * @param provider Provider 名称
   * @param request 请求描述
   * @param actor 当前调用者
   */
  async request<T = unknown>(
    provider: string,
    request: ProviderApiRequest,
    actor: ProviderApiActor,
  ): Promise<ProviderApiResponse<T>> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider API client not found: ${provider}`);
    }

    this.assertRequestAllowed(request, actor);
    return client.request<T>(request, actor);
  }

  /**
   * 探活指定 token
   * @param provider Provider 名称
   * @param ownerType token 所属类型
   * @param ownerId token 所属 ID
   */
  async probeToken(
    provider: string,
    ownerType: "user" | "app",
    ownerId: string,
  ): Promise<ProviderTokenStatus> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider API client not found: ${provider}`);
    }

    const token = await this.options.tokenRepository.find(provider, ownerType, ownerId);
    if (!token) {
      throw new Error(`Provider token not found: ${provider}/${ownerType}/${ownerId}`);
    }

    return client.probeToken(token);
  }

  /**
   * 判断调用者是否为管理员
   * @param actor 当前调用者
   */
  isAdmin(actor: ProviderApiActor): boolean {
    return (actor.groups ?? []).some((group) => this.adminGroups.includes(group));
  }

  private assertRequestAllowed(request: ProviderApiRequest, actor: ProviderApiActor): void {
    if (request.tokenKind === "app") {
      if (!this.isAdmin(actor)) {
        throw new Error("App token provider requests require admin permission");
      }
      return;
    }

    const ownerId = request.ownerId ?? actor.userId;
    if (ownerId !== actor.userId && !this.isAdmin(actor)) {
      throw new Error("Cross-user provider requests require admin permission");
    }
  }
}
