import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type ApplicationTemplateSummary,
  parseApplicationTemplateSnapshot,
  ResolvedApplicationTemplateSchema,
  type TemplateCatalog,
} from "@gitea-oidc/application-templates";
import {
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  ApplicationTemplatePreviewV1Schema,
} from "@gitea-oidc/contracts";
import type { ApplicationSecretEncryptor } from "./applicationSecretEncryptor.js";
import {
  ApplicationConflictError,
  ApplicationNotFoundError,
  ApplicationValidationError,
  ApplicationVersionConflictError,
  IdempotencyConflictError,
} from "./errors.js";
import type {
  ApplicationRepository,
  ApplicationRepositoryReader,
  ApplicationRepositoryTransaction,
} from "./repository.js";
import type {
  ApplicationAuditActor,
  ApplicationAuditEvent,
  ApplicationConnectionV1,
  ApplicationCreationReceiptV1,
  ApplicationDetailsV1,
  ApplicationTemplatePreviewV1,
  ApplicationV1,
  CreateCustomApplicationContext,
  CreateCustomApplicationOutcome,
  CreateCustomApplicationRequestV1,
  CreateCustomApplicationResponseV1,
  CreateTemplateApplicationContext,
  CreateTemplateApplicationOutcome,
  CreateTemplateApplicationRequestV1,
  CreateTemplateApplicationResponseV1,
  IntegrationGuideV1,
  OidcClientV1,
  PreviewApplicationTemplateRequestV1,
  RotateApplicationCredentialResponseV1,
  StoredApplicationAggregate,
  UpdateApplicationContext,
} from "./types.js";
import { toApplicationDetails, toSecretSummary } from "./types.js";
import {
  type NormalizedCreateCustomApplicationRequest,
  type NormalizedCreateTemplateApplicationRequest,
  validateAndNormalizeCreateCustomRequest,
  validateAndNormalizeCreateTemplateRequest,
  validateAndNormalizePreviewTemplateRequest,
  validateIssuer,
} from "./validation.js";

export interface ApplicationServiceOptions {
  repository: ApplicationRepository;
  secretEncryptor: ApplicationSecretEncryptor;
  issuer: string;
  supportedScopes?: Iterable<string>;
  allowProviderApi?: boolean;
  allowedResources?: Iterable<string>;
  templateCatalog?: TemplateCatalog;
  templateClaimScopes?: Readonly<Record<string, readonly string[]>>;
  now?: () => Date;
}

export interface SystemClientImportInput {
  name: string;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  responseTypes: ["code"];
  grantTypes: Array<"authorization_code" | "refresh_token">;
  tokenEndpointAuthMethod: "client_secret_basic";
  allowedScopes: string[];
  environment: "development" | "staging" | "production";
  pkcePolicy: "required" | "optional";
  providerApi: boolean;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function normalizeSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "application"
  );
}

function defaultActor(actor?: ApplicationAuditActor): ApplicationAuditActor {
  return actor ?? { type: "system" };
}

export class ApplicationService {
  private readonly repository: ApplicationRepository;
  private readonly secretEncryptor: ApplicationSecretEncryptor;
  private readonly issuer: string;
  private readonly supportedScopes: Set<string>;
  private readonly allowProviderApi: boolean;
  private readonly allowedResources: Set<string>;
  private readonly templateCatalog?: TemplateCatalog;
  private readonly templateClaimScopes?: Readonly<Record<string, readonly string[]>>;
  private readonly now: () => Date;

  public constructor(options: ApplicationServiceOptions) {
    this.repository = options.repository;
    this.secretEncryptor = options.secretEncryptor;
    this.issuer = validateIssuer(options.issuer);
    this.supportedScopes = new Set(
      options.supportedScopes ?? ["openid", "profile", "email", "offline_access"],
    );
    this.allowProviderApi = options.allowProviderApi ?? false;
    this.allowedResources = new Set(options.allowedResources ?? []);
    this.templateCatalog = options.templateCatalog;
    this.templateClaimScopes = options.templateClaimScopes;
    this.now = options.now ?? (() => new Date());
  }

  public async createCustomApplication(
    request: CreateCustomApplicationRequestV1,
    context: CreateCustomApplicationContext,
  ): Promise<CreateCustomApplicationOutcome> {
    const normalized = validateAndNormalizeCreateCustomRequest(request);
    this.assertIdempotencyKey(context.idempotencyKey);

    const keyHash = hash(context.idempotencyKey);
    const requestHash = hash(stableJson(normalized));
    return this.repository.transaction(async (transaction) => {
      const previous = await transaction.findIdempotencyRecord(keyHash);
      if (previous !== undefined) {
        if (previous.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const aggregate = await transaction.findById(previous.applicationId);
        if (aggregate === undefined) {
          throw new ApplicationConflictError("幂等记录引用的应用不存在");
        }
        return {
          replayed: true,
          response: this.buildReceipt(aggregate),
        };
      }

      this.validateRequestedCapabilities(normalized);

      const now = this.now().toISOString();
      const applicationId = randomUUID();
      const requestedSlug = normalized.application.slug;
      let slug = requestedSlug ?? normalizeSlug(normalized.application.name);
      if ((await transaction.findBySlug(slug)) !== undefined) {
        if (requestedSlug !== undefined) {
          throw new ApplicationConflictError(`应用 slug 已存在: ${slug}`);
        }
        slug = `${slug}-${applicationId.slice(0, 8)}`;
      }

      const application: ApplicationV1 = {
        id: applicationId,
        name: normalized.application.name,
        slug,
        ...(normalized.application.description === undefined
          ? {}
          : { description: normalized.application.description }),
        status: "active",
        source: { kind: "custom", schemaVersion: 1 },
        trustLevel: normalized.application.trustLevel,
        consentPolicy: normalized.application.consentPolicy,
        environment: normalized.application.environment,
        ...(normalized.application.owner === undefined
          ? {}
          : { owner: normalized.application.owner }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const client: OidcClientV1 = {
        id: randomUUID(),
        applicationId,
        clientId: `app_${randomBytes(18).toString("base64url")}`,
        clientType: normalized.client.clientType,
        tokenEndpointAuthMethod:
          normalized.client.clientType === "confidential" ? "client_secret_basic" : "none",
        grantTypes: normalized.client.refreshToken
          ? ["authorization_code", "refresh_token"]
          : ["authorization_code"],
        responseTypes: ["code"],
        redirectUris: normalized.client.redirectUris,
        postLogoutRedirectUris: normalized.client.postLogoutRedirectUris,
        allowedScopes: normalized.client.scopes,
        allowedResources: normalized.client.resources,
        pkcePolicy: normalized.client.pkcePolicy,
        capabilities: { providerApi: normalized.client.providerApi },
        status: "active",
      };

      const createdSecret =
        client.clientType === "confidential"
          ? this.secretEncryptor.createSecret({ oidcClientId: client.id, now: new Date(now) })
          : undefined;
      const aggregate: StoredApplicationAggregate = {
        application,
        connectionIssuer: this.issuer,
        clients: [client],
        secrets: createdSecret === undefined ? [] : [createdSecret.encrypted],
      };
      await transaction.insert(aggregate);
      await transaction.insertIdempotencyRecord({
        keyHash,
        requestHash,
        applicationId,
        createdAt: now,
      });
      await transaction.appendAuditEvent(
        this.auditEvent("application.created", aggregate, defaultActor(context.actor), now),
      );
      if (createdSecret !== undefined) {
        await transaction.appendAuditEvent({
          id: randomUUID(),
          applicationId,
          type: "client_secret.created",
          actor: defaultActor(context.actor),
          after: { secret: toSecretSummary(createdSecret.encrypted) },
          occurredAt: now,
        });
      }

      const base = this.buildResponseBase(aggregate);
      const credentialBinding = {
        schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
        applicationId: base.connection.applicationId,
        oidcClientId: base.connection.oidcClientId,
        issuer: base.connection.issuer,
        clientId: base.connection.clientId,
      };
      const response: CreateCustomApplicationResponseV1 = {
        ...base,
        credentialDelivery: {
          kind: "direct",
          credential:
            createdSecret === undefined
              ? { ...credentialBinding, kind: "none" }
              : {
                  ...credentialBinding,
                  kind: "client_secret",
                  clientSecret: createdSecret.plaintext,
                },
        },
      };
      return { replayed: false, response };
    });
  }

  public listApplicationTemplates(): readonly ApplicationTemplateSummary[] {
    return this.templateCatalog?.list() ?? [];
  }

  public previewApplicationTemplate(
    request: PreviewApplicationTemplateRequestV1,
  ): ApplicationTemplatePreviewV1 {
    const normalized = validateAndNormalizePreviewTemplateRequest(request);
    if (this.templateCatalog === undefined) {
      throw new ApplicationValidationError("当前部署未启用应用模板");
    }

    try {
      const preview = this.templateCatalog.preview(normalized.template, normalized.templateInput, {
        issuer: this.issuer,
        ...(this.templateClaimScopes === undefined
          ? {}
          : { claimScopes: this.templateClaimScopes }),
      });
      const resolution = ResolvedApplicationTemplateSchema.parse(preview.resolution);
      const projection = validateAndNormalizeCreateCustomRequest({
        schemaVersion: 1,
        application: {
          name: "模板预览",
          environment: resolution.application.environment,
          ...(resolution.application.owner === undefined
            ? {}
            : { owner: resolution.application.owner }),
          trustLevel: resolution.application.trustLevel,
          consentPolicy: resolution.application.consentPolicy,
        },
        client: {
          clientType: resolution.client.clientType,
          redirectUris: resolution.client.redirectUris,
          postLogoutRedirectUris: resolution.client.postLogoutRedirectUris,
          scopes: resolution.client.allowedScopes,
          resources: resolution.client.allowedResources,
          refreshToken: resolution.client.capabilities.refreshToken,
          providerApi: resolution.client.capabilities.providerApi,
          resourceServer: resolution.client.capabilities.resourceServer,
          pkcePolicy: resolution.client.pkcePolicy,
        },
        credentialDelivery: "direct",
      });
      this.validateRequestedCapabilities(projection);
      return ApplicationTemplatePreviewV1Schema.parse({
        schemaVersion: 1,
        template: resolution.template,
        issuer: resolution.issuer,
        normalizedInput: preview.normalizedInput,
        application: resolution.application,
        client: {
          clientType: resolution.client.clientType,
          redirectUris: resolution.client.redirectUris,
          postLogoutRedirectUris: resolution.client.postLogoutRedirectUris,
          scopes: resolution.client.allowedScopes,
          resources: resolution.client.allowedResources,
          pkcePolicy: resolution.client.pkcePolicy,
          capabilities: resolution.client.capabilities,
        },
        integrationGuide: resolution.integrationGuide,
        warnings: resolution.warnings,
      });
    } catch (error) {
      if (error instanceof ApplicationValidationError) {
        throw error;
      }
      throw new ApplicationValidationError("模板版本或模板输入无效", { cause: error });
    }
  }

  public async createTemplateApplication(
    request: CreateTemplateApplicationRequestV1,
    context: CreateTemplateApplicationContext,
  ): Promise<CreateTemplateApplicationOutcome> {
    const normalized = validateAndNormalizeCreateTemplateRequest(request);
    this.assertIdempotencyKey(context.idempotencyKey);
    const keyHash = hash(context.idempotencyKey);
    const requestHash = hash(stableJson(normalized));
    return this.repository.transaction(async (transaction) => {
      const previous = await transaction.findIdempotencyRecord(keyHash);
      if (previous !== undefined) {
        if (previous.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const aggregate = await transaction.findById(previous.applicationId);
        if (aggregate === undefined) {
          throw new ApplicationConflictError("幂等记录引用的应用不存在");
        }
        if (
          aggregate.application.source.kind !== "template" ||
          aggregate.application.source.templateId !== normalized.template.id ||
          aggregate.application.source.templateVersion !== normalized.template.version
        ) {
          throw new ApplicationConflictError("幂等记录引用的应用模板与原请求不一致");
        }
        return { replayed: true, response: this.buildReceipt(aggregate) };
      }

      const { templateSnapshot, resolvedClient, validatedProjection } =
        this.resolveTemplateCreation(normalized);

      const now = this.now().toISOString();
      const applicationId = randomUUID();
      const requestedSlug = validatedProjection.application.slug;
      let slug = requestedSlug ?? normalizeSlug(validatedProjection.application.name);
      if ((await transaction.findBySlug(slug)) !== undefined) {
        if (requestedSlug !== undefined) {
          throw new ApplicationConflictError(`应用 slug 已存在: ${slug}`);
        }
        slug = `${slug}-${applicationId.slice(0, 8)}`;
      }

      const application: ApplicationV1 = {
        id: applicationId,
        name: validatedProjection.application.name,
        slug,
        ...(validatedProjection.application.description === undefined
          ? {}
          : { description: validatedProjection.application.description }),
        status: "active",
        source: {
          kind: "template",
          templateId: templateSnapshot.template.id,
          templateVersion: templateSnapshot.template.version,
        },
        trustLevel: validatedProjection.application.trustLevel,
        consentPolicy: validatedProjection.application.consentPolicy,
        environment: validatedProjection.application.environment,
        ...(validatedProjection.application.owner === undefined
          ? {}
          : { owner: validatedProjection.application.owner }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const client: OidcClientV1 = {
        id: randomUUID(),
        applicationId,
        clientId: `app_${randomBytes(18).toString("base64url")}`,
        clientType: resolvedClient.clientType,
        tokenEndpointAuthMethod: resolvedClient.tokenEndpointAuthMethod,
        grantTypes: [...resolvedClient.grantTypes],
        responseTypes: ["code"],
        redirectUris: [...resolvedClient.redirectUris],
        postLogoutRedirectUris: [...resolvedClient.postLogoutRedirectUris],
        allowedScopes: [...resolvedClient.allowedScopes],
        allowedResources: [...resolvedClient.allowedResources],
        pkcePolicy: resolvedClient.pkcePolicy,
        capabilities: { providerApi: resolvedClient.capabilities.providerApi },
        status: "active",
      };
      const createdSecret =
        client.clientType === "confidential"
          ? this.secretEncryptor.createSecret({ oidcClientId: client.id, now: new Date(now) })
          : undefined;
      const aggregate: StoredApplicationAggregate = {
        application,
        connectionIssuer: this.issuer,
        clients: [client],
        secrets: createdSecret === undefined ? [] : [createdSecret.encrypted],
        templateSnapshot,
      };
      await transaction.insert(aggregate);
      await transaction.insertIdempotencyRecord({
        keyHash,
        requestHash,
        applicationId,
        createdAt: now,
      });
      await transaction.appendAuditEvent(
        this.auditEvent("application.created", aggregate, defaultActor(context.actor), now),
      );
      if (createdSecret !== undefined) {
        await transaction.appendAuditEvent({
          id: randomUUID(),
          applicationId,
          type: "client_secret.created",
          actor: defaultActor(context.actor),
          after: { secret: toSecretSummary(createdSecret.encrypted) },
          occurredAt: now,
        });
      }

      const base = this.buildResponseBase(aggregate);
      const credentialBinding = {
        schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
        applicationId: base.connection.applicationId,
        oidcClientId: base.connection.oidcClientId,
        issuer: base.connection.issuer,
        clientId: base.connection.clientId,
      };
      const response: CreateTemplateApplicationResponseV1 = {
        ...base,
        credentialDelivery: {
          kind: "direct",
          credential:
            createdSecret === undefined
              ? { ...credentialBinding, kind: "none" }
              : {
                  ...credentialBinding,
                  kind: "client_secret",
                  clientSecret: createdSecret.plaintext,
                },
        },
      };
      return { replayed: false, response };
    });
  }

  /** 把配置文件 Client 事务性导入或协调为 system Application，供单源 database 模式启动。 */
  public async importSystemClients(
    inputs: SystemClientImportInput[],
  ): Promise<ApplicationDetailsV1[]> {
    if (new Set(inputs.map((input) => input.clientId)).size !== inputs.length) {
      throw new ApplicationConflictError("配置中存在重复的 OIDC client_id");
    }
    for (const input of inputs) {
      this.validateSystemClientImport(input);
    }

    return this.repository.transaction(async (transaction) => {
      const imported: ApplicationDetailsV1[] = [];
      for (const input of inputs) {
        const existing = await transaction.findByClientId(input.clientId);
        if (existing) {
          imported.push(
            toApplicationDetails(await this.reconcileSystemClient(transaction, existing, input)),
          );
          continue;
        }

        const { applicationId, oidcClientId, slug } = this.systemClientIdentity(input.clientId);
        const now = this.now().toISOString();
        const application: ApplicationV1 = {
          id: applicationId,
          name: input.name,
          slug,
          status: "active",
          source: { kind: "system" },
          trustLevel: "first_party",
          consentPolicy: "skip_for_trusted",
          environment: input.environment,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const client: OidcClientV1 = {
          id: oidcClientId,
          applicationId,
          clientId: input.clientId,
          clientType: "confidential",
          tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
          grantTypes: input.grantTypes,
          responseTypes: input.responseTypes,
          redirectUris: input.redirectUris,
          postLogoutRedirectUris: input.postLogoutRedirectUris,
          allowedScopes: input.allowedScopes,
          allowedResources: [],
          pkcePolicy: input.pkcePolicy,
          capabilities: { providerApi: input.providerApi },
          status: "active",
        };
        const secret = this.secretEncryptor.encryptSecret({
          plaintext: input.clientSecret,
          oidcClientId,
          now: new Date(now),
        }).encrypted;
        const aggregate: StoredApplicationAggregate = {
          application,
          connectionIssuer: this.issuer,
          clients: [client],
          secrets: [secret],
        };
        await transaction.insert(aggregate);
        await transaction.appendAuditEvent({
          id: randomUUID(),
          applicationId,
          type: "application.imported",
          actor: { type: "system" },
          after: { application, clients: [client] },
          occurredAt: now,
        });
        imported.push(toApplicationDetails(aggregate));
      }

      const configuredClientIds = new Set(inputs.map((input) => input.clientId));
      for (const aggregate of await transaction.list()) {
        if (aggregate.application.source.kind !== "system") {
          continue;
        }
        const client = this.requireManagedSystemClient(aggregate);
        if (!configuredClientIds.has(client.clientId)) {
          await this.disableMissingSystemClient(transaction, aggregate, client);
        }
      }
      return imported;
    });
  }

  public async listApplications(): Promise<ApplicationV1[]> {
    return this.repository.read(async (transaction) =>
      (await transaction.list()).map((aggregate) => aggregate.application),
    );
  }

  public async listApplicationDetails(): Promise<ApplicationDetailsV1[]> {
    return this.repository.read(async (transaction) =>
      (await transaction.list()).map(toApplicationDetails),
    );
  }

  public async getApplication(id: string): Promise<ApplicationDetailsV1> {
    return this.repository.read(async (transaction) =>
      toApplicationDetails(await this.requireApplication(transaction, id)),
    );
  }

  /** 返回可重复下载的公开接入描述，永远不包含 Client Secret。 */
  public async getApplicationConnection(id: string): Promise<ApplicationConnectionV1> {
    return this.repository.read(async (transaction) =>
      this.buildConnection(await this.requireApplication(transaction, id)),
    );
  }

  /** 返回可重复读取的结构化接入说明；模板说明来自创建时的不可变快照。 */
  public async getApplicationIntegrationGuide(id: string): Promise<IntegrationGuideV1> {
    return this.repository.read(async (transaction) => {
      const aggregate = await this.requireApplication(transaction, id);
      return this.buildGuide(aggregate, this.buildConnection(aggregate));
    });
  }

  /**
   * 原子替换 confidential Client Secret。响应仍是一次性交付；若网络响应丢失，管理员可以读取
   * 新 version 后再次轮换，不需要删除整个 Application。
   */
  public async rotateApplicationSecret(
    id: string,
    context: UpdateApplicationContext,
  ): Promise<RotateApplicationCredentialResponseV1> {
    if (!Number.isSafeInteger(context.expectedVersion) || context.expectedVersion < 1) {
      throw new ApplicationValidationError("expectedVersion 必须是正整数");
    }
    return this.repository.transaction(async (transaction) => {
      const current = await this.requireApplication(transaction, id);
      if (current.application.version !== context.expectedVersion) {
        throw new ApplicationVersionConflictError(
          id,
          context.expectedVersion,
          current.application.version,
        );
      }
      if (current.application.source.kind === "system") {
        throw new ApplicationConflictError("system Application 的密钥只能通过部署配置轮换");
      }
      if (!new Set(["active", "disabled"]).has(current.application.status)) {
        throw new ApplicationConflictError("当前应用状态不允许轮换 Client Secret");
      }
      const client = current.clients[0];
      if (client === undefined || client.clientType !== "confidential") {
        throw new ApplicationConflictError("只有 confidential Client 可以轮换 Client Secret");
      }

      const now = this.now().toISOString();
      const previousSecret = current.secrets
        .filter((secret) => secret.oidcClientId === client.id && secret.status === "active")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      const createdSecret = this.secretEncryptor.createSecret({
        oidcClientId: client.id,
        now: new Date(now),
      });
      const updated: StoredApplicationAggregate = {
        ...current,
        application: {
          ...current.application,
          version: current.application.version + 1,
          updatedAt: now,
        },
        secrets: [
          ...current.secrets.map((secret) =>
            secret.oidcClientId === client.id && secret.status === "active"
              ? { ...secret, status: "revoked" as const }
              : secret,
          ),
          createdSecret.encrypted,
        ],
      };
      await transaction.update(updated, context.expectedVersion);
      await transaction.appendAuditEvent({
        id: randomUUID(),
        applicationId: id,
        type: "client_secret.rotated",
        actor: defaultActor(context.actor),
        ...(previousSecret === undefined
          ? {}
          : { before: { secret: toSecretSummary(previousSecret) } }),
        after: { secret: toSecretSummary(createdSecret.encrypted) },
        occurredAt: now,
      });

      const base = this.buildResponseBase(updated);
      return {
        ...base,
        credentialDelivery: {
          kind: "direct",
          credential: {
            schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
            applicationId: base.connection.applicationId,
            oidcClientId: base.connection.oidcClientId,
            issuer: base.connection.issuer,
            clientId: base.connection.clientId,
            kind: "client_secret",
            clientSecret: createdSecret.plaintext,
          },
        },
      };
    });
  }

  public async enableApplication(
    id: string,
    context: UpdateApplicationContext,
  ): Promise<ApplicationDetailsV1> {
    return this.setStatus(id, "active", context);
  }

  public async disableApplication(
    id: string,
    context: UpdateApplicationContext,
  ): Promise<ApplicationDetailsV1> {
    return this.setStatus(id, "disabling", context);
  }

  public async completeDisableApplication(
    id: string,
    context: UpdateApplicationContext,
  ): Promise<ApplicationDetailsV1> {
    return this.setStatus(id, "disabled", context);
  }

  public async listAuditEvents(id: string): Promise<ApplicationAuditEvent[]> {
    return this.repository.read(async (transaction) => {
      await this.requireApplication(transaction, id);
      return transaction.listAuditEvents(id);
    });
  }

  private async setStatus(
    id: string,
    status: "active" | "disabling" | "disabled",
    context: UpdateApplicationContext,
  ): Promise<ApplicationDetailsV1> {
    if (!Number.isSafeInteger(context.expectedVersion) || context.expectedVersion < 1) {
      throw new ApplicationValidationError("expectedVersion 必须是正整数");
    }
    return this.repository.transaction(async (transaction) => {
      const current = await this.requireApplication(transaction, id);
      if (current.application.version !== context.expectedVersion) {
        throw new ApplicationVersionConflictError(
          id,
          context.expectedVersion,
          current.application.version,
        );
      }
      if (current.application.status === status) {
        return toApplicationDetails(current);
      }
      if (current.application.status === "deleted") {
        throw new ApplicationConflictError("已删除的应用不能变更状态");
      }
      const systemDisableCompletion =
        current.application.source.kind === "system" &&
        current.application.status === "disabling" &&
        status === "disabled" &&
        context.actor?.type === "system";
      if (current.application.source.kind === "system" && !systemDisableCompletion) {
        throw new ApplicationConflictError("system Application 只能通过服务配置管理状态");
      }
      const transition = `${current.application.status}->${status}`;
      if (
        !new Set(["active->disabling", "disabling->disabled", "disabled->active"]).has(transition)
      ) {
        throw new ApplicationConflictError(`不允许的应用状态转换: ${transition}`);
      }
      const now = this.now().toISOString();
      const updated: StoredApplicationAggregate = {
        ...current,
        application: {
          ...current.application,
          status,
          version: current.application.version + 1,
          updatedAt: now,
        },
        clients: current.clients.map((client) => ({
          ...client,
          status: status === "active" ? "active" : "disabled",
        })),
      };
      await transaction.update(updated, context.expectedVersion);
      await transaction.appendAuditEvent({
        id: randomUUID(),
        applicationId: id,
        type:
          status === "active"
            ? "application.enabled"
            : status === "disabling"
              ? "application.disable_started"
              : "application.disabled",
        actor: defaultActor(context.actor),
        before: { application: current.application, clients: current.clients },
        after: { application: updated.application, clients: updated.clients },
        occurredAt: now,
      });
      return toApplicationDetails(updated);
    });
  }

  private async requireApplication(
    transaction: ApplicationRepositoryReader,
    id: string,
  ): Promise<StoredApplicationAggregate> {
    const aggregate = await transaction.findById(id);
    if (aggregate === undefined) {
      throw new ApplicationNotFoundError(id);
    }
    return aggregate;
  }

  private assertIdempotencyKey(idempotencyKey: string): void {
    if (
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 200 ||
      idempotencyKey.trim() !== idempotencyKey ||
      hasControlCharacters(idempotencyKey)
    ) {
      throw new ApplicationValidationError("幂等键必须是 8 到 200 个无控制字符的非空字符");
    }
  }

  private resolveTemplateCreation(normalized: NormalizedCreateTemplateApplicationRequest) {
    if (this.templateCatalog === undefined) {
      throw new ApplicationValidationError("当前部署未启用应用模板");
    }

    let templateSnapshot: ReturnType<typeof parseApplicationTemplateSnapshot>;
    try {
      const resolution = this.templateCatalog.resolve(
        normalized.template,
        normalized.templateInput,
        {
          issuer: this.issuer,
          ...(this.templateClaimScopes === undefined
            ? {}
            : { claimScopes: this.templateClaimScopes }),
        },
      );
      templateSnapshot = parseApplicationTemplateSnapshot(resolution.snapshot);
    } catch (error) {
      throw new ApplicationValidationError("模板版本或模板输入无效", { cause: error });
    }
    if (
      templateSnapshot.template.id !== normalized.template.id ||
      templateSnapshot.template.version !== normalized.template.version ||
      templateSnapshot.resolution.template.id !== normalized.template.id ||
      templateSnapshot.resolution.template.version !== normalized.template.version
    ) {
      throw new ApplicationValidationError("模板解析结果与请求的模板版本不一致");
    }

    const resolvedApplication = templateSnapshot.resolution.application;
    const resolvedClient = templateSnapshot.resolution.client;
    const validatedProjection = validateAndNormalizeCreateCustomRequest({
      schemaVersion: 1,
      application: {
        name: normalized.application.name,
        ...(normalized.application.slug === undefined ? {} : { slug: normalized.application.slug }),
        ...(normalized.application.description === undefined
          ? {}
          : { description: normalized.application.description }),
        environment: resolvedApplication.environment,
        ...(resolvedApplication.owner === undefined ? {} : { owner: resolvedApplication.owner }),
        trustLevel: resolvedApplication.trustLevel,
        consentPolicy: resolvedApplication.consentPolicy,
      },
      client: {
        clientType: resolvedClient.clientType,
        redirectUris: resolvedClient.redirectUris,
        postLogoutRedirectUris: resolvedClient.postLogoutRedirectUris,
        scopes: resolvedClient.allowedScopes,
        resources: resolvedClient.allowedResources,
        refreshToken: resolvedClient.capabilities.refreshToken,
        providerApi: resolvedClient.capabilities.providerApi,
        resourceServer: resolvedClient.capabilities.resourceServer,
        pkcePolicy: resolvedClient.pkcePolicy,
      },
      credentialDelivery: "direct",
    });
    const expectedAuthMethod =
      resolvedClient.clientType === "confidential" ? "client_secret_basic" : "none";
    const expectedGrantTypes = resolvedClient.capabilities.refreshToken
      ? ["authorization_code", "refresh_token"]
      : ["authorization_code"];
    if (
      resolvedClient.tokenEndpointAuthMethod !== expectedAuthMethod ||
      stableJson(resolvedClient.grantTypes) !== stableJson(expectedGrantTypes)
    ) {
      throw new ApplicationValidationError("模板解析结果的 OIDC Client 能力不一致");
    }
    this.validateRequestedCapabilities(validatedProjection);
    return { templateSnapshot, resolvedClient, validatedProjection };
  }

  private validateRequestedCapabilities(request: NormalizedCreateCustomApplicationRequest): void {
    const unsupportedScope = request.client.scopes.find(
      (scope) => !this.supportedScopes.has(scope),
    );
    if (unsupportedScope !== undefined) {
      throw new ApplicationValidationError(`服务端不支持 scope: ${unsupportedScope}`);
    }
    if (request.client.providerApi && !this.allowProviderApi) {
      throw new ApplicationValidationError("当前部署未允许新应用启用 Provider API capability");
    }
    if (request.client.providerApi !== request.client.scopes.includes("provider_api")) {
      throw new ApplicationValidationError(
        "providerApi capability 必须与 provider_api scope 双向一致",
      );
    }
    const disallowedResource = request.client.resources.find(
      (resource) => !this.allowedResources.has(resource),
    );
    if (disallowedResource !== undefined) {
      throw new ApplicationValidationError(`服务端未允许 resource: ${disallowedResource}`);
    }
    if (request.client.resourceServer !== request.client.resources.length > 0) {
      throw new ApplicationValidationError("resourceServer capability 必须与 resources 配置一致");
    }
  }

  private validateSystemClientImport(input: SystemClientImportInput): void {
    if (
      input.clientId.trim() !== input.clientId ||
      input.clientId.length === 0 ||
      input.clientId.length > 255 ||
      hasControlCharacters(input.clientId)
    ) {
      throw new ApplicationValidationError("system Client 的 client_id 格式无效");
    }
    if (!input.grantTypes.includes("authorization_code")) {
      throw new ApplicationValidationError("system Client 必须支持 authorization_code");
    }
    if (!input.allowedScopes.includes("openid")) {
      throw new ApplicationValidationError("system Client 必须允许 openid scope");
    }
    if (
      input.grantTypes.includes("refresh_token") !== input.allowedScopes.includes("offline_access")
    ) {
      throw new ApplicationValidationError(
        "system Client 的 refresh_token 必须与 offline_access 双向一致",
      );
    }
    if (input.providerApi !== input.allowedScopes.includes("provider_api")) {
      throw new ApplicationValidationError(
        "system Client 的 Provider API capability 必须与 provider_api scope 双向一致",
      );
    }
    const unsupportedScope = input.allowedScopes.find((scope) => !this.supportedScopes.has(scope));
    if (unsupportedScope) {
      throw new ApplicationValidationError(`system Client 使用不支持的 scope: ${unsupportedScope}`);
    }
    validateAndNormalizeCreateCustomRequest({
      schemaVersion: 1,
      application: {
        name: input.name,
        environment: input.environment,
        trustLevel: "first_party",
        consentPolicy: "skip_for_trusted",
      },
      client: {
        clientType: "confidential",
        redirectUris: input.redirectUris,
        postLogoutRedirectUris: input.postLogoutRedirectUris,
        scopes: input.allowedScopes,
        resources: [],
        refreshToken: input.grantTypes.includes("refresh_token"),
        providerApi: input.providerApi,
        resourceServer: false,
        pkcePolicy: input.pkcePolicy,
      },
      credentialDelivery: "direct",
    });
  }

  private async reconcileSystemClient(
    transaction: ApplicationRepositoryTransaction,
    aggregate: StoredApplicationAggregate,
    input: SystemClientImportInput,
  ): Promise<StoredApplicationAggregate> {
    const client = this.requireManagedSystemClient(aggregate, input.clientId);
    // 上一次启动若在 OIDC Artifact 撤销前中断，必须先完成停用，不能直接恢复 Client。
    if (aggregate.application.status === "disabling") {
      return aggregate;
    }
    const currentMetadata = this.systemClientMetadata(aggregate, client);
    const desiredMetadata = {
      issuer: this.issuer,
      name: input.name,
      applicationStatus: "active",
      trustLevel: "first_party",
      consentPolicy: "skip_for_trusted",
      environment: input.environment,
      clientType: "confidential",
      clientStatus: "active",
      redirectUris: input.redirectUris,
      postLogoutRedirectUris: input.postLogoutRedirectUris,
      responseTypes: input.responseTypes,
      grantTypes: input.grantTypes,
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      allowedScopes: input.allowedScopes,
      allowedResources: [],
      pkcePolicy: input.pkcePolicy,
      providerApi: input.providerApi,
    };
    const metadataChanged = stableJson(currentMetadata) !== stableJson(desiredMetadata);
    const activeSecrets = aggregate.secrets
      .filter((candidate) => candidate.oidcClientId === client.id && candidate.status === "active")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const secretChanged =
      activeSecrets.length !== 1 || !this.systemClientSecretMatches(activeSecrets[0], input);
    if (!metadataChanged && !secretChanged) {
      return aggregate;
    }

    const now = this.now().toISOString();
    const createdSecret = secretChanged
      ? this.secretEncryptor.encryptSecret({
          plaintext: input.clientSecret,
          oidcClientId: client.id,
          now: new Date(now),
        }).encrypted
      : undefined;
    const updatedClient: OidcClientV1 = {
      ...client,
      clientType: "confidential",
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      grantTypes: input.grantTypes,
      responseTypes: input.responseTypes,
      redirectUris: input.redirectUris,
      postLogoutRedirectUris: input.postLogoutRedirectUris,
      allowedScopes: input.allowedScopes,
      allowedResources: [],
      pkcePolicy: input.pkcePolicy,
      capabilities: { providerApi: input.providerApi },
      status: "active",
    };
    const updated: StoredApplicationAggregate = {
      ...aggregate,
      application: {
        ...aggregate.application,
        name: input.name,
        status: "active",
        trustLevel: "first_party",
        consentPolicy: "skip_for_trusted",
        environment: input.environment,
        version: aggregate.application.version + 1,
        updatedAt: now,
      },
      connectionIssuer: this.issuer,
      clients: [updatedClient],
      secrets:
        createdSecret === undefined
          ? aggregate.secrets
          : [
              ...aggregate.secrets.map((secret) =>
                secret.oidcClientId === client.id && secret.status === "active"
                  ? { ...secret, status: "revoked" as const }
                  : secret,
              ),
              createdSecret,
            ],
    };
    await transaction.update(updated, aggregate.application.version);
    if (metadataChanged) {
      await transaction.appendAuditEvent({
        id: randomUUID(),
        applicationId: aggregate.application.id,
        type: "application.imported",
        actor: { type: "system" },
        before: { application: aggregate.application, clients: aggregate.clients },
        after: { application: updated.application, clients: updated.clients },
        occurredAt: now,
      });
    }
    if (createdSecret !== undefined) {
      await transaction.appendAuditEvent({
        id: randomUUID(),
        applicationId: aggregate.application.id,
        type: "client_secret.rotated",
        actor: { type: "system" },
        ...(activeSecrets[0] === undefined
          ? {}
          : { before: { secret: toSecretSummary(activeSecrets[0]) } }),
        after: { secret: toSecretSummary(createdSecret) },
        occurredAt: now,
      });
    }
    return updated;
  }

  private async disableMissingSystemClient(
    transaction: ApplicationRepositoryTransaction,
    aggregate: StoredApplicationAggregate,
    client: OidcClientV1,
  ): Promise<void> {
    const activeSecrets = aggregate.secrets.filter(
      (candidate) => candidate.oidcClientId === client.id && candidate.status === "active",
    );
    if (
      new Set(["disabling", "disabled"]).has(aggregate.application.status) &&
      aggregate.clients.every((candidate) => candidate.status === "disabled") &&
      activeSecrets.length === 0
    ) {
      return;
    }

    const now = this.now().toISOString();
    const updated: StoredApplicationAggregate = {
      ...aggregate,
      application: {
        ...aggregate.application,
        status: "disabling",
        version: aggregate.application.version + 1,
        updatedAt: now,
      },
      clients: aggregate.clients.map((candidate) => ({
        ...candidate,
        status: "disabled" as const,
      })),
      secrets: aggregate.secrets.map((secret) =>
        secret.status === "active" ? { ...secret, status: "revoked" as const } : secret,
      ),
    };
    await transaction.update(updated, aggregate.application.version);
    await transaction.appendAuditEvent({
      id: randomUUID(),
      applicationId: aggregate.application.id,
      type: "application.disable_started",
      actor: { type: "system" },
      before: { application: aggregate.application, clients: aggregate.clients },
      after: { application: updated.application, clients: updated.clients },
      occurredAt: now,
    });
    for (const activeSecret of activeSecrets) {
      await transaction.appendAuditEvent({
        id: randomUUID(),
        applicationId: aggregate.application.id,
        type: "client_secret.revoked",
        actor: { type: "system" },
        before: { secret: toSecretSummary(activeSecret) },
        after: { secret: toSecretSummary({ ...activeSecret, status: "revoked" }) },
        occurredAt: now,
      });
    }
  }

  private requireManagedSystemClient(
    aggregate: StoredApplicationAggregate,
    expectedClientId?: string,
  ): OidcClientV1 {
    const client = aggregate.clients[0];
    const clientId = expectedClientId ?? client?.clientId;
    if (clientId === undefined) {
      throw new ApplicationConflictError("system Application 缺少 OIDC Client");
    }
    const identity = this.systemClientIdentity(clientId);
    if (
      aggregate.application.source.kind !== "system" ||
      aggregate.application.id !== identity.applicationId ||
      aggregate.application.slug !== identity.slug ||
      !new Set(["active", "disabling", "disabled"]).has(aggregate.application.status) ||
      aggregate.clients.length !== 1 ||
      client === undefined ||
      client.id !== identity.oidcClientId ||
      client.applicationId !== aggregate.application.id ||
      client.clientId !== clientId ||
      !new Set(["active", "disabled"]).has(client.status)
    ) {
      throw new ApplicationConflictError(
        `OIDC client_id 已由非托管 system Application 占用: ${clientId}`,
      );
    }
    return client;
  }

  private systemClientIdentity(clientId: string): {
    applicationId: string;
    oidcClientId: string;
    slug: string;
  } {
    const digest = hash(clientId);
    return {
      applicationId: `system-app-${digest.slice(0, 24)}`,
      oidcClientId: `system-client-${digest.slice(0, 24)}`,
      slug: `system-${digest.slice(0, 20)}`,
    };
  }

  private systemClientMetadata(
    aggregate: StoredApplicationAggregate,
    client: OidcClientV1,
  ): Record<string, unknown> {
    return {
      issuer: aggregate.connectionIssuer,
      name: aggregate.application.name,
      applicationStatus: aggregate.application.status,
      trustLevel: aggregate.application.trustLevel,
      consentPolicy: aggregate.application.consentPolicy,
      environment: aggregate.application.environment,
      clientType: client.clientType,
      clientStatus: client.status,
      redirectUris: client.redirectUris,
      postLogoutRedirectUris: client.postLogoutRedirectUris,
      responseTypes: client.responseTypes,
      grantTypes: client.grantTypes,
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      allowedScopes: client.allowedScopes,
      allowedResources: client.allowedResources,
      pkcePolicy: client.pkcePolicy,
      providerApi: client.capabilities.providerApi,
    };
  }

  private systemClientSecretMatches(
    secret: StoredApplicationAggregate["secrets"][number] | undefined,
    input: SystemClientImportInput,
  ): boolean {
    if (secret === undefined) {
      return false;
    }
    const storedSecret = Buffer.from(this.secretEncryptor.decrypt(secret), "utf8");
    const configuredSecret = Buffer.from(input.clientSecret, "utf8");
    try {
      return (
        storedSecret.byteLength === configuredSecret.byteLength &&
        timingSafeEqual(storedSecret, configuredSecret)
      );
    } finally {
      storedSecret.fill(0);
      configuredSecret.fill(0);
    }
  }

  private buildResponseBase(
    aggregate: StoredApplicationAggregate,
  ): Omit<CreateCustomApplicationResponseV1, "credentialDelivery"> {
    const connection = this.buildConnection(aggregate);
    return {
      schemaVersion: 1,
      application: aggregate.application,
      client: aggregate.clients[0]!,
      connection,
      integrationGuide: this.buildGuide(aggregate, connection),
    };
  }

  private buildConnection(aggregate: StoredApplicationAggregate): ApplicationConnectionV1 {
    const client = aggregate.clients[0];
    if (client === undefined) {
      throw new ApplicationConflictError("应用缺少 OIDC Client");
    }
    return {
      schemaVersion: 1,
      applicationId: aggregate.application.id,
      oidcClientId: client.id,
      issuer: aggregate.connectionIssuer,
      clientId: client.clientId,
      clientType: client.clientType,
      clientAuthMethod: client.tokenEndpointAuthMethod,
      redirectUris: client.redirectUris,
      postLogoutRedirectUris: client.postLogoutRedirectUris,
      scopes: client.allowedScopes,
      resources: client.allowedResources,
      flow: "authorization_code",
      pkce: { policy: client.pkcePolicy, methods: ["S256"] },
      ...(aggregate.application.source.kind === "template"
        ? {
            template: {
              id: aggregate.application.source.templateId,
              version: aggregate.application.source.templateVersion,
            },
          }
        : {}),
      capabilities: {
        refreshToken: client.grantTypes.includes("refresh_token"),
        providerApi: client.capabilities.providerApi,
        resourceServer: client.allowedResources.length > 0,
      },
    };
  }

  private buildReceipt(aggregate: StoredApplicationAggregate): ApplicationCreationReceiptV1 {
    return {
      ...this.buildResponseBase(aggregate),
      credentialDelivery: { kind: "already_delivered" },
    };
  }

  private buildGuide(
    aggregate: StoredApplicationAggregate,
    connection: ApplicationConnectionV1,
  ): IntegrationGuideV1 {
    if (aggregate.application.source.kind === "template") {
      if (aggregate.templateSnapshot === undefined) {
        throw new ApplicationConflictError("模板应用缺少不可变模板快照");
      }
      return structuredClone(aggregate.templateSnapshot.resolution.integrationGuide);
    }
    return {
      schemaVersion: 1,
      title: "自定义 OIDC 应用接入",
      description: "以下连接参数可重复查看，Client Secret 仅在创建响应中交付一次。",
      nodes: [
        { kind: "field", label: "Issuer", value: connection.issuer, copyable: true },
        { kind: "field", label: "Client ID", value: connection.clientId, copyable: true },
        {
          kind: "field",
          label: "Redirect URI",
          value: connection.redirectUris[0] ?? "",
          copyable: true,
        },
        { kind: "warning", text: "不要把 Client Secret 写入前端代码、日志或版本库。" },
      ],
    };
  }

  private auditEvent(
    type: "application.created",
    aggregate: StoredApplicationAggregate,
    actor: ApplicationAuditActor,
    occurredAt: string,
  ): ApplicationAuditEvent {
    return {
      id: randomUUID(),
      applicationId: aggregate.application.id,
      type,
      actor,
      after: { application: aggregate.application, clients: aggregate.clients },
      occurredAt,
    };
  }
}
