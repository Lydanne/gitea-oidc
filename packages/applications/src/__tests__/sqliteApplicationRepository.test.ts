import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationSecretEncryptor } from "../applicationSecretEncryptor.js";
import { ApplicationService } from "../applicationService.js";
import {
  ApplicationConflictError,
  ApplicationRepositoryClosedError,
  ApplicationStorageCorruptionError,
  ApplicationValidationError,
} from "../errors.js";
import { SqliteApplicationRepository } from "../sqliteApplicationRepository.js";
import type { CreateCustomApplicationRequestV1 } from "../types.js";

const directories: string[] = [];
const repositories: SqliteApplicationRepository[] = [];
const CONNECTION_ISSUER = "https://id.example.com";

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "gitea-oidc-applications-"));
  directories.push(directory);
  return join(directory, "applications.db");
}

function createRepository(dbPath: string): SqliteApplicationRepository {
  const repository = new SqliteApplicationRepository({
    dbPath,
    connectionIssuer: CONNECTION_ISSUER,
  });
  repositories.push(repository);
  return repository;
}

function createService(repository: SqliteApplicationRepository): ApplicationService {
  return new ApplicationService({
    repository,
    issuer: CONNECTION_ISSUER,
    secretEncryptor: new ApplicationSecretEncryptor({
      keyId: "applications-v1",
      masterKey: Buffer.alloc(32, 4),
    }),
  });
}

function createRequest(slug: string): CreateCustomApplicationRequestV1 {
  return {
    schemaVersion: 1,
    application: {
      name: slug,
      slug,
      environment: "production",
      portal: {
        launchUrl: `https://${slug}.example.com/`,
        iconUrl: `https://${slug}.example.com/icon.svg`,
        order: 10,
      },
    },
    client: {
      clientType: "confidential",
      redirectUris: [`https://${slug}.example.com/callback`],
    },
    credentialDelivery: "direct",
  };
}

afterEach(async () => {
  await Promise.allSettled(repositories.splice(0).map((repository) => repository.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqliteApplicationRepository", () => {
  it("跨重启持久化 aggregate、幂等记录和审计", async () => {
    const dbPath = createDatabasePath();
    const firstRepository = createRepository(dbPath);
    const firstService = createService(firstRepository);
    const created = await firstService.createCustomApplication(createRequest("restart-app"), {
      idempotencyKey: "restart-idempotency-key",
    });
    await firstRepository.close();

    const secondRepository = createRepository(dbPath);
    const secondService = createService(secondRepository);
    expect(
      (await secondService.getApplication(created.response.application.id)).application.slug,
    ).toBe("restart-app");
    await expect(secondService.listPortalApplications()).resolves.toMatchObject([
      {
        id: created.response.application.id,
        launchUrl: "https://restart-app.example.com/",
        iconUrl: "https://restart-app.example.com/icon.svg",
        order: 10,
      },
    ]);
    const replay = await secondService.createCustomApplication(createRequest("restart-app"), {
      idempotencyKey: "restart-idempotency-key",
    });
    expect(replay.replayed).toBe(true);
    expect(await secondService.listAuditEvents(created.response.application.id)).toHaveLength(2);
  });

  it("原子迁移未版本化 aggregate 并补齐 connection issuer", async () => {
    const dbPath = createDatabasePath();
    const firstRepository = createRepository(dbPath);
    const service = createService(firstRepository);
    const created = await service.createCustomApplication(createRequest("legacy-app"), {
      idempotencyKey: "legacy-idempotency-key",
    });
    await firstRepository.close();

    const legacyDatabase = new Database(dbPath);
    const row = legacyDatabase
      .prepare("SELECT data FROM application_aggregates WHERE id = ?")
      .get(created.response.application.id) as { data: string };
    const legacyAggregate = JSON.parse(row.data) as Record<string, unknown>;
    delete legacyAggregate.connectionIssuer;
    const legacyClients = legacyAggregate.clients;
    const legacySecrets = legacyAggregate.secrets;
    legacyDatabase
      .prepare("UPDATE application_aggregates SET data = ? WHERE id = ?")
      .run(JSON.stringify(legacyAggregate), created.response.application.id);
    legacyDatabase.prepare("DELETE FROM application_repository_metadata").run();
    legacyDatabase.close();

    const migratedRepository = createRepository(dbPath);
    const migratedService = createService(migratedRepository);
    await expect(
      migratedService.getApplicationConnection(created.response.application.id),
    ).resolves.toMatchObject({ issuer: CONNECTION_ISSUER });
    await expect(
      migratedService.createCustomApplication(createRequest("legacy-app"), {
        idempotencyKey: "legacy-idempotency-key",
      }),
    ).resolves.toMatchObject({ replayed: true });
    await expect(
      migratedService.listAuditEvents(created.response.application.id),
    ).resolves.toHaveLength(2);
    await migratedRepository.close();

    const migratedDatabase = new Database(dbPath, { readonly: true });
    const migratedRow = migratedDatabase
      .prepare("SELECT data FROM application_aggregates WHERE id = ?")
      .get(created.response.application.id) as { data: string };
    expect(JSON.parse(migratedRow.data)).toMatchObject({
      connectionIssuer: CONNECTION_ISSUER,
      clients: legacyClients,
      secrets: legacySecrets,
    });
    expect(
      migratedDatabase
        .prepare("SELECT schema_version FROM application_repository_metadata WHERE singleton = 1")
        .pluck()
        .get(),
    ).toBe(1);
    migratedDatabase.close();

    const reopenedRepository = createRepository(dbPath);
    await expect(
      createService(reopenedRepository).getApplicationConnection(created.response.application.id),
    ).resolves.toMatchObject({ issuer: CONNECTION_ISSUER });
  });

  it("拒绝未知的应用仓储 schema 版本", async () => {
    const dbPath = createDatabasePath();
    const repository = createRepository(dbPath);
    await repository.close();
    const database = new Database(dbPath);
    database
      .prepare(
        "UPDATE application_repository_metadata SET schema_version = 999 WHERE singleton = 1",
      )
      .run();
    database.close();

    expect(
      () =>
        new SqliteApplicationRepository({
          dbPath,
          connectionIssuer: CONNECTION_ISSUER,
        }),
    ).toThrow(ApplicationStorageCorruptionError);
  });

  it("callback 抛错时回滚 aggregate 与 client index", async () => {
    const repository = createRepository(createDatabasePath());
    const service = createService(repository);
    const created = await service.createCustomApplication(createRequest("rollback-app"), {
      idempotencyKey: "rollback-idempotency-key",
    });

    await expect(
      repository.transaction(async (transaction) => {
        const aggregate = await transaction.findById(created.response.application.id);
        if (aggregate === undefined) throw new Error("missing aggregate");
        await transaction.update(
          {
            ...aggregate,
            application: { ...aggregate.application, status: "disabled", version: 2 },
            clients: aggregate.clients.map((client) => ({ ...client, status: "disabled" })),
          },
          1,
        );
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    expect((await service.getApplication(created.response.application.id)).application.status).toBe(
      "active",
    );
    await expect(
      repository.transaction((transaction) =>
        transaction.findByClientId(created.response.client.clientId),
      ),
    ).resolves.toBeDefined();
  });

  it("唯一约束冲突会回滚整个创建事务", async () => {
    const repository = createRepository(createDatabasePath());
    const service = createService(repository);
    await service.createCustomApplication(createRequest("unique-app"), {
      idempotencyKey: "unique-first-key",
    });
    await expect(
      service.createCustomApplication(createRequest("unique-app"), {
        idempotencyKey: "unique-second-key",
      }),
    ).rejects.toBeInstanceOf(ApplicationConflictError);
    expect(await service.listApplications()).toHaveLength(1);
  });

  it("client_id 冲突时原子回滚 aggregate 和 client index", async () => {
    const repository = createRepository(createDatabasePath());
    const service = createService(repository);
    const first = await service.createCustomApplication(createRequest("first-client"), {
      idempotencyKey: "first-client-idempotency",
    });
    const second = await service.createCustomApplication(createRequest("second-client"), {
      idempotencyKey: "second-client-idempotency",
    });

    await expect(
      repository.transaction(async (transaction) => {
        const aggregate = await transaction.findById(second.response.application.id);
        if (aggregate === undefined) throw new Error("missing aggregate");
        await transaction.update(
          {
            ...aggregate,
            application: { ...aggregate.application, version: 2 },
            clients: aggregate.clients.map((client) => ({
              ...client,
              clientId: first.response.client.clientId,
            })),
          },
          1,
        );
      }),
    ).rejects.toBeInstanceOf(ApplicationConflictError);

    await expect(
      repository.transaction((transaction) =>
        transaction.findByClientId(second.response.client.clientId),
      ),
    ).resolves.toMatchObject({ application: { id: second.response.application.id, version: 1 } });
  });

  it("V1 持久化边界拒绝一个 Application 携带多个 Client", async () => {
    const repository = createRepository(createDatabasePath());
    const service = createService(repository);
    const created = await service.createCustomApplication(createRequest("single-client"), {
      idempotencyKey: "single-client-idempotency",
    });

    await expect(
      repository.transaction(async (transaction) => {
        const aggregate = await transaction.findById(created.response.application.id);
        if (aggregate === undefined) throw new Error("missing aggregate");
        await transaction.update(
          {
            ...aggregate,
            application: { ...aggregate.application, version: 2 },
            clients: [
              ...aggregate.clients,
              {
                ...aggregate.clients[0]!,
                id: "second-client-id",
                clientId: "second-client-id",
              },
            ],
          },
          1,
        );
      }),
    ).rejects.toBeInstanceOf(ApplicationValidationError);
    await expect(service.getApplication(created.response.application.id)).resolves.toMatchObject({
      application: { version: 1 },
      clients: [{ id: created.response.client.id }],
    });
  });

  it("读取损坏 JSON 时显式失败而不是静默接受", async () => {
    const dbPath = createDatabasePath();
    const repository = createRepository(dbPath);
    const service = createService(repository);
    const created = await service.createCustomApplication(createRequest("corrupt-app"), {
      idempotencyKey: "corrupt-idempotency-key",
    });
    await repository.close();

    const database = new Database(dbPath);
    database
      .prepare("UPDATE application_aggregates SET data = ? WHERE id = ?")
      .run(
        JSON.stringify({ application: { id: created.response.application.id } }),
        created.response.application.id,
      );
    database.close();

    const reopened = createRepository(dbPath);
    await expect(
      reopened.transaction((transaction) => transaction.findById(created.response.application.id)),
    ).rejects.toBeInstanceOf(ApplicationStorageCorruptionError);
  });

  it("串行执行异步 transaction callback", async () => {
    const repository = createRepository(createDatabasePath());
    const order: string[] = [];
    const first = repository.transaction(async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first:end");
    });
    const second = repository.transaction(async () => {
      order.push("second:start");
      order.push("second:end");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("read 运行时只暴露查询方法", async () => {
    const repository = createRepository(createDatabasePath());

    await repository.read(async (reader) => {
      expect(Object.isFrozen(reader)).toBe(true);
      expect("insert" in reader).toBe(false);
      expect("update" in reader).toBe(false);
      expect("appendAuditEvent" in reader).toBe(false);
      await expect(reader.list()).resolves.toEqual([]);
    });
  });

  it("close 等待已接收的 read 并拒绝后续 read", async () => {
    const repository = createRepository(createDatabasePath());
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = repository.read(async (reader) => {
      markStarted?.();
      await gate;
      await reader.list();
    });
    await started;
    const close = repository.close();
    await expect(repository.read((reader) => reader.list())).rejects.toBeInstanceOf(
      ApplicationRepositoryClosedError,
    );
    release?.();
    await active;
    await close;
    await expect(repository.read((reader) => reader.list())).rejects.toBeInstanceOf(
      ApplicationRepositoryClosedError,
    );
  });

  it("close 等待已接收事务并拒绝后续操作", async () => {
    const repository = createRepository(createDatabasePath());
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = repository.transaction(async (transaction) => {
      markStarted?.();
      await gate;
      await transaction.list();
    });
    await started;
    const close = repository.close();
    await expect(
      repository.transaction((transaction) => transaction.list()),
    ).rejects.toBeInstanceOf(ApplicationRepositoryClosedError);
    release?.();
    await active;
    await close;
    await expect(
      repository.transaction((transaction) => transaction.list()),
    ).rejects.toBeInstanceOf(ApplicationRepositoryClosedError);
  });

  it("将数据库及 WAL/SHM 文件权限限制为 0600", async () => {
    if (process.platform === "win32") return;
    const dbPath = createDatabasePath();
    const repository = createRepository(dbPath);
    await repository.transaction(async (transaction) => transaction.list());
    for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });
});
