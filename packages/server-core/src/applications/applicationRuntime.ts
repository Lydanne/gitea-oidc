import {
  ApplicationSecretEncryptor,
  ApplicationService,
  MemoryApplicationRepository,
  OidcClientProjector,
  SqliteApplicationRepository,
} from "@gitea-oidc/applications";
import type { ApplicationClientProjectionSource } from "../adapters/ApplicationClientAdapter.js";
import { type GiteaOidcConfig, resolveApplicationsConfig } from "../config.js";

export interface ApplicationAuthorizationPolicy {
  applicationId: string;
  applicationName: string;
  trustLevel: "first_party" | "third_party";
  consentPolicy: "explicit" | "skip_for_trusted";
  pkcePolicy: "required" | "optional";
  allowedScopes: string[];
  allowedResources: string[];
}

export interface ApplicationClientProjectorFacade extends ApplicationClientProjectionSource {
  findAuthorizationPolicyByClientId(
    clientId: string,
  ): Promise<ApplicationAuthorizationPolicy | undefined>;
}

export interface ApplicationManagementFacade {
  createCustomApplication(
    request: unknown,
    context: { idempotencyKey: string; actor: { type: "user"; id: string } },
  ): Promise<{ replayed: boolean; response: unknown }>;
  listApplicationDetails(): Promise<unknown[]>;
  getApplication(id: string): Promise<unknown>;
  getApplicationConnection(id: string): Promise<unknown>;
  enableApplication(
    id: string,
    context: { expectedVersion: number; actor: { type: "user"; id: string } },
  ): Promise<unknown>;
  disableApplication(
    id: string,
    context: { expectedVersion: number; actor: { type: "user"; id: string } },
  ): Promise<unknown>;
  completeDisableApplication(
    id: string,
    context: { expectedVersion: number; actor: { type: "user"; id: string } },
  ): Promise<unknown>;
  listAuditEvents(id: string): Promise<unknown[]>;
}

export interface ApplicationRuntime {
  applicationService: ApplicationManagementFacade;
  clientProjector: ApplicationClientProjectorFacade;
  recoverPendingDisables(revokeClient: (clientId: string) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** 组装私有应用域，并通过显式 facade 避免公开服务声明泄漏 workspace 私有类型。 */
export async function createApplicationRuntime(
  config: GiteaOidcConfig,
): Promise<ApplicationRuntime | undefined> {
  const applicationsConfig = resolveApplicationsConfig(config);
  if (!applicationsConfig.enabled || applicationsConfig.clientSource !== "database") {
    return undefined;
  }

  const repository =
    applicationsConfig.repository.type === "memory"
      ? new MemoryApplicationRepository()
      : new SqliteApplicationRepository({
          dbPath: applicationsConfig.repository.sqlite?.dbPath ?? "./applications.db",
        });
  const secretEncryptor = ApplicationSecretEncryptor.fromBase64({
    keyId: applicationsConfig.secretEncryption.keyId,
    masterKey: applicationsConfig.secretEncryption.masterKey,
  });
  const supportedScopes = new Set(["openid", "offline_access", ...Object.keys(config.oidc.claims)]);
  const service = new ApplicationService({
    repository,
    secretEncryptor,
    issuer: config.oidc.issuer,
    supportedScopes,
    // 自定义应用的 Provider API 动态授权尚未接入 allowlist，先保持 fail-closed。
    allowProviderApi: false,
    // Resource Indicators 尚未装配前，创建 API 必须拒绝宣称 Resource Server 能力。
    allowedResources: [],
  });
  const projector = new OidcClientProjector(repository, secretEncryptor);

  try {
    const systemScopes = [...supportedScopes].filter(
      (scope) => scope !== "provider_api" && scope !== "offline_access",
    );
    await service.importSystemClients(
      config.clients.map((client) => {
        const providerApi =
          config.providerApi.enabled &&
          config.providerApi.allowedClientIds.includes(client.client_id);
        const allowedScopes = [
          ...systemScopes,
          ...(client.grant_types.includes("refresh_token") ? ["offline_access"] : []),
          ...(providerApi ? ["provider_api"] : []),
        ];
        return {
          name: `System Client (${client.client_id})`,
          clientId: client.client_id,
          clientSecret: client.client_secret,
          redirectUris: client.redirect_uris,
          postLogoutRedirectUris: client.post_logout_redirect_uris ?? [],
          responseTypes: client.response_types as ["code"],
          grantTypes: client.grant_types as Array<"authorization_code" | "refresh_token">,
          tokenEndpointAuthMethod: client.token_endpoint_auth_method as "client_secret_basic",
          allowedScopes: [...new Set(allowedScopes)],
          environment: config.server.url.startsWith("https:") ? "production" : "development",
          // 迁移 Client 保留旧行为；模板能力确认后再显式升级 PKCE。
          pkcePolicy: "optional" as const,
          providerApi,
        };
      }),
    );
  } catch (error) {
    if ("close" in repository && typeof repository.close === "function") {
      await repository.close();
    }
    throw error;
  }

  return {
    applicationService: {
      createCustomApplication: (request, context) =>
        service.createCustomApplication(request as never, context),
      listApplicationDetails: () => service.listApplicationDetails(),
      getApplication: (id) => service.getApplication(id),
      getApplicationConnection: (id) => service.getApplicationConnection(id),
      enableApplication: (id, context) => service.enableApplication(id, context),
      disableApplication: (id, context) => service.disableApplication(id, context),
      completeDisableApplication: (id, context) => service.completeDisableApplication(id, context),
      listAuditEvents: (id) => service.listAuditEvents(id),
    },
    recoverPendingDisables: async (revokeClient) => {
      const pending = (await service.listApplicationDetails()).filter(
        (details) => details.application.status === "disabling",
      );
      for (const details of pending) {
        for (const client of details.clients) {
          await revokeClient(client.clientId);
        }
        await service.completeDisableApplication(details.application.id, {
          expectedVersion: details.application.version,
          actor: { type: "system" },
        });
      }
    },
    clientProjector: {
      findByClientId: (clientId) => projector.findByClientId(clientId),
      findAuthorizationPolicyByClientId: async (clientId) => {
        const policy = await projector.findAuthorizationPolicyByClientId(clientId);
        return policy
          ? {
              applicationId: policy.applicationId,
              applicationName: policy.name,
              trustLevel: policy.trustLevel,
              consentPolicy: policy.consentPolicy,
              pkcePolicy: policy.pkcePolicy,
              allowedScopes: policy.allowedScopes,
              allowedResources: policy.allowedResources,
            }
          : undefined;
      },
    },
    close: async () => {
      if ("close" in repository && typeof repository.close === "function") {
        await repository.close();
      }
    },
  };
}
