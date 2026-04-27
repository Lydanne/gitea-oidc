import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgsqlProviderTokenRepository } from "../PgsqlProviderTokenRepository";

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

describe("PgsqlProviderTokenRepository", () => {
  let repository: PgsqlProviderTokenRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    const initClient = setupNextClient();
    repository = new PgsqlProviderTokenRepository("postgresql://localhost/test", "A".repeat(32));
    await new Promise((resolve) => setImmediate(resolve));
    expect(initClient.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE"));
  });

  afterEach(async () => {
    await repository.close();
    expect(mockPool.end).toHaveBeenCalled();
  });

  it("upserts encrypted token values and preserves returned plaintext", async () => {
    setupNextClient(() => ({ rows: [] }));
    const upsertClient = setupNextClient();

    const saved = await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      status: "valid",
    });

    const params = upsertClient.query.mock.calls[0][1];
    expect(saved.accessToken).toBe("access-token");
    expect(params[4]).not.toBe("access-token");
    expect(params[5]).not.toBe("refresh-token");
  });

  it("decrypts token values when reading rows", async () => {
    setupNextClient(() => ({ rows: [] }));
    const upsertClient = setupNextClient();
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      status: "valid",
    });
    const ciphertext = upsertClient.query.mock.calls[0][1];

    const findClient = setupNextClient(() => ({
      rows: [
        {
          id: "feishu:user:user-1",
          provider: "feishu",
          ownerType: "user",
          ownerId: "user-1",
          accessToken: ciphertext[4],
          refreshToken: ciphertext[5],
          status: "valid",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    }));

    const found = await repository.find("feishu", "user", "user-1");

    expect(found).toMatchObject({ accessToken: "access-token", refreshToken: "refresh-token" });
    expect(findClient.release).toHaveBeenCalled();
  });
});
