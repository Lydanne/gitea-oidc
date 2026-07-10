import type { ParsedApplicationTemplateSnapshot } from "@gitea-oidc/application-templates";
import type {
  ApplicationConnectionV1,
  ApplicationCredentialV1,
  ApplicationDetailsV1,
  ApplicationSecretSummaryV1,
  ApplicationTemplatePreviewV1,
  ApplicationV1,
  CreateCustomApplicationReceiptV1,
  CreateCustomApplicationRequestV1,
  CreateCustomApplicationResponseV1,
  CreateTemplateApplicationReceiptV1,
  CreateTemplateApplicationRequestV1,
  CreateTemplateApplicationResponseV1,
  IntegrationGuideV1,
  OidcClientV1,
  PreviewApplicationTemplateRequestV1,
  RotateApplicationCredentialResponseV1,
} from "@gitea-oidc/contracts";
import { parseApplicationDetailsV1 } from "@gitea-oidc/contracts";

export type {
  ApplicationConnectionV1,
  ApplicationCredentialV1,
  ApplicationDetailsV1,
  ApplicationSecretSummaryV1,
  ApplicationTemplatePreviewV1,
  ApplicationV1,
  CreateCustomApplicationReceiptV1,
  CreateCustomApplicationRequestV1,
  CreateCustomApplicationResponseV1,
  IntegrationGuideV1,
  OidcClientV1,
  PreviewApplicationTemplateRequestV1,
  RotateApplicationCredentialResponseV1,
  CreateTemplateApplicationReceiptV1,
  CreateTemplateApplicationRequestV1,
  CreateTemplateApplicationResponseV1,
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

export interface StoredApplicationAggregate {
  application: ApplicationV1;
  connectionIssuer: string;
  clients: OidcClientV1[];
  secrets: EncryptedApplicationSecret[];
  templateSnapshot?: ParsedApplicationTemplateSnapshot;
}

export type ApplicationAuditEventType =
  | "application.created"
  | "application.imported"
  | "application.disable_started"
  | "application.enabled"
  | "application.disabled"
  | "client_secret.created"
  | "client_secret.rotated";

export interface ApplicationAuditActor {
  type: "system" | "user";
  id?: string;
}

export interface ApplicationAuditSnapshot {
  application?: ApplicationV1;
  clients?: OidcClientV1[];
  secret?: ApplicationSecretSummaryV1;
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

export type CreateTemplateApplicationContext = CreateCustomApplicationContext;

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

export type CreateTemplateApplicationOutcome =
  | {
      replayed: false;
      response: CreateTemplateApplicationResponseV1;
    }
  | {
      replayed: true;
      response: CreateTemplateApplicationReceiptV1;
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

export function toSecretSummary(secret: EncryptedApplicationSecret): ApplicationSecretSummaryV1 {
  const summary: ApplicationSecretSummaryV1 = {
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
  return parseApplicationDetailsV1({
    application: structuredClone(aggregate.application),
    clients: structuredClone(aggregate.clients),
    secrets: aggregate.secrets.map(toSecretSummary),
  });
}
