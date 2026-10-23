import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair } from "jose";
import Provider from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OidcAdapterFactory } from "../../adapters/OidcAdapterFactory.js";
import type { XOidcBearerOptions } from "../bearer.js";
import { createXOidcExpressMiddleware } from "../express.js";
import { createXOidcNestGuard } from "../nest.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function createCheck(kind: "Express" | "Nest", options: XOidcBearerOptions) {
  if (kind === "Nest") {
    const Guard = createXOidcNestGuard(options);
    return async (token: string) => {
      const request: any = { headers: { authorization: `Bearer ${token}` } };
      const allowed = await new Guard().canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      });
      expect(request.user?.sub).toBe(allowed ? "user-1" : undefined);
      return allowed;
    };
  }
  const middleware = createXOidcExpressMiddleware(options);
  return async (token: string) => {
    const request: any = { headers: { authorization: `Bearer ${token}` } };
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await middleware(request, res, next);
    const allowed = next.mock.calls.length === 1;
    expect(request.user?.sub).toBe(allowed ? "user-1" : undefined);
    if (!allowed) expect(res.status).toHaveBeenCalledWith(401);
    return allowed;
  };
}

describe("旧 SDK 与真实 OIDC introspection 集成", () => {
  let server: Server;
  let provider: Provider;
  let options: XOidcBearerOptions;
  beforeAll(async () => {
    OidcAdapterFactory.configure({ type: "sqlite", sqlite: { dbPath: ":memory:" } });
    server = createServer();
    const issuer = await listen(server);
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    provider = new Provider(issuer, {
      adapter: OidcAdapterFactory.getAdapterFactory(),
      jwks: {
        keys: [{ ...(await exportJWK(privateKey)), kid: "test-key", alg: "RS256", use: "sig" }],
      },
      clients: ["resource-server", "other-app"].map((client_id) => ({
        client_id,
        client_secret: "test-only-resource-secret",
        redirect_uris: [`${issuer}/callback`],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
      })),
      cookies: { keys: ["test-only-cookie-key"] },
      features: {
        devInteractions: { enabled: false },
        introspection: { enabled: true, allowedPolicy: async () => true },
      },
      findAccount: async (_ctx, accountId) => ({
        accountId,
        claims: async () => ({ sub: accountId }),
      }),
    });
    server.on("request", provider.callback());
    options = {
      issuer,
      audience: "https://api.example.com",
      introspectionEndpoint: `${issuer}/token/introspection`,
      clientId: "resource-server",
      clientSecret: "test-only-resource-secret",
      requiredScopes: ["read:items"],
    };
  });
  afterAll(async () => {
    if (server) await close(server);
    await OidcAdapterFactory.cleanup();
  });

  async function issue(aud: string | undefined, clientId = "other-app", refresh = false) {
    const grant = new provider.Grant({ accountId: "user-1", clientId });
    grant.addOIDCScope("openid offline_access read:items");
    const grantId = await grant.save();
    // 由真实 AS 持久化资源授权后的令牌；不依赖自行伪造 introspection 响应。
    const Model = refresh ? provider.RefreshToken : provider.AccessToken;
    const model = new Model({
      accountId: "user-1",
      clientId,
      grantId,
      scope: "openid read:items",
      aud,
    });
    const token = await model.save();
    return { model, token };
  }

  for (const kind of ["Express", "Nest"] as const) {
    it(`${kind} 接受发给自身资源的 opaque token，即使签发客户端不同`, async () => {
      const { token } = await issue(options.audience);
      expect(await createCheck(kind, options)(token)).toBe(true);
    });
    it(`${kind} 拒绝其他资源的令牌，即使签发客户端与本资源客户端相同`, async () => {
      const { token } = await issue("https://another-api.example.com", options.clientId);
      expect(await createCheck(kind, options)(token)).toBe(false);
    });
    it(`${kind} 旧 UserInfo token 不能通过受众校验`, async () => {
      const { token } = await issue(undefined);
      const userinfo = await fetch(`${options.issuer}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(userinfo.status).toBe(200);
      expect(await createCheck(kind, options)(token)).toBe(false);
    });
    it(`${kind} 撤销立即生效且不会缓存旧 introspection 结果`, async () => {
      const { token, model } = await issue(options.audience);
      const check = createCheck(kind, options);
      expect(await check(token)).toBe(true);
      await model.destroy();
      expect(await check(token)).toBe(false);
    });
    it(`${kind} RefreshToken 不得替代访问令牌`, async () => {
      const { token } = await issue(options.audience, "other-app", true);
      expect(await createCheck(kind, options)(token)).toBe(false);
    });
    it(`${kind} 授权服务器签名的 ID Token 不能替代访问令牌`, async () => {
      const client = await provider.Client.find(options.clientId);
      const idToken = new provider.IdToken({ sub: "user-1" }, { client });
      idToken.scope = "openid";
      const token = await idToken.issue({ use: "idtoken" });
      expect(token.split(".")).toHaveLength(3);
      expect(await createCheck(kind, options)(token)).toBe(false);
    });
    it(`${kind} introspection 凭据错误时拒绝`, async () => {
      const { token } = await issue(options.audience);
      expect(
        await createCheck(kind, { ...options, clientSecret: "wrong-test-secret" })(token),
      ).toBe(false);
    });
  }
});

for (const kind of ["Express", "Nest"] as const) {
  describe(`${kind} 真实 HTTP 边界`, () => {
    it("拒绝重定向且不向目标转发资源服务器凭据和令牌", async () => {
      const leaked = vi.fn();
      const target = createServer((_req, res) => {
        leaked();
        res.end("{}");
      });
      const targetUrl = await listen(target);
      const source = createServer((_req, res) => {
        res.writeHead(307, { location: `${targetUrl}/collect` });
        res.end();
      });
      const issuer = await listen(source);
      try {
        expect(
          await createCheck(kind, {
            issuer,
            audience: "api",
            introspectionEndpoint: `${issuer}/introspection`,
            clientId: "resource-server",
            clientSecret: "test-only-secret",
          })("opaque-token"),
        ).toBe(false);
        expect(leaked).not.toHaveBeenCalled();
      } finally {
        await close(source);
        await close(target);
      }
    });
    it("响应体持续不结束仍受请求超时约束", async () => {
      const server = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"active":true,');
      });
      const issuer = await listen(server);
      try {
        expect(
          await createCheck(kind, {
            issuer,
            audience: "api",
            introspectionEndpoint: `${issuer}/introspection`,
            clientId: "resource-server",
            clientSecret: "test-only-secret",
            requestTimeoutMs: 50,
          })("opaque-token"),
        ).toBe(false);
      } finally {
        await close(server);
      }
    }, 2000);
  });
}
