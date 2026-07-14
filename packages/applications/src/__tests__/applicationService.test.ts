import { applicationTemplateCatalog } from "@gitea-oidc/application-templates";
import { describe, expect, it } from "vitest";
import { ApplicationSecretEncryptor } from "../applicationSecretEncryptor.js";
import { ApplicationService } from "../applicationService.js";
import {
  ApplicationConflictError,
  ApplicationValidationError,
  ApplicationVersionConflictError,
  IdempotencyConflictError,
  SecretDecryptionError,
} from "../errors.js";
import { MemoryApplicationRepository } from "../memoryApplicationRepository.js";
import { OidcClientProjector } from "../oidcClientProjector.js";
import type {
  CreateCustomApplicationRequestV1,
  CreateTemplateApplicationRequestV1,
} from "../types.js";

const request: CreateCustomApplicationRequestV1 = {
  schemaVersion: 1,
  application: {
    name: "示例应用",
    slug: "example-app",
    environment: "production",
  },
  client: {
    clientType: "confidential",
    redirectUris: ["https://app.example.com/oidc/callback"],
  },
  credentialDelivery: "direct",
};

const templateRequest: CreateTemplateApplicationRequestV1 = {
  schemaVersion: 1,
  template: { id: "gitea", version: 1 },
  application: { name: "研发 Gitea", slug: "engineering-gitea" },
  templateInput: {
    giteaBaseUrl: "https://git.example.com",
    authSourceName: "company-sso",
    targetVersion: "1.26",
    environment: "production",
  },
  credentialDelivery: "direct",
};

function createFixture() {
  const repository = new MemoryApplicationRepository();
  const secretEncryptor = new ApplicationSecretEncryptor({
    keyId: "applications-v1",
    masterKey: Buffer.alloc(32, 7),
  });
  const service = new ApplicationService({
    repository,
    secretEncryptor,
    issuer: "https://id.example.com",
    templateCatalog: applicationTemplateCatalog,
    templateClaimScopes: {
      openid: ["sub"],
      profile: ["name", "email", "groups"],
      email: ["email", "email_verified"],
    },
    now: () => new Date("2026-07-10T00:00:00.000Z"),
  });
  return { repository, secretEncryptor, service };
}

describe("ApplicationService", () => {
  it("从精确版本的 Gitea 模板创建应用并持久化可重复读取的接入说明", async () => {
    const { repository, service } = createFixture();

    expect(service.listApplicationTemplates()).toEqual([
      expect.objectContaining({
        reference: { id: "gitea", version: 1 },
        supportedVersions: ["1.24", "1.25", "1.26"],
        form: expect.objectContaining({ fields: expect.any(Array) }),
      }),
      expect.objectContaining({
        reference: { id: "gitea", version: 2 },
        supportedVersions: ["1.24", "1.25", "1.26"],
        form: expect.objectContaining({ fields: expect.any(Array) }),
      }),
    ]);
    expect(
      service.previewApplicationTemplate({
        schemaVersion: 1,
        template: templateRequest.template,
        templateInput: { ...templateRequest.templateInput, groupClaimName: "groups" },
      }),
    ).toMatchObject({
      template: { id: "gitea", version: 1 },
      issuer: "https://id.example.com",
      client: {
        redirectUris: ["https://git.example.com/user/oauth2/company-sso/callback"],
        scopes: ["openid", "profile", "email"],
      },
    });
    const outcome = await service.createTemplateApplication(templateRequest, {
      idempotencyKey: "create-gitea-template",
      actor: { type: "user", id: "admin-1" },
    });

    expect(outcome.replayed).toBe(false);
    if (outcome.replayed) throw new Error("expected fresh response");
    expect(outcome.response.application).toMatchObject({
      source: { kind: "template", templateId: "gitea", templateVersion: 1 },
      environment: "production",
      trustLevel: "third_party",
      consentPolicy: "explicit",
    });
    expect(outcome.response.connection).toMatchObject({
      template: { id: "gitea", version: 1 },
      redirectUris: ["https://git.example.com/user/oauth2/company-sso/callback"],
      pkce: { policy: "optional", methods: ["S256"] },
    });
    expect(outcome.response.integrationGuide.title).toContain("Gitea 1.26");
    expect(JSON.stringify(outcome.response.integrationGuide)).not.toContain("gos_");
    await expect(
      service.getApplicationIntegrationGuide(outcome.response.application.id),
    ).resolves.toEqual(outcome.response.integrationGuide);

    const stored = await repository.read((reader) =>
      reader.findById(outcome.response.application.id),
    );
    expect(stored?.templateSnapshot).toMatchObject({
      schemaVersion: 1,
      template: { id: "gitea", version: 1 },
      normalizedInput: { targetVersion: "1.26" },
    });
    expect(JSON.stringify(stored?.templateSnapshot)).not.toContain("gos_");

    const replay = await service.createTemplateApplication(templateRequest, {
      idempotencyKey: "create-gitea-template",
    });
    expect(replay).toMatchObject({
      replayed: true,
      response: { credentialDelivery: { kind: "already_delivered" } },
    });
  });

  it("拒绝未知模板版本和超出部署能力的 claim scope", async () => {
    const { repository, secretEncryptor, service } = createFixture();
    await expect(
      service.createTemplateApplication(
        { ...templateRequest, template: { id: "gitea", version: 99 } },
        { idempotencyKey: "unknown-template-version" },
      ),
    ).rejects.toThrow("模板版本或模板输入无效");

    await expect(
      service.createTemplateApplication(
        {
          ...templateRequest,
          application: { name: "未知 Claim 的 Gitea", slug: "missing-claim-gitea" },
          templateInput: { ...templateRequest.templateInput, groupClaimName: "missing" },
        },
        { idempotencyKey: "template-claim-missing" },
      ),
    ).rejects.toThrow("模板版本或模板输入无效");

    const customClaimScope = new ApplicationService({
      repository,
      secretEncryptor,
      issuer: "https://id.example.com",
      templateCatalog: applicationTemplateCatalog,
      templateClaimScopes: { organization: ["departments"] },
    });
    await expect(
      customClaimScope.createTemplateApplication(
        {
          ...templateRequest,
          application: { name: "部门 Gitea", slug: "department-gitea" },
          templateInput: { ...templateRequest.templateInput, groupClaimName: "departments" },
        },
        { idempotencyKey: "template-claim-scope-denied" },
      ),
    ).rejects.toThrow("不支持 scope: organization");

    const groupsEnabled = new ApplicationService({
      repository,
      secretEncryptor,
      issuer: "https://id.example.com",
      supportedScopes: ["openid", "profile", "email", "organization"],
      templateCatalog: applicationTemplateCatalog,
      templateClaimScopes: { organization: ["departments"] },
    });
    await expect(
      groupsEnabled.createTemplateApplication(
        {
          ...templateRequest,
          application: { name: "带组映射的 Gitea", slug: "group-gitea" },
          templateInput: { ...templateRequest.templateInput, groupClaimName: "departments" },
        },
        { idempotencyKey: "template-groups-allowed" },
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  it("模板或部署策略变化后仍先重放已经提交的幂等回执", async () => {
    const { repository, secretEncryptor, service } = createFixture();
    const first = await service.createTemplateApplication(templateRequest, {
      idempotencyKey: "template-replay-after-removal",
    });
    const withoutTemplates = new ApplicationService({
      repository,
      secretEncryptor,
      issuer: "https://id.example.com",
      supportedScopes: ["openid"],
    });

    const replay = await withoutTemplates.createTemplateApplication(templateRequest, {
      idempotencyKey: "template-replay-after-removal",
    });
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      replayed: true,
      response: {
        application: { source: { kind: "template", templateId: "gitea", templateVersion: 1 } },
        credentialDelivery: { kind: "already_delivered" },
      },
    });
  });

  it("持久化创建时 issuer，避免重启后 connection 与模板说明漂移", async () => {
    const { repository, secretEncryptor, service } = createFixture();
    const created = await service.createTemplateApplication(templateRequest, {
      idempotencyKey: "template-stable-issuer",
    });
    const restarted = new ApplicationService({
      repository,
      secretEncryptor,
      issuer: "https://new-id.example.com",
      templateCatalog: applicationTemplateCatalog,
    });

    const connection = await restarted.getApplicationConnection(created.response.application.id);
    const guide = await restarted.getApplicationIntegrationGuide(created.response.application.id);
    expect(connection.issuer).toBe("https://id.example.com");
    expect(JSON.stringify(guide)).toContain(
      "https://id.example.com/.well-known/openid-configuration",
    );
    expect(JSON.stringify(guide)).not.toContain("https://new-id.example.com");
  });

  it("事务创建应用、Client、一次性密钥和脱敏审计", async () => {
    const { service } = createFixture();
    const outcome = await service.createCustomApplication(request, {
      idempotencyKey: "create-example-app",
      actor: { type: "user", id: "admin-1" },
    });

    expect(outcome.replayed).toBe(false);
    if (outcome.replayed) throw new Error("expected fresh response");
    expect(outcome.response.credentialDelivery.kind).toBe("direct");
    if (outcome.response.credentialDelivery.kind !== "direct") throw new Error("expected direct");
    expect(outcome.response.credentialDelivery.credential).toMatchObject({
      schemaVersion: 1,
      applicationId: outcome.response.connection.applicationId,
      oidcClientId: outcome.response.connection.oidcClientId,
      issuer: outcome.response.connection.issuer,
      clientId: outcome.response.connection.clientId,
      kind: "client_secret",
    });
    const connection = await service.getApplicationConnection(outcome.response.application.id);
    expect(connection).toEqual(outcome.response.connection);
    expect(JSON.stringify(connection)).not.toContain("clientSecret");
    expect(
      JSON.stringify(await service.getApplication(outcome.response.application.id)),
    ).not.toContain("clientSecret");
    const audits = await service.listAuditEvents(outcome.response.application.id);
    expect(audits.map((event) => event.type)).toEqual([
      "application.created",
      "client_secret.created",
    ]);
    expect(JSON.stringify(audits)).not.toContain("gos_");
    const listed = await service.listApplicationDetails();
    expect(listed[0]?.clients).toHaveLength(1);
    expect(listed[0]?.secrets[0]?.fingerprint).toMatch(/^hmac-sha256:/);
    expect(JSON.stringify(listed)).not.toContain("ciphertext");
  });

  it("为 public Client 生成与 connection 绑定的 none credential", async () => {
    const { service } = createFixture();
    const outcome = await service.createCustomApplication(
      {
        ...request,
        application: { ...request.application, slug: "public-example" },
        client: { ...request.client, clientType: "public" },
      },
      { idempotencyKey: "create-public-example" },
    );

    expect(outcome.replayed).toBe(false);
    if (outcome.replayed) throw new Error("expected fresh response");
    expect(outcome.response.credentialDelivery.credential).toEqual({
      schemaVersion: 1,
      applicationId: outcome.response.connection.applicationId,
      oidcClientId: outcome.response.connection.oidcClientId,
      issuer: outcome.response.connection.issuer,
      clientId: outcome.response.connection.clientId,
      kind: "none",
    });
  });

  it("原子轮换 confidential Client Secret 并允许响应丢失后再次恢复", async () => {
    const { repository, secretEncryptor, service } = createFixture();
    const created = await service.createCustomApplication(request, {
      idempotencyKey: "rotate-example-app",
      actor: { type: "user", id: "admin-1" },
    });
    if (created.replayed || created.response.credentialDelivery.kind !== "direct") {
      throw new Error("expected fresh direct response");
    }
    const originalCredential = created.response.credentialDelivery.credential;
    if (originalCredential.kind !== "client_secret") {
      throw new Error("expected client secret");
    }

    const rotated = await service.rotateApplicationSecret(created.response.application.id, {
      expectedVersion: 1,
      actor: { type: "user", id: "admin-2" },
    });
    expect(rotated.application.version).toBe(2);
    expect(rotated.credentialDelivery.credential.kind).toBe("client_secret");
    if (rotated.credentialDelivery.credential.kind !== "client_secret") {
      throw new Error("expected rotated client secret");
    }
    expect(rotated.credentialDelivery.credential.clientSecret).not.toBe(
      originalCredential.clientSecret,
    );
    expect(JSON.stringify(rotated.connection)).not.toContain("clientSecret");
    expect(JSON.stringify(rotated.integrationGuide)).not.toContain(
      rotated.credentialDelivery.credential.clientSecret,
    );

    const details = await service.getApplication(created.response.application.id);
    expect(details.secrets.filter((secret) => secret.status === "active")).toHaveLength(1);
    expect(details.secrets.filter((secret) => secret.status === "revoked")).toHaveLength(1);
    const projector = new OidcClientProjector(repository, secretEncryptor);
    await expect(projector.findByClientId(rotated.client.clientId)).resolves.toMatchObject({
      client_secret: rotated.credentialDelivery.credential.clientSecret,
      application_version: 2,
    });
    await expect(
      service.rotateApplicationSecret(created.response.application.id, { expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(ApplicationVersionConflictError);

    // 模拟首次轮换响应丢失：读取当前 version 后再次轮换即可得到新的可用 Secret。
    const recovered = await service.rotateApplicationSecret(created.response.application.id, {
      expectedVersion: details.application.version,
    });
    expect(recovered.application.version).toBe(3);
    expect(recovered.credentialDelivery.credential.kind).toBe("client_secret");
    if (recovered.credentialDelivery.credential.kind !== "client_secret") {
      throw new Error("expected recovery client secret");
    }
    expect(recovered.credentialDelivery.credential.clientSecret).not.toBe(
      rotated.credentialDelivery.credential.clientSecret,
    );
    await expect(projector.findByClientId(recovered.client.clientId)).resolves.toMatchObject({
      client_secret: recovered.credentialDelivery.credential.clientSecret,
      application_version: 3,
    });
    expect(
      (await service.listAuditEvents(created.response.application.id)).map((event) => event.type),
    ).toEqual([
      "application.created",
      "client_secret.created",
      "client_secret.rotated",
      "client_secret.rotated",
    ]);
  });

  it("拒绝为 public 和 system Client 轮换管理面密钥", async () => {
    const { service } = createFixture();
    const publicApplication = await service.createCustomApplication(
      {
        ...request,
        application: { ...request.application, slug: "public-rotation-denied" },
        client: { ...request.client, clientType: "public" },
      },
      { idempotencyKey: "public-rotation-denied" },
    );
    await expect(
      service.rotateApplicationSecret(publicApplication.response.application.id, {
        expectedVersion: 1,
      }),
    ).rejects.toThrow(/confidential Client/);

    const [systemApplication] = await service.importSystemClients([
      {
        name: "System Client (rotation)",
        clientId: "system-rotation-client",
        clientSecret: "existing-client-secret",
        redirectUris: ["https://id.example.com/admin/callback"],
        postLogoutRedirectUris: [],
        responseTypes: ["code"],
        grantTypes: ["authorization_code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        allowedScopes: ["openid", "profile", "email"],
        environment: "production",
        pkcePolicy: "optional",
        providerApi: false,
      },
    ]);
    await expect(
      service.rotateApplicationSecret(systemApplication!.application.id, {
        expectedVersion: 1,
      }),
    ).rejects.toThrow(/system Application/);
  });

  it("并发幂等请求只创建一次且重放不再次返回明文", async () => {
    const { service } = createFixture();
    const outcomes = await Promise.all([
      service.createCustomApplication(request, { idempotencyKey: "same-request-key" }),
      service.createCustomApplication(request, { idempotencyKey: "same-request-key" }),
    ]);

    expect(outcomes.filter((outcome) => !outcome.replayed)).toHaveLength(1);
    const replay = outcomes.find((outcome) => outcome.replayed);
    expect(replay?.response.credentialDelivery).toEqual({ kind: "already_delivered" });
    expect(await service.listApplications()).toHaveLength(1);
  });

  it("同一幂等键不能绑定不同请求", async () => {
    const { service } = createFixture();
    await service.createCustomApplication(request, { idempotencyKey: "conflicting-key" });
    await expect(
      service.createCustomApplication(
        { ...request, application: { ...request.application, name: "另一个应用" } },
        { idempotencyKey: "conflicting-key" },
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("使用乐观版本停用并阻止旧版本覆盖", async () => {
    const { service } = createFixture();
    const created = await service.createCustomApplication(request, {
      idempotencyKey: "disable-example-app",
    });
    const id = created.response.application.id;
    await expect(
      service.completeDisableApplication(id, { expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(ApplicationConflictError);
    const disabling = await service.disableApplication(id, { expectedVersion: 1 });
    expect(disabling.application).toMatchObject({ status: "disabling", version: 2 });
    expect(disabling.clients[0]?.status).toBe("disabled");
    await expect(service.enableApplication(id, { expectedVersion: 2 })).rejects.toBeInstanceOf(
      ApplicationConflictError,
    );
    const disabled = await service.completeDisableApplication(id, { expectedVersion: 2 });
    expect(disabled.application).toMatchObject({ status: "disabled", version: 3 });
    const enabled = await service.enableApplication(id, { expectedVersion: 3 });
    expect(enabled.application).toMatchObject({ status: "active", version: 4 });
    expect(enabled.clients[0]?.status).toBe("active");
    await expect(service.enableApplication(id, { expectedVersion: 1 })).rejects.toBeInstanceOf(
      ApplicationVersionConflictError,
    );
    expect((await service.listAuditEvents(id)).map((event) => event.type)).toEqual([
      "application.created",
      "client_secret.created",
      "application.disable_started",
      "application.disabled",
      "application.enabled",
    ]);
  });

  it("拒绝生产 HTTP 和非 loopback 开发 HTTP redirect URI", async () => {
    const { service } = createFixture();
    await expect(
      service.createCustomApplication(
        {
          ...request,
          client: { ...request.client, redirectUris: ["http://app.example.com/callback"] },
        },
        { idempotencyKey: "invalid-production-uri" },
      ),
    ).rejects.toBeInstanceOf(ApplicationValidationError);

    await expect(
      service.createCustomApplication(
        {
          ...request,
          application: { ...request.application, environment: "development" },
          client: { ...request.client, redirectUris: ["http://localhost:3000/callback"] },
        },
        { idempotencyKey: "valid-loopback-uri" },
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  it("事务回滚不会提交中间状态", async () => {
    const { repository, service } = createFixture();
    const created = await service.createCustomApplication(request, {
      idempotencyKey: "rollback-example-app",
    });
    const id = created.response.application.id;

    await expect(
      repository.transaction(async (transaction) => {
        const aggregate = await transaction.findById(id);
        if (aggregate === undefined) throw new Error("missing aggregate");
        await transaction.update(
          {
            ...aggregate,
            application: { ...aggregate.application, status: "disabled", version: 2 },
          },
          1,
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await service.getApplication(id)).application.status).toBe("active");
  });

  it("仅在内部投影边界解密 active Client，停用后不再投影", async () => {
    const { repository, secretEncryptor, service } = createFixture();
    const created = await service.createCustomApplication(request, {
      idempotencyKey: "projection-example-app",
    });
    const projector = new OidcClientProjector(repository, secretEncryptor);
    const projection = await projector.findByClientId(created.response.client.clientId);
    expect(projection?.client_secret).toMatch(/^gos_/);
    const policyProjector = new OidcClientProjector(
      repository,
      new ApplicationSecretEncryptor({
        keyId: "wrong-key",
        masterKey: Buffer.alloc(32, 3),
      }),
    );
    await expect(
      policyProjector.findAuthorizationPolicyByClientId(created.response.client.clientId),
    ).resolves.toMatchObject({
      applicationId: created.response.application.id,
      consentPolicy: "explicit",
      allowedScopes: ["openid", "profile", "email"],
    });
    await service.disableApplication(created.response.application.id, { expectedVersion: 1 });
    await expect(
      projector.findByClientId(created.response.client.clientId),
    ).resolves.toBeUndefined();
    await expect(
      policyProjector.findAuthorizationPolicyByClientId(created.response.client.clientId),
    ).resolves.toBeUndefined();
  });

  it("按部署能力限制 scope、Provider API 和 resource", async () => {
    const { repository, secretEncryptor, service } = createFixture();
    await expect(
      service.createCustomApplication(
        { ...request, client: { ...request.client, scopes: ["openid", "groups"] } },
        { idempotencyKey: "unsupported-scope-key" },
      ),
    ).rejects.toThrow("不支持 scope: groups");
    await expect(
      service.createCustomApplication(
        { ...request, client: { ...request.client, providerApi: true } },
        { idempotencyKey: "provider-api-denied-key" },
      ),
    ).rejects.toThrow("未允许新应用启用 Provider API");
    await expect(
      service.createCustomApplication(
        {
          ...request,
          client: {
            ...request.client,
            resources: ["https://api.example.com"],
            resourceServer: true,
          },
        },
        { idempotencyKey: "resource-denied-key" },
      ),
    ).rejects.toThrow("未允许 resource");

    const allowed = new ApplicationService({
      repository,
      secretEncryptor,
      issuer: "https://id.example.com",
      supportedScopes: ["openid", "groups", "provider_api"],
      allowProviderApi: true,
      allowedResources: ["https://api.example.com"],
    });
    await expect(
      allowed.createCustomApplication(
        {
          ...request,
          application: { ...request.application, slug: "allowed-capabilities" },
          client: {
            ...request.client,
            scopes: ["openid", "groups", "provider_api"],
            providerApi: true,
            resources: ["https://api.example.com"],
            resourceServer: true,
          },
        },
        { idempotencyKey: "allowed-capabilities-key" },
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  it("事务性导入 system Client，并拒绝配置漂移和重复明文交付", async () => {
    const { service } = createFixture();
    const input = {
      name: "System Client (admin)",
      clientId: "admin-client",
      clientSecret: "existing-client-secret",
      redirectUris: ["https://id.example.com/admin/callback"],
      postLogoutRedirectUris: [] as string[],
      responseTypes: ["code"] as ["code"],
      grantTypes: ["authorization_code"] as Array<"authorization_code" | "refresh_token">,
      tokenEndpointAuthMethod: "client_secret_basic" as const,
      allowedScopes: ["openid", "profile", "email"],
      environment: "production" as const,
      pkcePolicy: "optional" as const,
      providerApi: false,
    };

    const first = await service.importSystemClients([input]);
    const replay = await service.importSystemClients([input]);
    expect(first).toHaveLength(1);
    expect(replay).toEqual(first);
    expect(first[0]?.application).toMatchObject({
      source: { kind: "system" },
      trustLevel: "first_party",
      consentPolicy: "skip_for_trusted",
    });
    expect(JSON.stringify(first)).not.toContain(input.clientSecret);
    await expect(
      service.disableApplication(first[0]!.application.id, { expectedVersion: 1 }),
    ).rejects.toThrow(/system Application/);
    await expect(
      service.importSystemClients([{ ...input, redirectUris: ["https://evil.example.com/cb"] }]),
    ).rejects.toThrow(/显式迁移/);
  });
});

describe("ApplicationSecretEncryptor", () => {
  it("使用 AES-256-GCM 绑定元数据并检测篡改", () => {
    const encryptor = new ApplicationSecretEncryptor({
      keyId: "applications-v1",
      masterKey: Buffer.alloc(32, 9),
    });
    const created = encryptor.createSecret({ oidcClientId: "client-1" });
    expect(encryptor.decrypt(created.encrypted)).toBe(created.plaintext);
    expect(created.encrypted.fingerprint).toMatch(/^hmac-sha256:[a-f0-9]{24}$/);
    expect(() => encryptor.decrypt({ ...created.encrypted, oidcClientId: "client-2" })).toThrow(
      SecretDecryptionError,
    );
  });
});
