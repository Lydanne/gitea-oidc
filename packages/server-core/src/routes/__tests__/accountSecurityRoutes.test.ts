import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "bcrypt";
import Fastify, { type FastifyInstance } from "fastify";
import { TOTP } from "otpauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAuthProvider } from "../../providers/LocalAuthProvider.js";
import { MemoryUserRepository } from "../../repositories/MemoryUserRepository.js";
import { AccountSecurity } from "../../security/AccountSecurity.js";
import { MemorySecurityRepository } from "../../security/SecurityRepository.js";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import type { UserInfo } from "../../types/auth.js";
import { registerAccountSecurityRoutes } from "../accountSecurityRoutes.js";

describe("当前账号安全 API", () => {
  let app: FastifyInstance;
  let dir: string;
  let state: MemoryStateStore;
  let user: UserInfo;
  let security: AccountSecurity;
  const password = "Test-Password-123!";
  const headers = {
    origin: "https://id.example.com",
    "x-oidc-security": "1",
    cookie: "session=valid",
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "account-security-routes-"));
    app = Fastify();
    state = new MemoryStateStore();
    const users = new MemoryUserRepository();
    user = await users.findOrCreate("local", "alice", {
      username: "alice",
      name: "Alice",
      email: "alice@example.com",
    });
    security = new AccountSecurity(
      new MemorySecurityRepository(),
      state,
      users,
      "https://id.example.com",
    );
    const path = join(dir, ".htpasswd");
    await writeFile(path, `alice:${await hash(password, 4)}\n`);
    const localProvider = new LocalAuthProvider(users, state, security);
    await localProvider.initialize({
      enabled: true,
      displayName: "Local",
      config: { passwordFile: path, passwordFormat: "bcrypt" },
    });
    registerAccountSecurityRoutes({
      app,
      basePath: "/console",
      security,
      localProvider,
      requireUser: async (request, reply) => {
        if (request.headers.cookie !== "session=valid") {
          reply.code(401).send({ error: "Unauthorized" });
          return null;
        }
        return user;
      },
    });
  });
  afterEach(async () => {
    await app.close();
    await state.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  it("未登录不能读取或更改安全设置，跨站和缺少防 CSRF 头的请求被拒绝", async () => {
    expect((await app.inject({ url: "/console/api/security" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/otp/start",
          headers: { ...headers, origin: "https://attacker.example" },
          payload: { password },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/otp/start",
          headers: { origin: headers.origin, cookie: headers.cookie },
          payload: { password },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/otp/start",
          headers: { origin: headers.origin, "x-oidc-security": "1" },
          payload: { password },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("OTP 必须先验证当前密码并完成一次性确认，不允许重复确认", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/console/api/security/otp/start",
      headers,
      payload: { password: "wrong" },
    });
    expect(invalid.statusCode).toBe(400);
    const start = await app.inject({
      method: "POST",
      url: "/console/api/security/otp/start",
      headers,
      payload: { password },
    });
    expect(start.statusCode).toBe(200);
    const setup = start.json();
    expect((await security.summary(user)).otpEnabled).toBe(false);
    const payload = { id: setup.id, token: new TOTP({ secret: setup.secret }).generate() };
    const confirm = await app.inject({
      method: "POST",
      url: "/console/api/security/otp/confirm",
      headers,
      payload,
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().recoveryCodes).toHaveLength(10);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/otp/confirm",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(400);
    const summary = await app.inject({ url: "/console/api/security", headers });
    expect(summary.body).not.toContain(setup.secret);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/otp/disable",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/otp/disable",
          headers,
          payload: { password, otp: confirm.json().recoveryCodes[0] },
        })
      ).statusCode,
    ).toBe(200);
  });
  it.each(["otp/disable", "passkeys/start"])("不能用旧的无 OTP 验证快照执行 %s", async (action) => {
    const verify = security.verifySecondFactor.bind(security);
    vi.spyOn(security, "verifySecondFactor").mockImplementationOnce(async (...args) => {
      const proof = await verify(...args);
      const setup = await security.beginOtp(user, "other-session");
      await security.confirmOtp(
        user,
        "other-session",
        setup.id,
        new TOTP({ secret: setup.secret }).generate(),
      );
      return proof;
    });
    const result = await app.inject({
      method: "POST",
      url: `/console/api/security/${action}`,
      headers,
      payload: { password },
    });
    expect(result.statusCode).toBe(400);
    expect((await security.summary(user)).otpEnabled).toBe(true);
    expect((await security.summary(user)).passkeys).toHaveLength(0);
  });

  it("账号安全页保持同源脚本 CSP，外部账号不能写入本地凭据", async () => {
    const page = await app.inject({ url: "/console/security", headers });
    expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(page.body).not.toContain("<script>");
    user.authProvider = "feishu";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/password",
          headers,
          payload: {
            password,
            newPassword: "Changed-Password-123!",
            confirmPassword: "Changed-Password-123!",
          },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("修改密码后旧密码不能再授权安全设置，已有绑定挑战随凭据变化失效", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/console/api/security/otp/start",
      headers,
      payload: { password },
    });
    const changed = "Changed-Password-123!";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/password",
          headers,
          payload: { password, newPassword: changed, confirmPassword: changed },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/passkeys/start",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(400);
    const setup = start.json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/console/api/security/otp/confirm",
          headers,
          payload: { id: setup.id, token: new TOTP({ secret: setup.secret }).generate() },
        })
      ).statusCode,
    ).toBe(400);
  });
});
