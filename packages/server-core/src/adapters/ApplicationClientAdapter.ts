import type { Adapter, AdapterPayload } from "oidc-provider";

/** 动态应用域暴露给 OIDC Provider 的最小只读投影。 */
export interface ApplicationClientProjection {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  redirect_uris: string[];
  post_logout_redirect_uris?: string[];
  scope?: string;
  pkce_policy?: "required" | "optional";
}

export interface ApplicationClientProjectionSource {
  findByClientId(clientId: string): Promise<ApplicationClientProjection | undefined>;
}

/**
 * 把应用仓储投影成 oidc-provider 的 Client Adapter。
 *
 * Client 的写入只能经过 ApplicationService 的事务、审计和密钥交付流程，因此这个
 * Adapter 故意保持只读；若未来开放 Dynamic Client Registration，必须先把写操作
 * 显式映射到应用域，而不能绕过控制面直接落库。
 */
export class ApplicationClientAdapter implements Adapter {
  public constructor(private readonly source: ApplicationClientProjectionSource) {}

  public async find(id: string): Promise<AdapterPayload | undefined> {
    const client = await this.source.findByClientId(id);
    if (!client) {
      return undefined;
    }

    return {
      client_id: client.client_id,
      ...(client.client_secret === undefined ? {} : { client_secret: client.client_secret }),
      ...(client.client_name === undefined ? {} : { client_name: client.client_name }),
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      grant_types: client.grant_types,
      response_types: client.response_types,
      redirect_uris: client.redirect_uris,
      post_logout_redirect_uris: client.post_logout_redirect_uris ?? [],
      ...(client.scope === undefined ? {} : { scope: client.scope }),
      require_pkce: client.pkce_policy === "required",
    } as AdapterPayload;
  }

  public async findByUserCode(_userCode: string): Promise<undefined> {
    return undefined;
  }

  public async findByUid(_uid: string): Promise<undefined> {
    return undefined;
  }

  public async upsert(_id: string, _payload: AdapterPayload, _expiresIn?: number): Promise<never> {
    throw new Error("动态 OIDC Client 只能通过 ApplicationService 写入");
  }

  public async destroy(_id: string): Promise<never> {
    throw new Error("动态 OIDC Client 只能通过 ApplicationService 删除或停用");
  }

  public async consume(_id: string): Promise<never> {
    throw new Error("OIDC Client 记录不支持 consume");
  }

  public async revokeByGrantId(_grantId: string): Promise<void> {
    // Client 本身不属于 Grant；关联令牌由通用 OIDC Adapter 撤销。
  }
}
