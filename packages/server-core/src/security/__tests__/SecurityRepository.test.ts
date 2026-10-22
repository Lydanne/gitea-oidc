import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSecurityRecord, PgsqlSecurityRepository } from "../SecurityRepository.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), options: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) {
      mocks.options(options);
    }
    query = mocks.query;
    end = mocks.end;
  },
}));

describe("PostgreSQL 安全凭据持久化契约", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.end.mockResolvedValue(undefined);
  });
  it("结构化连接参数与用户仓储默认数据库一致，密码不会拼接进 URL", async () => {
    const repo = new PgsqlSecurityRepository(
      { host: "db.example.com", password: "test-password:@" },
      "K".repeat(32),
    );
    expect(mocks.options).toHaveBeenCalledWith({
      host: "db.example.com",
      port: 5432,
      database: "x_oidc",
      user: "postgres",
      password: "test-password:@",
    });
    await repo.get("user-id");
    await repo.close();
    expect(mocks.end).toHaveBeenCalled();
  });
  it("凭据加密后使用原子版本约束写入，并能解密读取", async () => {
    const repo = new PgsqlSecurityRepository(
      { connectionString: "postgresql://db.example.com/test" },
      "K".repeat(32),
    );
    const record = { ...newSecurityRecord("user-id", "alice"), totpSecret: "JBSWY3DPEHPK3PXP" };
    expect(await repo.compareAndSet("user:user-id", null, record)).toBe(true);
    const insertion = mocks.query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO account_security"),
    )!;
    const ciphertext = insertion[1][2];
    expect(ciphertext).not.toContain(record.totpSecret);
    mocks.query.mockResolvedValueOnce({ rows: [{ payload: ciphertext }] });
    expect(await repo.get("user:user-id")).toEqual(record);
    mocks.query.mockResolvedValueOnce({ rowCount: 0 });
    expect(await repo.compareAndSet("user:user-id", "stale-revision", record)).toBe(false);
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining("AND revision = $4"),
      expect.arrayContaining(["stale-revision"]),
    );
    await repo.close();
  });
});
