import type {
  ApplicationConnectionV1,
  ApplicationCredentialV1,
  ApplicationV1,
  CreateCustomApplicationReceiptV1,
  CreateCustomApplicationRequestV1,
  CreateCustomApplicationResponseV1,
  IntegrationGuideV1,
  OidcClientV1,
} from "@gitea-oidc/contracts";

export type {
  ApplicationConnectionV1,
  ApplicationCredentialV1,
  ApplicationV1,
  CreateCustomApplicationReceiptV1,
  CreateCustomApplicationRequestV1,
  CreateCustomApplicationResponseV1,
  IntegrationGuideV1,
  OidcClientV1,
};

export interface EncryptedApplicationSecret {
  id: string;
  oidcClientId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
  fingerprint: string;
  status: "active" | "revoked" | "expired";
  deliveredAt: string;
  createdAt: string;
  expiresAt?: string;
}

export interface ApplicationSecretSummary {
  id: string;
  oidcClientId: string;
  keyId: string;
  fingerprint: string;
  status: EncryptedApplicationSecret["status"];
  deliveredAt: string;
  createdAt: string;
  expiresAt?: string;
}

export interface StoredApplicationAggregate {
  application: ApplicationV1;
  clients: OidcClientV1[];
  secrets: EncryptedApplicationSecret[];
}

export interface ApplicationDetailsV1 {
  application: ApplicationV1;
  clients: OidcClientV1[];
  secrets: ApplicationSecretSummary[];
}

export type ApplicationAuditEventType =
  | "application.created"
  | "application.imported"
  | "application.disable_started"
  | "application.enabled"
  | "application.disabled"
  | "client_secret.created";

export interface ApplicationAuditActor {
  type: "system" | "user";
  id?: string;
}

export interface ApplicationAuditSnapshot {
  application?: ApplicationV1;
  clients?: OidcClientV1[];
  secret?: ApplicationSecretSummary;
}

export interface ApplicationAuditEvent {
  id: string;
  applicationId: string;
  type: ApplicationAuditEventType;
  actor: ApplicationAuditActor;
  before?: ApplicationAuditSnapshot;
  after?: ApplicationAuditSnapshot;
  occurredAt: string;
}

export interface ApplicationIdempotencyRecord {
  keyHash: string;
  requestHash: string;
  applicationId: string;
  createdAt: string;
}

export interface ApplicationMutationContext {
  actor?: ApplicationAuditActor;
}

export interface CreateCustomApplicationContext extends ApplicationMutationContext {
  idempotencyKey: string;
}

export interface UpdateApplicationContext extends ApplicationMutationContext {
  expectedVersion: number;
}

export type ApplicationCreationReceiptV1 = CreateCustomApplicationReceiptV1;

export type CreateCustomApplicationOutcome =
  | {
      replayed: false;
      response: CreateCustomApplicationResponseV1;
    }
  | {
      replayed: true;
      response: ApplicationCreationReceiptV1;
    };

export interface OidcClientProjectionDto {
  client_id: string;
  client_secret?: string;
  client_name: string;
  token_endpoint_auth_method: "client_secret_basic" | "none";
  grant_types: string[];
  response_types: string[];
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  scope: string;
  application_id: string;
  application_version: number;
  pkce_policy: "required" | "optional";
  allowed_resources: string[];
  capabilities: {
    providerApi: boolean;
  };
}

export interface ApplicationAuthorizationPolicyDto {
  applicationId: string;
  name: string;
  trustLevel: ApplicationV1["trustLevel"];
  consentPolicy: ApplicationV1["consentPolicy"];
  pkcePolicy: OidcClientV1["pkcePolicy"];
  allowedScopes: string[];
  allowedResources: string[];
}

export function toSecretSummary(secret: EncryptedApplicationSecret): ApplicationSecretSummary {
  const summary: ApplicationSecretSummary = {
    id: secret.id,
    oidcClientId: secret.oidcClientId,
    keyId: secret.keyId,
    fingerprint: secret.fingerprint,
    status: secret.status,
    deliveredAt: secret.deliveredAt,
    createdAt: secret.createdAt,
  };

  if (secret.expiresAt !== undefined) {
    summary.expiresAt = secret.expiresAt;
  }

  return summary;
}

export function toApplicationDetails(aggregate: StoredApplicationAggregate): ApplicationDetailsV1 {
  return {
    application: structuredClone(aggregate.application),
    clients: structuredClone(aggregate.clients),
    secrets: aggregate.secrets.map(toSecretSummary),
  };
}
