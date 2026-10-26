import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgsqlAuditLogRepository } from "../PgsqlAuditLogRepository.js";

type QueryResponder = (sql: string, params: unknown[]) => Promise<unknown> | unknown;

const mockPool = {
  connect: vi.fn(),
  end: vi.fn(async () => undefined),
};

vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      return mockPool;
    }
  },
}));

function setupNextClient(responder?: QueryResponder) {
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) =>
      responder ? responder(sql, params) : { rows: [], rowCount: 0 },
    ),
    release: vi.fn(),
  };
  mockPool.connect.mockImplementationOnce(async () => client);
  return client;
}

describe("PgsqlAuditLogRepository", () => {
  let repository: PgsqlAuditLogRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    const initClient = setupNextClient();
    repository = new PgsqlAuditLogRepository("postgresql://localhost/test");
    await new Promise((resolve) => setImmediate(resolve));
    expect(initClient.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE"));
    expect(initClient.release).toHaveBeenCalled();
  });

  afterEach(async () => {
    await repository.close();
    expect(mockPool.end).toHaveBeenCalled();
  });

  it("写入结构化审计记录", async () => {
    const client = setupNextClient();
    const createdAt = new Date("2026-03-01T00:00:00.000Z");

    const record = await repository.append({
      eventType: "user.updated",
      outcome: "success",
      source: "admin",
      userId: "user-1",
      actorUserId: "admin-1",
      changedFields: ["groups"],
      createdAt,
    });

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO audit_logs");
    expect(params).toEqual([
      record.id,
      "user.updated",
      "success",
      "admin",
      "user-1",
      "admin-1",
      null,
      null,
      null,
      null,
      null,
      ["groups"],
      null,
      null,
      null,
      createdAt,
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it("使用参数化条件查询目标用户或操作用户", async () => {
    const createdAt = new Date("2026-03-02T00:00:00.000Z");
    const row = {
      id: "audit-1",
      eventType: "user.login",
      outcome: "failure",
      source: "provider",
      userId: "user-1",
      actorUserId: null,
      username: "alice",
      changedFields: ["groups"],
      createdAt,
    };
    const client = setupNextClient(() => ({ rows: [row] }));

    const records = await repository.list({
      userId: "user-1",
      eventType: "user.login",
      outcome: "failure",
      from: new Date("2026-03-01T00:00:00.000Z"),
      limit: 20,
      offset: 10,
    });

    const [sql, params] = client.query.mock.calls[0];
    expect(sql.replace(/\s+/g, " ")).toContain(
      '("userId" = $1 OR "actorUserId" = $2) AND "eventType" = $3 AND outcome = $4',
    );
    expect(params).toEqual([
      "user-1",
      "user-1",
      "user.login",
      "failure",
      new Date("2026-03-01T00:00:00.000Z"),
      20,
      10,
    ]);
    expect(records[0]).toMatchObject({
      id: "audit-1",
      eventType: "user.login",
      changedFields: ["groups"],
      createdAt,
    });
    expect(client.release).toHaveBeenCalled();
  });

  it("统计和清理均返回数据库结果", async () => {
    const countClient = setupNextClient(() => ({ rows: [{ count: "3" }] }));
    expect(await repository.count({ outcome: "failure" })).toBe(3);
    expect(countClient.query.mock.calls[0][1]).toEqual(["failure"]);

    const deleteClient = setupNextClient(() => ({ rows: [], rowCount: 2 }));
    const before = new Date("2026-01-01T00:00:00.000Z");
    expect(await repository.deleteOlderThan(before)).toBe(2);
    expect(deleteClient.query).toHaveBeenCalledWith(
      'DELETE FROM audit_logs WHERE "createdAt" < $1',
      [before],
    );
  });
});
