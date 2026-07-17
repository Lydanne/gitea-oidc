/**
 * PgsqlUserRepository 单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListOptions, UserInfo } from "../../types/auth.js";
import { PgsqlUserRepository } from "../PgsqlUserRepository.js";

type QueryResponder = (sql: string, params: any[]) => Promise<any> | any;

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

const mockPool = {
  connect: vi.fn(),
  end: vi.fn(async () => {}),
};

vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      return mockPool;
    }
  },
}));

const setupNextClient = (responder?: QueryResponder): MockClient => {
  const client: MockClient = {
    query: vi.fn(async (sql, params: any[] = []) => {
      if (responder) {
        return responder(sql, params);
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  mockPool.connect.mockImplementationOnce(async () => client);
  return client;
};

const baseUserData: Omit<UserInfo, "id" | "sub" | "createdAt" | "updatedAt"> = {
  username: "pgsql-user",
  name: "Pgsql User",
  email: "pg@example.com",
  picture: "https://example.com/avatar.png",
  phone: "+19876543210",
  authProvider: "local",
  emailVerified: true,
  phoneVerified: false,
  groups: [{ id: "users", name: "users" }],
  externalId: "ext123",
  metadata: { role: "user" },
};

const stripUserData = (
  user: Omit<UserInfo, "id" | "sub" | "createdAt" | "updatedAt">,
): Omit<UserInfo, "id" | "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider"> => {
  const { authProvider: _provider, externalId: _externalId, ...rest } = user;
  return rest;
};

const createRow = (override: Partial<Record<string, any>> = {}) => ({
  id: "internal-user-id",
  sub: "existing-user",
  username: baseUserData.username,
  name: baseUserData.name,
  email: baseUserData.email,
  picture: baseUserData.picture,
  phone: baseUserData.phone,
  authProvider: baseUserData.authProvider,
  externalId: baseUserData.externalId,
  emailVerified: 1,
  phoneVerified: 0,
  groups: baseUserData.groups,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-02T00:00:00Z"),
  metadata: baseUserData.metadata,
  ...override,
});

const expectedUserFromRow = (row: ReturnType<typeof createRow>): UserInfo => ({
  id: row.id,
  sub: row.sub,
  username: row.username,
  name: row.name,
  email: row.email,
  picture: row.picture,
  phone: row.phone,
  authProvider: row.authProvider,
  externalId: row.externalId,
  emailVerified: Boolean(row.emailVerified),
  phoneVerified: Boolean(row.phoneVerified),
  groups: row.groups,
  metadata: row.metadata,
  status: row.status ?? "active",
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

describe("PgsqlUserRepository", () => {
  let repository: PgsqlUserRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    const initClient = setupNextClient();
    repository = new PgsqlUserRepository("postgresql://localhost/test");
    await new Promise((resolve) => setImmediate(resolve));
    expect(initClient.query).toHaveBeenCalled();
    expect(initClient.query.mock.calls[0][0]).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_external_unique",
    );
    expect(initClient.query.mock.calls[2][0]).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id",
    );
    expect(initClient.release).toHaveBeenCalled();
  });

  afterEach(async () => {
    if (repository) {
      await repository.close();
    }
    expect(mockPool.end).toHaveBeenCalled();
  });

  it("should create a user and send expected parameters", async () => {
    const identityClient = setupNextClient(() => ({ rows: [] }));
    const insertClient = setupNextClient();

    const created = await repository.create(baseUserData);

    expect(created).toMatchObject(baseUserData);
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(created.id).not.toBe(created.sub);
    expect(created.sub).toBeDefined();
    const [sql, params] = insertClient.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO users");
    expect(params[0]).toBe(created.id);
    expect(params[2]).toBe(baseUserData.username);
    expect(params[8]).toEqual(baseUserData.externalId);
    expect(params[14]).toEqual(baseUserData.metadata);
    expect(identityClient.release).toHaveBeenCalled();
    expect(insertClient.release).toHaveBeenCalled();
  });

  describe("findBy* methods", () => {
    const findCases = [
      {
        name: "findById",
        method: (repo: PgsqlUserRepository, value: string) => repo.findById(value),
        field: "sub",
        sqlSnippet: "WHERE sub = $1",
      },
      {
        name: "findByUsername",
        method: (repo: PgsqlUserRepository, value: string) => repo.findByUsername(value),
        field: "username",
        sqlSnippet: "WHERE username = $1",
      },
      {
        name: "findByEmail",
        method: (repo: PgsqlUserRepository, value: string) => repo.findByEmail(value),
        field: "email",
        sqlSnippet: "WHERE email = $1",
      },
    ] as const;

    findCases.forEach(({ name, method, field, sqlSnippet }) => {
      it(`should return a user when ${name} matches`, async () => {
        const row = createRow();
        const client = setupNextClient(() => ({ rows: [row] }));

        const result = await method(repository, row[field]);

        expect(result).toEqual(expectedUserFromRow(row));
        expect(client.query.mock.calls[0][0].replace(/\s+/g, " ")).toContain(sqlSnippet);
        expect(client.query.mock.calls[0][1]).toEqual([row[field]]);
        expect(client.release).toHaveBeenCalled();
      });

      it(`should return null when ${name} misses`, async () => {
        const client = setupNextClient(() => ({ rows: [] }));

        const result = await method(repository, "missing-value");

        expect(result).toBeNull();
        expect(client.release).toHaveBeenCalled();
      });
    });
  });

  it("should find user by provider and external sub", async () => {
    const row = createRow();
    const client = setupNextClient(() => ({ rows: [row] }));

    const result = await repository.findByProviderAndExternalId("local", "ext123");

    expect(result).toEqual(expectedUserFromRow(row));
    expect(client.query.mock.calls[0][0]).toContain('"externalId" = $2');
    expect(client.query.mock.calls[0][1]).toEqual(["local", "ext123"]);
    expect(client.release).toHaveBeenCalled();
  });

  it("should return null when provider external sub misses", async () => {
    const client = setupNextClient(() => ({ rows: [] }));

    const result = await repository.findByProviderAndExternalId("local", "missing");

    expect(result).toBeNull();
    expect(client.release).toHaveBeenCalled();
  });

  it("should create a user via findOrCreate when missing and attach externalId", async () => {
    const finderClient = setupNextClient(() => ({ rows: [] }));
    const identityClient = setupNextClient(() => ({ rows: [] }));
    const insertClient = setupNextClient();

    const created = await repository.findOrCreate(
      "local",
      "new-external",
      stripUserData(baseUserData),
    );

    expect(created.externalId).toBe("new-external");
    expect(created.metadata).toEqual(baseUserData.metadata);
    expect(finderClient.release).toHaveBeenCalled();
    expect(identityClient.release).toHaveBeenCalled();
    expect(insertClient.release).toHaveBeenCalled();
    expect(insertClient.query.mock.calls[0][1][14]).toEqual(baseUserData.metadata);
  });

  it("should reuse existing user via findOrCreate when present", async () => {
    const row = createRow();
    const findClient = setupNextClient(() => ({ rows: [row] }));
    const updateClient = setupNextClient((sql) => {
      if (sql.includes("SELECT * FROM users WHERE sub")) return { rows: [row] };
      if (sql.includes("SELECT sub FROM users")) return { rows: [{ sub: row.sub }] };
      return { rows: [] };
    });

    const result = await repository.findOrCreate("local", "ext123", stripUserData(baseUserData));

    expect(result.sub).toEqual(row.sub);
    expect(result.id).toEqual(row.id);
    expect(result.username).toEqual(row.username);
    expect(result.email).toEqual(row.email);
    expect(findClient.release).toHaveBeenCalled();
    expect(updateClient.release).toHaveBeenCalled();
    expect(updateClient.query.mock.calls.some(([sql]) => sql.includes("UPDATE users SET"))).toBe(
      true,
    );
  });

  it("should update an existing user and keep metadata", async () => {
    const existing = createRow();
    const updateClient = setupNextClient((sql) => {
      if (sql.includes("SELECT * FROM users WHERE sub")) return { rows: [existing] };
      if (sql.includes("SELECT sub FROM users")) return { rows: [{ sub: existing.sub }] };
      return { rows: [] };
    });

    const updated = await repository.update(existing.sub, {
      id: "replacement-id",
      name: "Updated Name",
      metadata: { role: "admin" },
    });

    expect(updated.id).toBe(existing.id);
    expect(updated.name).toBe("Updated Name");
    expect(updated.metadata).toEqual({ role: "admin" });
    const updateCall = updateClient.query.mock.calls.find(([sql]) =>
      sql.includes("UPDATE users SET"),
    );
    expect(updateCall?.[1][1]).toBe("Updated Name");
    expect(updateCall?.[1][11]).toEqual({ role: "admin" });
    expect(updateCall?.[1][17]).toBe(existing.sub);
    expect(updateClient.release).toHaveBeenCalled();
  });

  it("should reject provider identity collisions on update", async () => {
    const existing = createRow({ sub: "user-2", externalId: "ext2" });
    const occupied = createRow({ sub: "user-1", externalId: "ext1" });
    const updateClient = setupNextClient((sql) => {
      if (sql.includes("SELECT * FROM users WHERE sub")) return { rows: [existing] };
      if (sql.includes("SELECT sub FROM users")) return { rows: [{ sub: occupied.sub }] };
      return { rows: [] };
    });

    await expect(
      repository.update(existing.sub, {
        authProvider: "local",
        externalId: "ext1",
      }),
    ).rejects.toThrow("Provider identity already exists: local/ext1");

    expect(updateClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(updateClient.release).toHaveBeenCalled();
  });

  it("should throw when updating a missing user", async () => {
    const updateClient = setupNextClient(() => ({ rows: [] }));

    await expect(repository.update("missing-sub", { name: "X" })).rejects.toThrow(
      "User not found: missing-sub",
    );

    expect(updateClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(updateClient.release).toHaveBeenCalled();
  });

  it("should list users with filters, sort and pagination", async () => {
    const rows = [
      createRow({ sub: "a", username: "alice" }),
      createRow({ sub: "b", username: "bob" }),
    ];
    const client = setupNextClient(() => ({ rows }));
    const options: ListOptions = {
      filter: { username: "alice", authProvider: "local" },
      sortBy: "username",
      sortOrder: "desc",
      limit: 2,
      offset: 1,
    };

    const users = await repository.list(options);

    expect(client.query.mock.calls[0][0].replace(/\s+/g, " ")).toContain(
      'WHERE username = $1 AND "authProvider" = $2',
    );
    expect(client.query.mock.calls[0][0]).toContain("ORDER BY username DESC");
    expect(client.query.mock.calls[0][1]).toEqual(["alice", "local", 2, 1]);
    expect(users).toEqual(rows.map(expectedUserFromRow));
    expect(client.release).toHaveBeenCalled();
  });

  it("should list users using name/email filters并按 provider 排序", async () => {
    const rows = [createRow({ sub: "c", username: "charlie" })];
    const client = setupNextClient(() => ({ rows }));
    const options: ListOptions = {
      filter: {
        name: "Pgsql User",
        email: "pg@example.com",
        authProvider: "local",
      },
      sortBy: "authProvider",
      sortOrder: "asc",
    };

    const users = await repository.list(options);

    const normalizedSql = client.query.mock.calls[0][0].replace(/\s+/g, " ");
    expect(normalizedSql).toContain('WHERE name = $1 AND email = $2 AND "authProvider" = $3');
    expect(normalizedSql).toContain('ORDER BY "authProvider" ASC');
    expect(client.query.mock.calls[0][1]).toEqual(["Pgsql User", "pg@example.com", "local"]);
    expect(users).toEqual(rows.map(expectedUserFromRow));
  });

  it("should reject unsafe sort fields before sending SQL", async () => {
    await expect(repository.list({ sortBy: "username; DROP TABLE users" })).rejects.toThrow(
      /Unsupported user sort field/,
    );

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
  });

  it("should wait for table initialization before running the first query", async () => {
    await repository.close();
    mockPool.connect.mockClear();
    mockPool.end.mockClear();

    let resolveInit: (() => void) | undefined;
    let isFirstQuery = true;
    const initClient = setupNextClient(() => {
      if (!isFirstQuery) return { rows: [] };
      isFirstQuery = false;
      return new Promise((resolve) => {
        resolveInit = () => resolve({ rows: [] });
      });
    });
    const findClient = setupNextClient(() => ({ rows: [] }));
    repository = new PgsqlUserRepository("postgresql://localhost/test");

    const findPromise = repository.findById("user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(initClient.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE"));
    expect(findClient.query).not.toHaveBeenCalled();
    expect(mockPool.connect).toHaveBeenCalledTimes(1);

    resolveInit?.();
    await findPromise;

    expect(findClient.query).toHaveBeenCalledWith("SELECT * FROM users WHERE sub = $1", ["user-1"]);
    expect(mockPool.connect).toHaveBeenCalledTimes(2);
  });

  it("应该为旧表中的用户回填随机内部 ID", async () => {
    await repository.close();
    mockPool.connect.mockClear();
    mockPool.end.mockClear();

    const initClient = setupNextClient((sql) => {
      if (sql.includes("SELECT sub FROM users")) {
        return { rows: [{ sub: "legacy-user" }] };
      }
      return { rows: [] };
    });
    repository = new PgsqlUserRepository("postgresql://localhost/test");
    await new Promise((resolve) => setImmediate(resolve));

    const updateCall = initClient.query.mock.calls.find(([sql]) =>
      sql.includes("UPDATE users SET id"),
    );
    expect(updateCall?.[1]?.[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(updateCall?.[1]?.[1]).toBe("legacy-user");
    expect(initClient.query.mock.calls.at(-1)?.[0]).toContain("ALTER COLUMN id SET NOT NULL");
  });

  it("should convert rows to user objects without optional flags", () => {
    const row = createRow({
      emailVerified: null,
      phoneVerified: undefined,
      picture: null,
      phone: null,
      metadata: null,
      groups: null,
    });
    const user = (repository as any).userFromRow(row);

    expect(user).toMatchObject({
      sub: row.sub,
      username: row.username,
      email: row.email,
      authProvider: row.authProvider,
    });
    expect(user).not.toHaveProperty("emailVerified");
    expect(user).not.toHaveProperty("phoneVerified");
    expect(user.picture).toBeUndefined();
    expect(user.metadata).toBeUndefined();
    expect(user.groups).toBeUndefined();
  });

  it("should ignore legacy string groups read from PostgreSQL", () => {
    const user = (repository as any).userFromRow(createRow({ groups: ["developers"] }));

    expect(user.groups).toEqual([]);
  });

  it("should convert user info to row structure with null fallbacks", () => {
    const userInfo: UserInfo = {
      id: "internal-user-row",
      sub: "user-row",
      username: "row-user",
      name: "Row User",
      email: "row@example.com",
      authProvider: "local",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    } as UserInfo;

    const row = (repository as any).userToRow(userInfo);

    expect(row.picture).toBeUndefined();
    expect(row.phone).toBeUndefined();
    expect(row.emailVerified).toBeNull();
    expect(row.phoneVerified).toBeNull();
    expect(row.groups).toBeNull();
    expect(row.metadata).toBeNull();
    expect(row.status).toBe("active");
  });

  it("should return parsed value from size()", async () => {
    const client = setupNextClient(() => ({ rows: [{ count: "42" }] }));

    const count = await repository.size();

    expect(count).toBe(42);
    expect(client.query).toHaveBeenCalledWith("SELECT COUNT(*) as count FROM users");
    expect(client.release).toHaveBeenCalled();
  });

  it("should delete a user by sub", async () => {
    const row = createRow({ sub: "delete-sub" });
    const client = setupNextClient((sql) =>
      sql.includes("SELECT * FROM users WHERE sub") ? { rows: [row] } : { rows: [] },
    );
    await repository.delete("delete-sub");

    expect(client.query).toHaveBeenCalledWith("DELETE FROM users WHERE sub = $1", ["delete-sub"]);
    expect(client.release).toHaveBeenCalled();
  });

  it("should clear all users via clear()", async () => {
    const client = setupNextClient();

    await repository.clear();

    expect(client.query).toHaveBeenCalledWith("DELETE FROM users");
    expect(client.release).toHaveBeenCalled();
  });
});
