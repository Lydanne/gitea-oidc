import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ApplicationSecretEncryptor } from "./applicationSecretEncryptor.js";
import {
  ApplicationConflictError,
  ApplicationNotFoundError,
  ApplicationValidationError,
  ApplicationVersionConflictError,
  IdempotencyConflictError,
} from "./errors.js";
import type { ApplicationRepository, ApplicationRepositoryReader } from "./repository.js";
import type {
  ApplicationAuditActor,
  ApplicationAuditEvent,
  ApplicationConnectionV1,
  ApplicationCreationReceiptV1,
  ApplicationDetailsV1,
  ApplicationV1,
  CreateCustomApplicationContext,
  CreateCustomApplicationOutcome,
  CreateCustomApplicationRequestV1,
  CreateCustomApplicationResponseV1,
  IntegrationGuideV1,
  OidcClientV1,
  StoredApplicationAggregate,
  UpdateApplicationContext,
} from "./types.js";
import { toApplicationDetails, toSecretSummary } from "./types.js";
import {
  type NormalizedCreateCustomApplicationRequest,
  validateAndNormalizeCreateCustomRequest,
  validateIssuer,
} from "./validation.js";

export interface ApplicationServiceOptions {
  repository: ApplicationRepository;
  secretEncryptor: ApplicationSecretEncryptor;
  issuer: string;
  supportedScopes?: Iterable<string>;
  allowProviderApi?: boolean;
  allowedResources?: Iterable<string>;
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
    this.now = options.now ?? (() => new Date());
  }

  public async createCustomApplication(
    request: CreateCustomApplicationRequestV1,
    context: CreateCustomApplicationContext,
  ): Promise<CreateCustomApplicationOutcome> {
    const normalized = validateAndNormalizeCreateCustomRequest(request);
    if (
      context.idempotencyKey.length < 8 ||
      context.idempotencyKey.length > 200 ||
      context.idempotencyKey.trim() !== context.idempotencyKey ||
      hasControlCharacters(context.idempotencyKey)
    ) {
      throw new ApplicationValidationError("幂等键必须是 8 到 200 个无控制字符的非空字符");
    }

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
      const response: CreateCustomApplicationResponseV1 = {
        ...base,
        credentialDelivery: {
          kind: "direct",
          credential:
            createdSecret === undefined
              ? { kind: "none" }
              : { kind: "client_secret", clientSecret: createdSecret.plaintext },
        },
      };
      return { replayed: false, response };
    });
  }

  /** 把配置文件 Client 事务性导入为 system Application，供单源 database 模式启动。 */
  public async importSystemClients(
    inputs: SystemClientImportInput[],
  ): Promise<ApplicationDetailsV1[]> {
    if (new Set(inputs.map((input) => input.clientId)).size !== inputs.length) {
      throw new ApplicationConflictError("配置中存在重复的 OIDC client_id");
    }

    return this.repository.transaction(async (transaction) => {
      const imported: ApplicationDetailsV1[] = [];
      for (const input of inputs) {
        this.validateSystemClientImport(input);
        const existing = await transaction.findByClientId(input.clientId);
        if (existing) {
          this.assertSystemClientMatches(existing, input);
          imported.push(toApplicationDetails(existing));
          continue;
        }

        const digest = hash(input.clientId);
        const applicationId = `system-app-${digest.slice(0, 24)}`;
        const oidcClientId = `system-client-${digest.slice(0, 24)}`;
        const now = this.now().toISOString();
        const application: ApplicationV1 = {
          id: applicationId,
          name: input.name,
          slug: `system-${digest.slice(0, 20)}`,
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
      if (current.application.source.kind === "system") {
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

  private assertSystemClientMatches(
    aggregate: StoredApplicationAggregate,
    input: SystemClientImportInput,
  ): void {
    const client = aggregate.clients.find((candidate) => candidate.clientId === input.clientId);
    const secret = client
      ? aggregate.secrets.find(
          (candidate) => candidate.oidcClientId === client.id && candidate.status === "active",
        )
      : undefined;
    if (
      aggregate.application.source.kind !== "system" ||
      aggregate.application.status !== "active" ||
      !client ||
      client.status !== "active" ||
      !secret ||
      stableJson({
        name: aggregate.application.name,
        environment: aggregate.application.environment,
        redirectUris: client.redirectUris,
        postLogoutRedirectUris: client.postLogoutRedirectUris,
        responseTypes: client.responseTypes,
        grantTypes: client.grantTypes,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        allowedScopes: client.allowedScopes,
        pkcePolicy: client.pkcePolicy,
        providerApi: client.capabilities.providerApi,
      }) !==
        stableJson({
          name: input.name,
          environment: input.environment,
          redirectUris: input.redirectUris,
          postLogoutRedirectUris: input.postLogoutRedirectUris,
          responseTypes: input.responseTypes,
          grantTypes: input.grantTypes,
          tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
          allowedScopes: input.allowedScopes,
          pkcePolicy: input.pkcePolicy,
          providerApi: input.providerApi,
        })
    ) {
      throw new ApplicationConflictError(
        `system Client ${input.clientId} 与已导入快照不一致，必须显式迁移`,
      );
    }

    const storedSecret = Buffer.from(this.secretEncryptor.decrypt(secret), "utf8");
    const configuredSecret = Buffer.from(input.clientSecret, "utf8");
    if (
      storedSecret.byteLength !== configuredSecret.byteLength ||
      !timingSafeEqual(storedSecret, configuredSecret)
    ) {
      throw new ApplicationConflictError(
        `system Client ${input.clientId} 的密钥已变化，必须通过轮换流程迁移`,
      );
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
      integrationGuide: this.buildGuide(connection),
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
      issuer: this.issuer,
      clientId: client.clientId,
      clientType: client.clientType,
      clientAuthMethod: client.tokenEndpointAuthMethod,
      redirectUris: client.redirectUris,
      postLogoutRedirectUris: client.postLogoutRedirectUris,
      scopes: client.allowedScopes,
      resources: client.allowedResources,
      flow: "authorization_code",
      pkce: { policy: client.pkcePolicy, methods: ["S256"] },
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

  private buildGuide(connection: ApplicationConnectionV1): IntegrationGuideV1 {
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
