import type { ApplicationTemplateFormV1, IntegrationGuideV1 } from "@gitea-oidc/contracts";
import type { z } from "zod";
import type { DeepReadonly } from "./jsonSnapshot.js";

export const APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface ApplicationTemplateReference {
  readonly id: string;
  readonly version: number;
}

export interface ApplicationTemplateSummary {
  readonly reference: ApplicationTemplateReference;
  readonly name: string;
  readonly description: string;
  readonly supportedVersions: readonly string[];
  readonly form: DeepReadonly<ApplicationTemplateFormV1>;
}

export interface TemplateResolutionContext {
  readonly issuer: string;
  readonly claimScopes?: Readonly<Record<string, readonly string[]>>;
}

export interface ResolvedTemplateApplicationDefaults {
  readonly environment: "development" | "staging" | "production";
  readonly owner?: string;
  readonly trustLevel: "third_party";
  readonly consentPolicy: "explicit";
}

export interface ResolvedTemplateOidcClient {
  readonly clientType: "confidential" | "public";
  readonly tokenEndpointAuthMethod: "client_secret_basic" | "none";
  readonly grantTypes: readonly ("authorization_code" | "refresh_token")[];
  readonly responseTypes: readonly ["code"];
  readonly redirectUris: readonly string[];
  readonly postLogoutRedirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly allowedResources: readonly string[];
  readonly pkcePolicy: "required" | "optional";
  readonly capabilities: {
    readonly refreshToken: boolean;
    readonly providerApi: boolean;
    readonly resourceServer: boolean;
  };
}

export interface ResolvedApplicationTemplate {
  readonly schemaVersion: 1;
  readonly template: ApplicationTemplateReference;
  readonly issuer: string;
  readonly application: ResolvedTemplateApplicationDefaults;
  readonly target: {
    readonly product: string;
    readonly version: string;
    readonly baseUrl: string;
  };
  readonly client: ResolvedTemplateOidcClient;
  readonly integrationGuide: IntegrationGuideV1;
  readonly warnings: readonly string[];
}

export interface ApplicationTemplateSnapshot<
  NormalizedInput = unknown,
  Resolution extends ResolvedApplicationTemplate = ResolvedApplicationTemplate,
> {
  readonly schemaVersion: typeof APPLICATION_TEMPLATE_SNAPSHOT_SCHEMA_VERSION;
  readonly template: ApplicationTemplateReference;
  readonly normalizedInput: DeepReadonly<NormalizedInput>;
  readonly resolution: DeepReadonly<Resolution>;
}

export interface ApplicationTemplatePreview<
  NormalizedInput = unknown,
  Resolution extends ResolvedApplicationTemplate = ResolvedApplicationTemplate,
> {
  readonly template: ApplicationTemplateReference;
  readonly normalizedInput: DeepReadonly<NormalizedInput>;
  readonly resolution: DeepReadonly<Resolution>;
}

export interface ApplicationTemplateResolution<
  NormalizedInput = unknown,
  Resolution extends ResolvedApplicationTemplate = ResolvedApplicationTemplate,
> extends ApplicationTemplatePreview<NormalizedInput, Resolution> {
  readonly snapshot: ApplicationTemplateSnapshot<NormalizedInput, Resolution>;
}

export interface ApplicationTemplateDefinition<
  NormalizedInput = unknown,
  Resolution extends ResolvedApplicationTemplate = ResolvedApplicationTemplate,
> {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly supportedVersions: readonly string[];
  readonly form: DeepReadonly<ApplicationTemplateFormV1>;
  readonly inputSchema: z.ZodType<NormalizedInput>;
  preview(
    input: unknown,
    context: TemplateResolutionContext,
  ): ApplicationTemplatePreview<NormalizedInput, Resolution>;
  resolve(
    input: unknown,
    context: TemplateResolutionContext,
  ): ApplicationTemplateResolution<NormalizedInput, Resolution>;
}

export interface TemplateCatalog {
  list(): readonly ApplicationTemplateSummary[];
  get(reference: ApplicationTemplateReference): ApplicationTemplateDefinition;
  getLatest(templateId: string): ApplicationTemplateDefinition;
  preview(
    reference: ApplicationTemplateReference,
    input: unknown,
    context: TemplateResolutionContext,
  ): ApplicationTemplatePreview;
  resolve(
    reference: ApplicationTemplateReference,
    input: unknown,
    context: TemplateResolutionContext,
  ): ApplicationTemplateResolution;
}
