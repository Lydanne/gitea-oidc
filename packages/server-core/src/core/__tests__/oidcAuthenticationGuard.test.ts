import { createHmac, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Provider } from "oidc-provider";
import { afterEach, describe, expect, it } from "vitest";
import { acquireOidcAccountBlock } from "../../adapters/oidcClientRevocationBarrier.js";
import { SqliteOidcAdapter } from "../../adapters/SqliteOidcAdapter.js";
import { MemoryUserRepository } from "../../repositories/MemoryUserRepository.js";
import { AccountSecurity } from "../../security/AccountSecurity.js";
import { PasswordChangeRevocations } from "../../security/PasswordChangeRevocations.js";
import { MemorySecurityRepository } from "../../security/SecurityRepository.js";
import { MemoryBffSessionRevocations } from "../../sessions/BffSessionRevocations.js";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import type { UserInfo } from "../../types/auth.js";
import { registerOidcAuthenticationGuard } from "../oidcAuthenticationGuard.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...privateKey.export({ format: "jwk" }),
  kid: "guard-test",
  use: "sig",
  alg: "RS256",
};
const clientId = "guard-client";
const clientSecret = "guard-client-secret-only-for-tests";
const redirectUri = "https://client.example/callback";

describe("OIDC 认证撤销请求边界", () => {
  const directories: string[] = [];
  const servers: Server[] = [];
  const states: MemoryStateStore[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
    for (const state of states.splice(0)) state.destroy();
    await SqliteOidcAdapter.closeAll();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
  });

  async function setup(findAccountGate?: () => Promise<void>, passwordChange = false) {
    const directory = mkdtempSync(join(tmpdir(), "x-oidc-guard-"));
    directories.push(directory);
    const database = join(directory, "oidc.db");
    let oidc: Provider;
    const server = createServer((request, response) => oidc.callback()(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    const issuer = `http://127.0.0.1:${address.port}`;
    oidc = new Provider(issuer, {
      adapter: (name) => new SqliteOidcAdapter(name, database),
      clients: [{ client_id: clientId, client_secret: clientSecret, redirect_uris: [redirectUri] }],
      jwks: { keys: [jwk] },
      cookies: { keys: ["test-cookie-key-with-enough-entropy-for-guard"] },
      features: { devInteractions: { enabled: false } },
      interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
      findAccount: async (_ctx, accountId) => {
        await findAccountGate?.();
        return { accountId, claims: async () => ({ sub: accountId }) };
      },
    });
    const generations = new MemoryBffSessionRevocations();
    const coordinator = {
      captureAuthenticationGeneration: async () =>
        passwordChange
          ? JSON.stringify({
              login: generations.captureLoginGeneration(),
              security: await passwordSecurity.captureAuthenticationVersion(),
            })
          : generations.captureLoginGeneration(),
      assertAuthenticationGeneration: async (generation: unknown, accountId?: string) => {
        if (typeof generation !== "string") throw new Error("Missing generation");
        if (passwordChange) {
          const snapshot = JSON.parse(generation);
          generations.assertLoginGeneration(snapshot.login);
          await passwordSecurity.assertAuthenticationVersion(snapshot.security, accountId);
          return;
        }
        generations.assertLoginGeneration(generation);
      },
      validateInteractionAuthentication: async (proof: unknown, accountId: string) => {
        if (!proof || typeof proof !== "object") throw new Error("Missing authentication proof");
        const value = proof as { generation?: unknown; userId?: unknown; recordId?: unknown };
        if (value.userId !== accountId || value.recordId !== "record-1") {
          throw new Error("Authentication principal changed");
        }
        await coordinator.assertAuthenticationGeneration(value.generation, accountId);
      },
    };
    registerOidcAuthenticationGuard(oidc, coordinator);
    const passwordState = new MemoryStateStore();
    states.push(passwordState);
    const passwordUsers = new MemoryUserRepository();
    passwordUsers.findById = async (sub) =>
      ({ id: sub === "user-1" ? "record-1" : "record-2", sub, username: sub }) as UserInfo;
    const passwordSecurity = new AccountSecurity(
      new MemorySecurityRepository(),
      passwordState,
      passwordUsers,
      issuer,
      new PasswordChangeRevocations(generations, {
        acquireBlock: acquireOidcAccountBlock,
        revoke: (accountId) => SqliteOidcAdapter.revokeByAccountId(database, accountId),
      }),
    );
    const invalidate = async (otherUser = false) => {
      if (passwordChange) {
        try {
          await passwordSecurity.changePassword(
            {
              id: otherUser ? "record-2" : "record-1",
              sub: otherUser ? "user-2" : "user-1",
              username: "test-user",
            } as UserInfo,
            "Test-Changed-Password-123!",
            { passwordFile: "test.htpasswd", passwordFormat: "bcrypt" },
          );
        } finally {
          passwordState.destroy();
        }
        return;
      }
      const lease = generations.blockUser("user-1");
      await lease.commit();
      generations.allowUser("user-1");
    };
    const proof = () => ({
      generation: passwordChange
        ? JSON.stringify({ login: generations.captureLoginGeneration(), security: 0 })
        : generations.captureLoginGeneration(),
      userId: "user-1",
      recordId: "record-1",
    });
    const requestToken = async (code: string) => {
      return fetch(`${issuer}/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
        redirect: "manual",
      });
    };
    const createCode = async () => {
      const grant = new oidc.Grant({ accountId: "user-1", clientId });
      grant.addOIDCScope("openid");
      const grantId = await grant.save();
      const code = new oidc.AuthorizationCode({
        accountId: "user-1",
        clientId,
        grantId,
        redirectUri,
        scope: "openid",
        authTime: Math.floor(Date.now() / 1000),
        claims: {},
      });
      const refresh = await new oidc.RefreshToken({
        accountId: "user-1",
        clientId,
        grantId,
        scope: "openid",
        authTime: Math.floor(Date.now() / 1000),
        claims: {},
      }).save();
      return { code: await code.save(), grantId, refresh };
    };
    const createInteraction = async (
      result: Record<string, unknown>,
      lastSubmission?: Record<string, unknown>,
    ) => {
      const grant = new oidc.Grant({ accountId: "user-1", clientId });
      grant.addOIDCScope("openid");
      const grantId = await grant.save();
      const interaction = new oidc.Interaction("guard-interaction", {
        returnTo: `${issuer}/auth/guard-interaction`,
        prompt: { name: "login", reasons: [], details: {} },
        params: {
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid",
        },
        result,
        lastSubmission,
        grantId,
      });
      await interaction.save(300);
      const cookieName = oidc.cookieName("resume");
      const cookieValue = `${cookieName}=${interaction.uid}`;
      // 与真实 Cookies 中间件相同的已签名 resume cookie。
      const signature = createHmac("sha1", "test-cookie-key-with-enough-entropy-for-guard")
        .update(cookieValue)
        .digest("base64url");
      const resume = () =>
        fetch(interaction.returnTo, {
          redirect: "manual",
          headers: { cookie: `${cookieValue}; ${cookieName}.sig=${signature}` },
        });
      return { interaction, resume, grantId };
    };
    return {
      oidc,
      issuer,
      proof,
      invalidate,
      createCode,
      createInteraction,
      requestToken,
      database,
    };
  }

  it("正常第三方 RP 授权码交换仍签发令牌", async () => {
    const fixture = await setup();
    const { code } = await fixture.createCode();
    const response = await fixture.requestToken(code);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access_token: expect.any(String),
      id_token: expect.any(String),
    });
  });

  it("正常携带认证证明的登录 Interaction 可以继续完成授权", async () => {
    const fixture = await setup();
    const { interaction, grantId, resume } = await fixture.createInteraction({
      login: { accountId: "user-1" },
      x_oidc_authentication: fixture.proof(),
    });
    interaction.result!.consent = { grantId };
    await interaction.persist();
    const response = await resume();
    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toMatch(/^https:\/\/client\.example\/callback\?code=/);
    expect(new URL(location!).searchParams.get("code")).toBeTruthy();
  });

  it("登录恢复请求跨越撤销恢复后清理内层 finally 已保存的 Session", async () => {
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await setup(async () => {
      entered();
      await pending;
    });
    const { interaction, grantId, resume } = await fixture.createInteraction({
      login: { accountId: "user-1" },
      x_oidc_authentication: fixture.proof(),
    });
    interaction.result!.consent = { grantId };
    await interaction.persist();
    const responsePromise = resume();
    await paused;
    await fixture.invalidate();
    release();
    const response = await responsePromise;
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    const db = new Database(fixture.database, { readonly: true });
    expect(
      db.prepare("SELECT count(*) AS count FROM oidc_store WHERE name = 'Session'").get(),
    ).toEqual({ count: 0 });
    db.close();
    expect(await fixture.oidc.Grant.find(grantId)).toBeUndefined();
  });

  it("已读入 Grant 的授权码交换跨越撤销恢复后不返回凭据并清理 Grant", async () => {
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await setup(async () => {
      entered();
      await pending;
    });
    const { code, grantId } = await fixture.createCode();
    const responsePromise = fixture.requestToken(code);
    await paused;
    await fixture.invalidate();
    release();
    const response = await responsePromise;
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    const body = await response.json();
    expect(body).toMatchObject({ error: "invalid_request" });
    expect(body).not.toHaveProperty("access_token");
    expect(body).not.toHaveProperty("id_token");
    expect(await fixture.oidc.Grant.find(grantId)).toBeUndefined();
    const db = new Database(fixture.database, { readonly: true });
    expect(
      db.prepare("SELECT count(*) AS count FROM oidc_store WHERE name = 'AccessToken'").get(),
    ).toEqual({ count: 0 });
    db.close();
  });

  it.each(["resume", "code"])("其他账号改密不干扰真实 OIDC %s 请求或删除既有授权", async (kind) => {
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await setup(async () => {
      entered();
      await pending;
    }, true);
    const { code, grantId, refresh } = await fixture.createCode();
    let responsePromise: Promise<Response>;
    if (kind === "resume") {
      const {
        interaction,
        grantId: loginGrant,
        resume,
      } = await fixture.createInteraction({
        login: { accountId: "user-1" },
        x_oidc_authentication: fixture.proof(),
      });
      interaction.result!.consent = { grantId: loginGrant };
      await interaction.persist();
      responsePromise = resume();
    } else responsePromise = fixture.requestToken(code);
    await paused;
    try {
      await fixture.invalidate(true);
    } finally {
      release();
    }
    const response = await responsePromise;
    expect(response.status).toBe(kind === "resume" ? 303 : 200);
    expect(await fixture.oidc.Grant.find(grantId)).toBeDefined();
    expect(await fixture.oidc.RefreshToken.find(refresh)).toBeDefined();
  });

  it.each(["resume", "code"])("真实 OIDC %s 请求跨越改密后不返回旧认证凭据", async (kind) => {
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await setup(async () => {
      entered();
      await pending;
    }, true);
    let responsePromise: Promise<Response>;
    if (kind === "resume") {
      const { interaction, grantId, resume } = await fixture.createInteraction({
        login: { accountId: "user-1" },
        x_oidc_authentication: fixture.proof(),
      });
      interaction.result!.consent = { grantId };
      await interaction.persist();
      responsePromise = resume();
    } else {
      const { code } = await fixture.createCode();
      responsePromise = fixture.requestToken(code);
    }
    await paused;
    try {
      await fixture.invalidate();
    } finally {
      release();
    }
    const response = await responsePromise;
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.json();
    expect(body).toMatchObject({ error: "invalid_request" });
    expect(body).not.toHaveProperty("access_token");
    expect(body).not.toHaveProperty("id_token");
    const db = new Database(fixture.database, { readonly: true });
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM oidc_store WHERE name IN ('Session', 'Grant', 'AccessToken', 'RefreshToken', 'AuthorizationCode')",
        )
        .get(),
    ).toEqual({ count: 0 });
    db.close();
  });

  it.each([
    "login",
    "consent",
  ])("撤销恢复后才保存的 %s Interaction 在登录 Session 写入前被拒绝", async (kind) => {
    const fixture = await setup();
    const oldProof = fixture.proof();
    await fixture.invalidate();
    const result =
      kind === "login"
        ? { login: { accountId: "user-1" }, x_oidc_authentication: oldProof }
        : { consent: {}, x_oidc_authentication: oldProof };
    const { interaction, resume } = await fixture.createInteraction(result);
    const response = await resume();
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(await fixture.oidc.Interaction.find(interaction.uid)).toBeUndefined();
  });

  it.each(["login", "consent"])("旧版缺失认证证明的 %s Interaction 不能恢复登录", async (kind) => {
    const fixture = await setup();
    const result = kind === "login" ? { login: { accountId: "user-1" } } : { consent: {} };
    const { resume } = await fixture.createInteraction(result);
    const response = await resume();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("lastSubmission 中的旧认证证明同样不能被新 consent 绕过", async () => {
    const fixture = await setup();
    const oldProof = fixture.proof();
    await fixture.invalidate();
    const { resume } = await fixture.createInteraction(
      { consent: {}, x_oidc_authentication: fixture.proof() },
      { login: { accountId: "user-1" }, x_oidc_authentication: oldProof },
    );
    expect((await resume()).status).toBe(400);
  });
});
