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
import type { CreateCustomApplicationRequestV1 } from "../types.js";

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
    now: () => new Date("2026-07-10T00:00:00.000Z"),
  });
  return { repository, secretEncryptor, service };
}

describe("ApplicationService", () => {
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
    expect(outcome.response.credentialDelivery.credential).toMatchObject({ kind: "client_secret" });
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
