import type { ApplicationSecretEncryptor } from "./applicationSecretEncryptor.js";
import { ApplicationConflictError } from "./errors.js";
import type { ApplicationRepository } from "./repository.js";
import type { ApplicationAuthorizationPolicyDto, OidcClientProjectionDto } from "./types.js";

export class OidcClientProjector {
  public constructor(
    private readonly repository: ApplicationRepository,
    private readonly secretEncryptor: ApplicationSecretEncryptor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async findByClientId(clientId: string): Promise<OidcClientProjectionDto | undefined> {
    return this.repository.read(async (transaction) => {
      const aggregate = await transaction.findByClientId(clientId);
      const client = aggregate?.clients.find((candidate) => candidate.clientId === clientId);
      if (
        aggregate === undefined ||
        client === undefined ||
        aggregate.application.status !== "active" ||
        client.status !== "active"
      ) {
        return undefined;
      }

      let clientSecret: string | undefined;
      if (client.clientType === "confidential") {
        const now = this.now().getTime();
        const secret = aggregate.secrets
          .filter(
            (candidate) =>
              candidate.oidcClientId === client.id &&
              candidate.status === "active" &&
              (candidate.expiresAt === undefined || Date.parse(candidate.expiresAt) > now),
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        if (secret === undefined) {
          throw new ApplicationConflictError("confidential Client 缺少可用密钥");
        }
        clientSecret = this.secretEncryptor.decrypt(secret);
      }

      return {
        client_id: client.clientId,
        ...(clientSecret === undefined ? {} : { client_secret: clientSecret }),
        client_name: aggregate.application.name,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        grant_types: client.grantTypes,
        response_types: client.responseTypes,
        redirect_uris: client.redirectUris,
        post_logout_redirect_uris: client.postLogoutRedirectUris,
        scope: client.allowedScopes.join(" "),
        application_id: aggregate.application.id,
        application_version: aggregate.application.version,
        pkce_policy: client.pkcePolicy,
        allowed_resources: client.allowedResources,
        capabilities: client.capabilities,
      };
    });
  }

  public async findAuthorizationPolicyByClientId(
    clientId: string,
  ): Promise<ApplicationAuthorizationPolicyDto | undefined> {
    return this.repository.read(async (transaction) => {
      const aggregate = await transaction.findByClientId(clientId);
      const client = aggregate?.clients.find((candidate) => candidate.clientId === clientId);
      if (
        aggregate === undefined ||
        client === undefined ||
        aggregate.application.status !== "active" ||
        client.status !== "active"
      ) {
        return undefined;
      }
      return {
        applicationId: aggregate.application.id,
        name: aggregate.application.name,
        trustLevel: aggregate.application.trustLevel,
        consentPolicy: aggregate.application.consentPolicy,
        pkcePolicy: client.pkcePolicy,
        allowedScopes: client.allowedScopes,
        allowedResources: client.allowedResources,
      };
    });
  }
}
