import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair } from "jose";
import Provider from "oidc-provider";
import { afterEach, describe, expect, it } from "vitest";
import { OidcAdapterFactory } from "../OidcAdapterFactory.js";

const servers: Server[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await OidcAdapterFactory.cleanup();
});

for (const backend of ["sqlite", "memory", "redis"] as const) {
  const test = backend === "redis" && !process.env.REDIS_TEST_URL ? it.skip : it;
  describe(`${backend} 真实 OIDC Token 在途撤销`, () => {
    for (const revoke of [false, true]) {
      test(revoke
        ? "已保存登录结果的旧 Interaction 撤销恢复后不能 resume 签发code"
        : "已保存登录结果的正常 Interaction 仍可 resume 签发code", async () => {
        OidcAdapterFactory.configure(
          backend === "redis"
            ? {
                type: "redis",
                redis: {
                  url: process.env.REDIS_TEST_URL,
                  keyPrefix: `interaction-review:${randomUUID()}:`,
                },
              }
            : backend === "memory"
              ? { type: "memory" }
              : { type: "sqlite", sqlite: { dbPath: ":memory:" } },
        );
        const server = createServer();
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing server port");
        const issuer = `http://127.0.0.1:${address.port}`;
        const { privateKey } = await generateKeyPair("RS256", { extractable: true });
        const cookieKey = "test-only-interaction-cookie-signing-key";
        const provider = new Provider(issuer, {
          adapter: OidcAdapterFactory.getAdapterFactory(),
          jwks: {
            keys: [
              { ...(await exportJWK(privateKey)), kid: "review-key", alg: "RS256", use: "sig" },
            ],
          },
          clients: [
            {
              client_id: "client",
              client_secret: "test-secret-value",
              redirect_uris: [`${issuer}/callback`],
              response_types: ["code"],
              grant_types: ["authorization_code"],
              token_endpoint_auth_method: "client_secret_basic",
            },
          ],
          cookies: { keys: [cookieKey] },
          features: { devInteractions: { enabled: false } },
          interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
          findAccount: async (_ctx, accountId) => ({
            accountId,
            claims: async () => ({ sub: accountId }),
          }),
        });
        server.on("request", provider.callback());
        const grant = new provider.Grant({ accountId: "victim", clientId: "client" });
        grant.addOIDCScope("openid");
        const grantId = await grant.save();
        const interaction = new provider.Interaction("saved-login", {
          returnTo: `${issuer}/auth/saved-login`,
          prompt: { name: "login", reasons: [], details: {} },
          params: {
            client_id: "client",
            redirect_uri: `${issuer}/callback`,
            response_type: "code",
            scope: "openid",
          },
          result: { login: { accountId: "victim" }, consent: { grantId } },
          grantId,
        });
        await interaction.save(300);
        if (revoke) {
          const lease = await OidcAdapterFactory.acquireAccountIdBlock("victim");
          await OidcAdapterFactory.revokeByAccountId("victim");
          await lease.commit();
          await OidcAdapterFactory.allowAccountId("victim");
          expect(await provider.Interaction.find(interaction.uid)).toBeUndefined();
        }
        const cookieName = provider.cookieName("resume");
        const cookieValue = `${cookieName}=${interaction.uid}`;
        const signature = createHmac("sha1", cookieKey).update(cookieValue).digest("base64url");
        const response = await fetch(interaction.returnTo, {
          redirect: "manual",
          headers: { cookie: `${cookieValue}; ${cookieName}.sig=${signature}` },
        });
        if (revoke) {
          expect(response.status).toBe(400);
          expect(response.headers.get("location")).toBeNull();
        } else {
          expect(response.status).toBe(303);
          expect(new URL(response.headers.get("location")!).searchParams.get("code")).toEqual(
            expect.any(String),
          );
        }
      }, 15_000);
    }

    for (const revoke of [false, true]) {
      test(revoke
        ? "查到账户后暂停的令牌交换不能跨撤销恢复签发"
        : "有效 Grant 正常交换仍可签发令牌", async () => {
        OidcAdapterFactory.configure(
          backend === "redis"
            ? {
                type: "redis",
                redis: {
                  url: process.env.REDIS_TEST_URL,
                  keyPrefix: `token-review:${randomUUID()}:`,
                },
              }
            : backend === "memory"
              ? { type: "memory" }
              : { type: "sqlite", sqlite: { dbPath: ":memory:" } },
        );
        const server = createServer();
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing server port");
        const issuer = `http://127.0.0.1:${address.port}`;
        const { privateKey } = await generateKeyPair("RS256", { extractable: true });
        const jwk = {
          ...(await exportJWK(privateKey)),
          kid: "review-key",
          alg: "RS256",
          use: "sig",
        };
        let entered!: () => void;
        let resume!: () => void;
        const accountEntered = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const accountGate = new Promise<void>((resolve) => {
          resume = resolve;
        });
        releases.push(resume);
        const provider = new Provider(issuer, {
          adapter: OidcAdapterFactory.getAdapterFactory(),
          jwks: { keys: [jwk] },
          clients: [
            {
              client_id: "client",
              client_secret: "test-secret-value",
              redirect_uris: [`${issuer}/callback`],
              response_types: ["code"],
              grant_types: ["authorization_code"],
              token_endpoint_auth_method: "client_secret_basic",
            },
          ],
          features: { devInteractions: { enabled: false } },
          findAccount: async (_ctx, accountId) => {
            entered();
            if (revoke) await accountGate;
            return { accountId, claims: async () => ({ sub: accountId }) };
          },
        });
        server.on("request", provider.callback());
        const grant = new provider.Grant({ accountId: "victim", clientId: "client" });
        grant.addOIDCScope("openid");
        const grantId = await grant.save();
        const code = await new provider.AuthorizationCode({
          accountId: "victim",
          clientId: "client",
          grantId,
          redirectUri: `${issuer}/callback`,
          scope: "openid",
          authTime: Math.floor(Date.now() / 1000),
        }).save();
        const exchange = fetch(`${issuer}/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from("client:test-secret-value").toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: `${issuer}/callback`,
          }),
        });
        await accountEntered;
        if (revoke) {
          const lease = await OidcAdapterFactory.acquireAccountIdBlock("victim");
          await lease.commit();
          await OidcAdapterFactory.revokeByAccountId("victim");
          await OidcAdapterFactory.allowAccountId("victim");
          expect(await provider.Grant.find(grantId)).toBeUndefined();
          resume();
        }
        const response = await exchange;
        const body = (await response.json()) as Record<string, unknown>;
        if (revoke) {
          expect(response.status).not.toBe(200);
          expect(body).not.toHaveProperty("access_token");
          expect(body).not.toHaveProperty("id_token");
        } else {
          expect(response.status).toBe(200);
          expect(body.access_token).toEqual(expect.any(String));
          expect(body.id_token).toEqual(expect.any(String));
        }
      }, 15_000);
    }
  });
}
