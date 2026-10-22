import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "bcrypt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TOTP } from "otpauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCoordinator } from "../../core/AuthCoordinator.js";
import { LocalAuthProvider } from "../../providers/LocalAuthProvider.js";
import { MemoryUserRepository } from "../../repositories/MemoryUserRepository.js";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import type { AuthContext, LocalAuthConfig, UserInfo } from "../../types/auth.js";
import { AccountSecurity, validateNewPassword } from "../AccountSecurity.js";
import {
  MemorySecurityRepository,
  newSecurityRecord,
  SqliteSecurityRepository,
} from "../SecurityRepository.js";

describe("账号安全与首次登录", () => {
  let dir: string;
  let users: MemoryUserRepository;
  let state: MemoryStateStore;
  let repository: MemorySecurityRepository;
  let security: AccountSecurity;
  let config: LocalAuthConfig;
  const createdPassword = "Initial-Password-123!";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-oidc-security-"));
    users = new MemoryUserRepository();
    state = new MemoryStateStore();
    repository = new MemorySecurityRepository();
    security = new AccountSecurity(repository, state, users, "https://id.example.com");
    config = {
      passwordFile: join(dir, ".htpasswd"),
      passwordFormat: "bcrypt",
      adminUsers: ["admin"],
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    await state.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  const context = (username: string, password: string, extra = {}): AuthContext => ({
    authMethod: "local",
    interactionUid: "interaction",
    request: {} as FastifyRequest,
    reply: {} as FastifyReply,
    params: {},
    query: {},
    body: { username, password, ...extra },
  });
  async function createUser(): Promise<UserInfo> {
    return users.findOrCreate("local", "alice", {
      username: "alice",
      name: "Alice",
      email: "alice@example.com",
    });
  }
  async function enableOtp(user: UserInfo) {
    const setup = await security.beginOtp(user, "session");
    const token = new TOTP({ secret: setup.secret }).generate();
    return { setup, token, ...(await security.confirmOtp(user, "session", setup.id, token)) };
  }

  it("空白部署生成复杂临时密码，只写入受限文件，未改密不能认证", async () => {
    const provider = new LocalAuthProvider(users, state, security, true);
    await provider.initialize({ enabled: true, displayName: "Local", config });
    const path = `${config.passwordFile}.bootstrap.json`;
    const credentials = JSON.parse(await readFile(path, "utf8"));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(credentials.username).toBe("admin");
    expect(credentials.password.length).toBeGreaterThanOrEqual(32);
    expect(() => validateNewPassword(credentials.password, config)).not.toThrow();
    const initial = await provider.authenticate(context("admin", credentials.password));
    expect(initial.success).toBe(false);
    expect(initial.metadata?.passwordChangeRequired).toBe(true);
    const admin = (await users.findByUsername("admin"))!;
    const coordinator = new AuthCoordinator({
      app: { log: { warn: vi.fn(), error: vi.fn() } } as any,
      stateStore: state,
      userRepository: users,
      accountSecurity: security,
      providersConfig: {},
    });
    expect(await coordinator.findAccount(admin.sub)).toBeNull();
    expect(
      (
        await provider.authenticate(
          context("admin", credentials.password, { newPassword: "weak", confirmPassword: "weak" }),
        )
      ).success,
    ).toBe(false);
    expect(
      (
        await provider.authenticate(
          context("admin", credentials.password, {
            newPassword: createdPassword,
            confirmPassword: createdPassword,
          }),
        )
      ).success,
    ).toBe(true);
    expect(await coordinator.findAccount(admin.sub)).not.toBeNull();
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await provider.authenticate(context("admin", credentials.password))).success).toBe(
      false,
    );
    expect((await provider.authenticate(context("admin", createdPassword))).success).toBe(true);
    await security.bootstrap(config, new Set());
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await repository.get("bootstrap"))?.bootstrapPassword).toBeUndefined();
  });

  it("已有管理员密码和被显式禁用的初始化不被覆盖", async () => {
    await security.bootstrap(config, new Set(["admin"]));
    expect(await users.findByUsername("admin")).toBeNull();
    await security.bootstrap({ ...config, bootstrapAdmin: { enabled: false } }, new Set());
    expect(await users.findByUsername("admin")).toBeNull();
  });

  it("非空仓储不会再创建初始管理员", async () => {
    await createUser();
    await security.bootstrap(config, new Set());
    expect(await users.findByUsername("admin")).toBeNull();
    expect(await repository.get("bootstrap")).toBeNull();
    const provider = new LocalAuthProvider(users, state, security, true);
    await expect(
      provider.initialize({ enabled: true, displayName: "Local", config }),
    ).rejects.toThrow("Failed to load password file");
  });

  it("管理员自定义组在首次改密后的本地登录中保留", async () => {
    const provider = new LocalAuthProvider(users, state, security, true, ["operators"]);
    await provider.initialize({ enabled: true, displayName: "Local", config });
    const credentials = JSON.parse(await readFile(`${config.passwordFile}.bootstrap.json`, "utf8"));
    const result = await provider.authenticate(
      context("admin", credentials.password, {
        newPassword: createdPassword,
        confirmPassword: createdPassword,
      }),
    );
    expect(result.success).toBe(true);
    expect((await users.findByUsername("admin"))?.groups).toContainEqual({
      id: "operators",
      name: "operators",
    });
  });

  it("初始化意图写入失败时不创建没有密码的用户", async () => {
    vi.spyOn(repository, "compareAndSet").mockRejectedValueOnce(
      new Error("simulated unavailable store"),
    );
    await expect(security.bootstrap(config, new Set())).rejects.toThrow("unavailable");
    expect(await users.count()).toBe(0);
    await security.bootstrap(config, new Set());
    expect(await users.count()).toBe(1);
    expect((await repository.get("bootstrap"))?.ownerId).toBe(
      (await users.findByUsername("admin"))?.id,
    );
  });

  it("用户创建后最终绑定失败，重启继续初始化且不生成第二个密码", async () => {
    const original = repository.compareAndSet.bind(repository);
    let calls = 0;
    const fault = vi.spyOn(repository, "compareAndSet").mockImplementation(async (...args) => {
      if (calls++ === 1) throw new Error("simulated interrupted initialization");
      return original(...args);
    });
    await expect(security.bootstrap(config, new Set())).rejects.toThrow("interrupted");
    expect(await users.count()).toBe(1);
    const pending = await repository.get("bootstrap");
    expect(pending?.bootstrapPending).toBe(true);
    fault.mockRestore();
    const restarted = new AccountSecurity(repository, state, users, "https://id.example.com");
    await restarted.bootstrap(config, new Set());
    const completed = await repository.get("bootstrap");
    expect(completed?.bootstrapPending).toBe(false);
    expect(completed?.passwordHash).toBe(pending?.passwordHash);
    expect(completed?.bootstrapPassword).toBe(pending?.bootstrapPassword);
    expect(completed?.ownerId).toBe((await users.findByUsername("admin"))?.id);
    expect(await users.count()).toBe(1);
  });

  it("SQLite 重启保留管理员密码与强制改密状态，不重新生成", async () => {
    const path = join(dir, "users.db");
    const first = new SqliteSecurityRepository(path, "K".repeat(32));
    const initial = new AccountSecurity(first, state, users, "https://id.example.com");
    await initial.bootstrap(config, new Set());
    const credentials = await readFile(`${config.passwordFile}.bootstrap.json`, "utf8");
    await first.close();
    const second = new SqliteSecurityRepository(path, "K".repeat(32));
    const restarted = new AccountSecurity(second, state, users, "https://id.example.com");
    await restarted.bootstrap(config, new Set());
    expect(await readFile(`${config.passwordFile}.bootstrap.json`, "utf8")).toBe(credentials);
    expect(await restarted.requiresPasswordChange((await users.findByUsername("admin"))!)).toBe(
      true,
    );
    expect((await readFile(path)).includes(Buffer.from(JSON.parse(credentials).password))).toBe(
      false,
    );
    await second.close();
  });

  it("SQLite 安全表支持保留旧 Cookie Key 后轮换到新 Key", async () => {
    const path = join(dir, "rotation.db");
    const original = new SqliteSecurityRepository(path, "A".repeat(32));
    const record = newSecurityRecord("user-id", "alice");
    record.totpSecret = "JBSWY3DPEHPK3PXP";
    await original.compareAndSet("user:user-id", null, record);
    await original.close();
    const rotating = new SqliteSecurityRepository(path, ["B".repeat(32), "A".repeat(32)]);
    expect((await rotating.get("user:user-id"))?.totpSecret).toBe(record.totpSecret);
    await rotating.close();
    const rotated = new SqliteSecurityRepository(path, "B".repeat(32));
    expect((await rotated.get("user:user-id"))?.totpSecret).toBe(record.totpSecret);
    await rotated.close();
  });

  it("密码登录启用 OTP 后拒绝缺失、错误和重放的动态码", async () => {
    const user = await createUser();
    await writeFile(config.passwordFile, `alice:${await hash(createdPassword, 4)}\n`);
    const provider = new LocalAuthProvider(users, state, security);
    await provider.initialize({ enabled: true, displayName: "Local", config });
    const { setup, token } = await enableOtp(user);
    expect((await provider.authenticate(context("alice", createdPassword))).success).toBe(false);
    expect(
      (await provider.authenticate(context("alice", createdPassword, { otp: token }))).success,
    ).toBe(false);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30000);
    const next = new TOTP({ secret: setup.secret }).generate();
    expect(
      (await provider.authenticate(context("alice", createdPassword, { otp: next }))).success,
    ).toBe(true);
    expect(
      (await provider.authenticate(context("alice", createdPassword, { otp: next }))).success,
    ).toBe(false);
  });

  it("恢复码只消费一次，停用后旧密钥和恢复码失效", async () => {
    const user = await createUser();
    const { recoveryCodes } = await enableOtp(user);
    const results = await Promise.allSettled([
      security.verifyOtp(user, recoveryCodes[0]),
      security.verifyOtp(user, recoveryCodes[0]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled" && r.value)).toHaveLength(1);
    expect(await security.verifyOtp(user, recoveryCodes[0])).toBe(false);
    await security.disableOtp(user);
    const record = (await security.record(user)).value!;
    expect(record.totpSecret).toBeUndefined();
    expect(record.recoveryCodeHashes).toBeUndefined();
  });

  it("绑定挑战仅当前会话可用且一次消费；过期后不能绑定", async () => {
    const user = await createUser();
    const setup = await security.beginOtp(user, "session");
    const token = new TOTP({ secret: setup.secret }).generate();
    await expect(security.confirmOtp(user, "other", setup.id, token)).rejects.toThrow();
    await expect(security.confirmOtp(user, "session", setup.id, token)).rejects.toThrow();
    const second = await security.beginOtp(user, "session");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
    await expect(security.confirmOtp(user, "session", second.id, token)).rejects.toThrow();
  });

  it("删除重建相同 sub 的用户不会继承凭据", async () => {
    const user = await createUser();
    await enableOtp(user);
    await users.delete(user.sub);
    const recreated = await createUser();
    expect(recreated.id).not.toBe(user.id);
    expect((await security.summary(recreated)).otpEnabled).toBe(false);
  });

  it("Passkey 要求安全来源、一次性挑战和正确绑定，错误签名被拒绝", async () => {
    const user = await createUser();
    const insecure = new AccountSecurity(repository, state, users, "http://id.example.com");
    await expect(insecure.beginRegistration(user, "session")).rejects.toThrow("HTTPS");
    const options = await security.beginRegistration(user, "session");
    expect(options.options.authenticatorSelection?.userVerification).toBe("required");
    await expect(
      security.finishRegistration(user, "other", options.id, {} as any, "key"),
    ).rejects.toThrow();
    await expect(
      security.finishRegistration(user, "session", options.id, {} as any, "key"),
    ).rejects.toThrow();
    const valid = await security.beginRegistration(user, "session");
    await expect(
      security.finishRegistration(user, "session", valid.id, {} as any, "key"),
    ).rejects.toThrow();
    const login = await security.beginAuthentication("alice", "browser", "uid", "generation");
    await expect(
      security.finishAuthentication("other", "uid", login.id, {} as any),
    ).rejects.toThrow();
    await expect(
      security.finishAuthentication("browser", "uid", login.id, {} as any),
    ).rejects.toThrow();
  });

  it("安全表 CAS 拒绝旧版本写入，敏感字段不出现在摘要中", async () => {
    const user = await createUser();
    const { recoveryCodes } = await enableOtp(user);
    const { key, value } = await security.record(user);
    expect(
      await repository.compareAndSet(key, "wrong", newSecurityRecord(user.id, user.username)),
    ).toBe(false);
    const summary = JSON.stringify(await security.summary(user));
    expect(summary).not.toContain(value!.totpSecret);
    expect(summary).not.toContain(recoveryCodes[0]);
  });
});
