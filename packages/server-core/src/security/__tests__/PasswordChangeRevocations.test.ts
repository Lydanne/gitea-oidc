import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "bcrypt";
import Fastify from "fastify";
import { TOTP } from "otpauth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OidcAdapterFactory } from "../../adapters/OidcAdapterFactory.js";
import { AuthCoordinator } from "../../core/AuthCoordinator.js";
import { LocalAuthProvider } from "../../providers/LocalAuthProvider.js";
import { MemoryUserRepository } from "../../repositories/MemoryUserRepository.js";
import { registerAdminRoutes } from "../../routes/adminRoutes.js";
import { registerPortalRoutes } from "../../routes/portalRoutes.js";
import {
  DistributedBffSessionRevocations,
  getMemoryBffSessionRevocations,
} from "../../sessions/BffSessionRevocations.js";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import type { AuthContext } from "../../types/auth.js";
import { AccountSecurity } from "../AccountSecurity.js";
import { PasswordChangeRevocations } from "../PasswordChangeRevocations.js";
import { MemorySecurityRepository } from "../SecurityRepository.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) await close();
  await OidcAdapterFactory.cleanup();
});
const oldPassword = "Test-Previous-Password-123!";
const newPassword = "Test-Changed-Password-456!";

async function setup(distributed: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "x-oidc-password-revoke-"));
  const app = Fastify();
  const stateStore = new MemoryStateStore();
  cleanup.push(
    () => app.close(),
    () => stateStore.destroy(),
    () => rm(dir, { recursive: true, force: true }),
  );
  const users = new MemoryUserRepository();
  const createUser = (username: string) =>
    users.findOrCreate("local", username, {
      username,
      name: username,
      email: `${username}@example.com`,
      groups: [{ id: "x-oidc-admins", name: "x-oidc-admins" }],
    });
  const user = await createUser("alice");
  const other = await createUser("other");
  OidcAdapterFactory.configure({ type: "sqlite", sqlite: { dbPath: join(dir, "oidc.db") } });
  const generations = distributed
    ? new DistributedBffSessionRevocations(stateStore, 7200)
    : getMemoryBffSessionRevocations(app, 7200);
  const lifecycle = new PasswordChangeRevocations(generations, {
    acquireBlock: (id) => OidcAdapterFactory.acquireAccountIdBlock(id),
    revoke: (id) => OidcAdapterFactory.revokeByAccountId(id),
  });
  const credentials = new MemorySecurityRepository();
  const security = new AccountSecurity(
    credentials,
    stateStore,
    users,
    "http://localhost:3000",
    lifecycle,
  );
  const passwordFile = join(dir, ".htpasswd");
  await writeFile(passwordFile, `alice:${await hash(oldPassword, 4)}\n`);
  const localConfig = {
    enabled: true,
    displayName: "Local",
    config: { passwordFile, passwordFormat: "bcrypt", adminUsers: ["alice"] },
  };
  const local = new LocalAuthProvider(users, stateStore, security);
  const coordinator = new AuthCoordinator({
    app,
    stateStore,
    userRepository: users,
    accountSecurity: security,
    authenticationRevocations: generations,
    providersConfig: { local: localConfig },
  });
  coordinator.registerProvider(local);
  await coordinator.initialize();
  const config = {
    auth: { stateStore: { type: distributed ? "redis" : "memory" } },
    server: { url: "http://localhost:3000" },
    oidc: { issuer: "http://localhost:3000/oidc" },
    admin: {
      enabled: true,
      basePath: "/admin",
      allowedGroups: ["x-oidc-admins"],
      sessionTtlSeconds: 3600,
    },
    portal: {
      enabled: true,
      basePath: "/portal",
      clientId: "portal-client",
      sessionTtlSeconds: 7200,
    },
    clients: [
      {
        client_id: "admin-client",
        client_secret: "test-client-secret",
        redirect_uris: ["http://localhost:3000/admin/callback"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_basic",
      },
      {
        client_id: "portal-client",
        client_secret: "test-client-secret",
        redirect_uris: ["http://localhost:3000/portal/callback"],
        post_logout_redirect_uris: ["http://localhost:3000/portal/signed-out"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_basic",
      },
    ],
  } as any;
  const base = {
    app,
    config,
    oidcProvider: {} as any,
    userRepository: users,
    publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
    stateStore,
    accountSecurity: security,
    localProvider: local,
  };
  const admin = registerAdminRoutes({ ...base, authCoordinator: coordinator })!;
  const portal = registerPortalRoutes({ ...base, listPortalApplications: () => [] as any })!;
  const adminSession = await admin.createSession(user.sub);
  const portalSession = await portal.createSession(user.sub);
  const otherAdmin = await admin.createSession(other.sub);
  const otherPortal = await portal.createSession(other.sub);
  const change = (basePath = "/admin", session = adminSession.id) =>
    app.inject({
      method: "POST",
      url: `${basePath}/api/security/password`,
      headers: {
        origin: "http://localhost:3000",
        "x-oidc-security": "1",
        cookie: `${basePath === "/admin" ? "x_oidc_admin_session" : "x_oidc_portal_session"}=${session}`,
      },
      payload: { password: oldPassword, newPassword, confirmPassword: newPassword },
    });
  return {
    app,
    users,
    user,
    other,
    credentials,
    security,
    stateStore,
    generations,
    coordinator,
    local,
    admin,
    portal,
    adminSession,
    portalSession,
    otherAdmin,
    otherPortal,
    change,
  };
}

for (const distributed of [false, true]) {
  describe(`${distributed ? "共享" : "内存"} 改密撤销`, () => {
    it("OTP 启用拒绝旧单因素证明与迟到登录，但不影响其他账号或后续正常验证码消费", async () => {
      const f = await setup(distributed);
      const old = await f.coordinator.captureAuthenticationGeneration();
      const proof = await f.coordinator.createInteractionAuthentication(old, f.user.sub);
      await f.coordinator.storeAuthResult("before-otp", f.user.sub, undefined, old);
      let entered!: () => void;
      let resume!: () => void;
      const checked = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const authenticate = f.local.authenticate.bind(f.local);
      vi.spyOn(f.local, "authenticate").mockImplementationOnce(async (context) => {
        const result = await authenticate(context);
        expect(result.success).toBe(true);
        entered();
        await pending;
        return result;
      });
      const login = f.coordinator.handleAuthentication({
        authMethod: "local",
        interactionUid: "otp-race",
        body: { username: "alice", password: oldPassword },
        params: {},
        query: {},
        request: { ip: "127.0.0.1", headers: {} },
        reply: {},
      } as AuthContext);
      await checked;
      const otpSetup = await f.security.beginOtp(f.user, "session");
      let codes: { recoveryCodes: string[] };
      try {
        codes = await f.security.confirmOtp(
          f.user,
          "session",
          otpSetup.id,
          new TOTP({ secret: otpSetup.secret }).generate(),
        );
      } finally {
        resume();
      }
      expect((await login).success).toBe(false);
      expect(await f.coordinator.consumeAuthResult("before-otp")).toBeNull();
      await expect(
        f.coordinator.validateInteractionAuthentication(proof, f.user.sub),
      ).rejects.toThrow();
      await expect(
        f.coordinator.assertAuthenticationGeneration(old, f.other.sub),
      ).resolves.toBeUndefined();
      const fresh = await f.coordinator.captureAuthenticationGeneration();
      expect(await f.security.verifyOtp(f.user, codes.recoveryCodes[0])).toBe(true);
      await expect(
        f.coordinator.assertAuthenticationGeneration(fresh, f.user.sub),
      ).resolves.toBeUndefined();
    });

    it.each([
      "admin",
      "portal",
    ])("从 %s 改密后撤销两端会话、OIDC 记录与旧登录结果，其他用户会话保持有效", async (source) => {
      const f = await setup(distributed);
      const generation = await f.coordinator.captureAuthenticationGeneration();
      await f.coordinator.storeAuthResult("old-login", f.user.sub, undefined, generation);
      const oauthState = await f.coordinator.generateOAuthState("old-oauth", "feishu");
      const proof = await f.coordinator.createInteractionAuthentication(generation, f.user.sub);
      const passkeyFlow = await f.security.createLoginFlow("browser", "interaction", generation);
      const records = [
        "Session",
        "Grant",
        "AccessToken",
        "RefreshToken",
        "AuthorizationCode",
        "Interaction",
      ];
      for (const model of records) {
        await OidcAdapterFactory.create(model).upsert(
          `victim-${model}`,
          { accountId: f.user.sub, clientId: "test-client" },
          600,
        );
        await OidcAdapterFactory.create(model).upsert(
          `other-${model}`,
          { accountId: f.other.sub, clientId: "test-client" },
          600,
        );
      }
      const response = await f.change(
        `/${source}`,
        source === "admin" ? f.adminSession.id : f.portalSession.id,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        redirectTo: `/${source}/login/start?returnTo=${encodeURIComponent(`/${source}/security`)}`,
      });
      expect(
        (
          await f.app.inject({
            url: "/admin/api/me",
            headers: { cookie: `x_oidc_admin_session=${f.adminSession.id}` },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await f.app.inject({
            url: "/portal/api/me",
            headers: { cookie: `x_oidc_portal_session=${f.portalSession.id}` },
          })
        ).statusCode,
      ).toBe(401);
      expect(await f.admin.getSession(f.otherAdmin.id)).not.toBeNull();
      expect(await f.portal.getSession(f.otherPortal.id)).not.toBeNull();
      expect(await f.coordinator.consumeAuthResult("old-login")).toBeNull();
      const verifiedState = await f.coordinator.verifyOAuthState(oauthState);
      await expect(
        f.coordinator.assertAuthenticationGeneration(
          verifiedState?.authenticationGeneration,
          f.user.sub,
        ),
      ).rejects.toThrow();
      await expect(
        f.coordinator.assertAuthenticationGeneration(generation, f.other.sub),
      ).resolves.toBeUndefined();
      await expect(
        f.coordinator.validateInteractionAuthentication(proof, f.user.sub),
      ).rejects.toThrow();
      await expect(
        f.coordinator.storeAuthResult("late-login", f.user.sub, undefined, generation),
      ).rejects.toThrow();
      const flow = await f.security.readLoginFlow(passkeyFlow, "browser");
      await expect(
        f.coordinator.assertAuthenticationGeneration(flow.generation, f.user.sub),
      ).rejects.toThrow();
      for (const model of records) {
        expect(await OidcAdapterFactory.create(model).find(`victim-${model}`)).toBeFalsy();
        expect(await OidcAdapterFactory.create(model).find(`other-${model}`)).toBeTruthy();
      }
      expect(await f.local.verifyUserPassword(f.user, oldPassword)).toBe(false);
      expect(await f.local.verifyUserPassword(f.user, newPassword)).toBe(true);
      const freshGeneration = await f.coordinator.captureAuthenticationGeneration();
      await f.coordinator.storeAuthResult("new-login", f.user.sub, undefined, freshGeneration);
      expect(await f.coordinator.consumeAuthResult("new-login")).not.toBeNull();
      expect(await f.admin.createSession(f.user.sub)).toBeTruthy();
      expect((await f.users.findById(f.user.sub))?.status).toBe("active");
    });

    it("已经通过旧密码校验但尚未返回的认证请求，在改密后不能完成登录", async () => {
      const f = await setup(distributed);
      let entered!: () => void;
      let resume!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const authenticate = f.local.authenticate.bind(f.local);
      vi.spyOn(f.local, "authenticate").mockImplementationOnce(async (context) => {
        const result = await authenticate(context);
        expect(result.success).toBe(true);
        entered();
        await pending;
        return result;
      });
      const login = f.coordinator.handleAuthentication({
        authMethod: "local",
        interactionUid: "pending-login",
        body: { username: "alice", password: oldPassword },
        params: {},
        query: {},
        request: { ip: "127.0.0.1", headers: {} },
        reply: {},
      } as AuthContext);
      await waiting;
      try {
        expect((await f.change()).statusCode).toBe(200);
      } finally {
        resume();
      }
      expect((await login).success).toBe(false);
    });

    it("改密后迟到写入的认证结果也不能再消费", async () => {
      const f = await setup(distributed);
      const generation = await f.coordinator.captureAuthenticationGeneration();
      const set = f.stateStore.set.bind(f.stateStore);
      let entered!: () => void;
      let resume!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      vi.spyOn(f.stateStore, "set").mockImplementation(async (key, value, ttl) => {
        if (key === "auth_result_late") {
          entered();
          await pending;
        }
        await set(key, value, ttl);
      });
      const writing = f.coordinator.storeAuthResult("late", f.user.sub, undefined, generation);
      const rejected = expect(writing).rejects.toThrow();
      await waiting;
      try {
        expect((await f.change()).statusCode).toBe(200);
      } finally {
        resume();
      }
      await rejected;
      expect(await f.coordinator.consumeAuthResult("late")).toBeNull();
    });

    it("撤销失败不更新密码；释放自己的租约不会解除其他停用操作", async () => {
      const f = await setup(distributed);
      const revoke = vi
        .spyOn(OidcAdapterFactory, "revokeByAccountId")
        .mockRejectedValueOnce(new Error("simulated revocation failure"));
      expect((await f.change()).statusCode).toBe(500);
      expect(await f.local.verifyUserPassword(f.user, oldPassword)).toBe(true);
      expect(await f.local.verifyUserPassword(f.user, newPassword)).toBe(false);
      revoke.mockRestore();
      const ownSession = await f.admin.createSession(f.user.sub);
      const disableBff = await f.generations.blockUser(f.user.sub);
      const disableOidc = await OidcAdapterFactory.acquireAccountIdBlock(f.user.sub);
      try {
        await f.security.changePassword(f.user, newPassword, f.local.getConfig());
        await expect(
          Promise.resolve().then(() => f.admin.createSession(f.user.sub)),
        ).rejects.toThrow();
        await expect(
          OidcAdapterFactory.create("Session").upsert(
            "late-session",
            { accountId: f.user.sub },
            600,
          ),
        ).rejects.toThrow();
        expect(await f.admin.getSession(ownSession.id)).toBeNull();
      } finally {
        await disableOidc.release();
        await disableBff.release();
      }
      expect(await f.admin.createSession(f.user.sub)).toBeTruthy();
    });
  });
}

it("一个租约释放失败仍清理另一个租约，并拒绝报告改密成功", async () => {
  const sessionLease = {
    commit: vi.fn(),
    release: vi.fn().mockRejectedValue(new Error("simulated cleanup failure")),
  };
  const oidcLease = { accountId: "user", commit: vi.fn(), release: vi.fn() };
  const revocations = new PasswordChangeRevocations(
    { blockUser: () => sessionLease },
    { acquireBlock: () => oidcLease, revoke: vi.fn() },
  );
  const save = vi.fn();
  await expect(revocations.run("user", save)).rejects.toThrow("cleanup failure");
  expect(save).toHaveBeenCalledOnce();
  expect(oidcLease.release).toHaveBeenCalledOnce();
});
