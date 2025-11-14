/**
 * PgsqlUserRepository 单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListOptions, UserInfo } from '../../types/auth';
import { PgsqlUserRepository } from '../PgsqlUserRepository';

type QueryResponder = (sql: string, params: any[]) => Promise<any> | any;

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

const mockPool = {
  connect: vi.fn(),
  end: vi.fn(async () => {}),
};

const mockPoolConstructor = vi.fn(function () {
  return mockPool;
});

vi.mock('pg', () => ({
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

const baseUserData: Omit<UserInfo, 'sub' | 'createdAt' | 'updatedAt'> = {
  username: 'pgsql-user',
  name: 'Pgsql User',
  email: 'pg@example.com',
  picture: 'https://example.com/avatar.png',
  phone: '+19876543210',
  authProvider: 'local',
  email_verified: true,
  phone_verified: false,
  groups: ['users'],
  metadata: { externalId: 'ext123' },
};

const createRow = (override: Partial<Record<string, any>> = {}) => ({
  id: 'existing-user',
  username: baseUserData.username,
  name: baseUserData.name,
  email: baseUserData.email,
  picture: baseUserData.picture,
  phone: baseUserData.phone,
  auth_provider: baseUserData.authProvider,
  email_verified: 1,
  phone_verified: 0,
  groups: baseUserData.groups,
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-02T00:00:00Z'),
  metadata: baseUserData.metadata,
  ...override,
});

const expectedUserFromRow = (row: ReturnType<typeof createRow>): UserInfo => ({
  sub: row.id,
  username: row.username,
  name: row.name,
  email: row.email,
  picture: row.picture,
  phone: row.phone,
  authProvider: row.auth_provider,
  email_verified: Boolean(row.email_verified),
  phone_verified: Boolean(row.phone_verified),
  groups: row.groups,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

describe('PgsqlUserRepository', () => {
  let repository: PgsqlUserRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    const initClient = setupNextClient();
    repository = new PgsqlUserRepository('postgresql://localhost/test');
    await new Promise(resolve => setImmediate(resolve));
    expect(initClient.query).toHaveBeenCalled();
    expect(initClient.release).toHaveBeenCalled();
  });

  afterEach(async () => {
    if (repository) {
      await repository.close();
    }
    expect(mockPool.end).toHaveBeenCalled();
  });

  it('should create a user and send expected parameters', async () => {
    const insertClient = setupNextClient();

    const created = await repository.create(baseUserData);

    expect(created).toMatchObject(baseUserData);
    expect(created.sub).toBeDefined();
    const [sql, params] = insertClient.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO users');
    expect(params[1]).toBe(baseUserData.username);
    expect(params[12]).toEqual(baseUserData.metadata);
    expect(insertClient.release).toHaveBeenCalled();
  });

  describe('findBy* methods', () => {
    const findCases = [
      {
        name: 'findById',
        method: (repo: PgsqlUserRepository, value: string) => repo.findById(value),
        field: 'id',
        sqlSnippet: 'WHERE id = $1',
      },
      {
        name: 'findByUsername',
        method: (repo: PgsqlUserRepository, value: string) => repo.findByUsername(value),
        field: 'username',
        sqlSnippet: 'WHERE username = $1',
      },
      {
        name: 'findByEmail',
        method: (repo: PgsqlUserRepository, value: string) => repo.findByEmail(value),
        field: 'email',
        sqlSnippet: 'WHERE email = $1',
      },
    ] as const;

    findCases.forEach(({ name, method, field, sqlSnippet }) => {
      it(`should return a user when ${name} matches`, async () => {
        const row = createRow();
        const client = setupNextClient(() => ({ rows: [row] }));

        const result = await method(repository, row[field]);

        expect(result).toEqual(expectedUserFromRow(row));
        expect(client.query.mock.calls[0][0].replace(/\s+/g, ' ')).toContain(sqlSnippet);
        expect(client.query.mock.calls[0][1]).toEqual([row[field]]);
        expect(client.release).toHaveBeenCalled();
      });

      it(`should return null when ${name} misses`, async () => {
        const client = setupNextClient(() => ({ rows: [] }));

        const result = await method(repository, 'missing-value');

        expect(result).toBeNull();
        expect(client.release).toHaveBeenCalled();
      });
    });
  });

  it('should find user by provider and external id', async () => {
    const row = createRow();
    const client = setupNextClient(() => ({ rows: [row] }));

    const result = await repository.findByProviderAndExternalId('local', 'ext123');

    expect(result).toEqual(expectedUserFromRow(row));
    expect(client.query.mock.calls[0][0]).toContain("metadata->>'externalId'");
    expect(client.query.mock.calls[0][1]).toEqual(['local', 'ext123']);
    expect(client.release).toHaveBeenCalled();
  });

  it('should return null when provider external id misses', async () => {
    const client = setupNextClient(() => ({ rows: [] }));

    const result = await repository.findByProviderAndExternalId('local', 'missing');

    expect(result).toBeNull();
    expect(client.release).toHaveBeenCalled();
  });

  it('should create a user via findOrCreate when missing and attach externalId', async () => {
    const finderClient = setupNextClient(() => ({ rows: [] }));
    const insertClient = setupNextClient();

    const created = await repository.findOrCreate(
      { provider: 'local', externalId: 'new-external' },
      baseUserData
    );

    expect(created.metadata).toEqual({ ...baseUserData.metadata, externalId: 'new-external' });
    expect(finderClient.release).toHaveBeenCalled();
    expect(insertClient.release).toHaveBeenCalled();
    expect(insertClient.query.mock.calls[0][1][12]).toEqual({ ...baseUserData.metadata, externalId: 'new-external' });
  });

  it('should reuse existing user via findOrCreate when present', async () => {
    const row = createRow();
    const client = setupNextClient(() => ({ rows: [row] }));

    const result = await repository.findOrCreate(
      { provider: 'local', externalId: 'ext123' },
      baseUserData
    );

    expect(result).toEqual(expectedUserFromRow(row));
    expect(client.release).toHaveBeenCalled();
  });

  it('should update an existing user and keep metadata', async () => {
    const existing = createRow();
    const finderClient = setupNextClient(() => ({ rows: [existing] }));
    const updateClient = setupNextClient();

    const updated = await repository.update(existing.id, {
      name: 'Updated Name',
      metadata: { role: 'admin' },
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.metadata).toEqual({ role: 'admin' });
    expect(updateClient.query.mock.calls[0][0]).toContain('UPDATE users SET');
    expect(updateClient.query.mock.calls[0][1][1]).toBe('Updated Name');
    expect(updateClient.query.mock.calls[0][1][10]).toEqual({ role: 'admin' });
    expect(updateClient.query.mock.calls[0][1][11]).toBe(existing.id);
    expect(finderClient.release).toHaveBeenCalled();
    expect(updateClient.release).toHaveBeenCalled();
  });

  it('should throw when updating a missing user', async () => {
    const finderClient = setupNextClient(() => ({ rows: [] }));

    await expect(repository.update('missing-id', { name: 'X' })).rejects.toThrow(
      'User not found: missing-id'
    );

    expect(finderClient.release).toHaveBeenCalled();
  });

  it('should list users with filters, sort and pagination', async () => {
    const rows = [
      createRow({ id: 'a', username: 'alice' }),
      createRow({ id: 'b', username: 'bob' }),
    ];
    const client = setupNextClient(() => ({ rows }));
    const options: ListOptions = {
      filter: { username: 'alice', authProvider: 'local' },
      sortBy: 'username',
      sortOrder: 'desc',
      limit: 2,
      offset: 1,
    };

    const users = await repository.list(options);

    expect(client.query.mock.calls[0][0].replace(/\s+/g, ' ')).toContain(
      'WHERE username = $1 AND auth_provider = $2'
    );
    expect(client.query.mock.calls[0][0]).toContain('ORDER BY username DESC');
    expect(client.query.mock.calls[0][1]).toEqual(['alice', 'local', 2, 1]);
    expect(users).toEqual(rows.map(expectedUserFromRow));
    expect(client.release).toHaveBeenCalled();
  });

  it('should return parsed value from size()', async () => {
    const client = setupNextClient(() => ({ rows: [{ count: '42' }] }));

    const count = await repository.size();

    expect(count).toBe(42);
    expect(client.query).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM users');
    expect(client.release).toHaveBeenCalled();
  });

  it('should delete a user by id', async () => {
    const client = setupNextClient();
    await repository.delete('delete-id');

    expect(client.query).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', ['delete-id']);
    expect(client.release).toHaveBeenCalled();
  });
});
