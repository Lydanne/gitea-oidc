import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import { registerAdminRoutes } from "../adminRoutes.js";
import { registerPortalRoutes } from "../portalRoutes.js";

const publicDir = fileURLToPath(new URL("../../../public", import.meta.url));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.unstubAllGlobals();
});

function register(
  distributed: boolean,
  credentials = { client_id: "admin-client", client_secret: "secret" },
) {
  const app = Fastify();
  const groups = [{ id: "x-oidc-admins", name: "管理员" }];
  const users = new Map<string, any>([
    ["actor", { sub: "actor", username: "actor", groups, status: "active" }],
    ["victim", { sub: "victim", username: "victim", groups, status: "active" }],
  ]);
  const repository = {
    findById: vi.fn(async (id: string) => users.get(id) ?? null),
    update: vi.fn(async (id: string, value: any) => {
      const user = { ...users.get(id), ...value };
      users.set(id, user);
      return user;
    }),
    delete: vi.fn(async (id: string) => {
      users.delete(id);
    }),
    create: vi.fn(async (value: any) => {
      const user = { ...value, sub: "victim", groups, status: "active" };
      users.set("victim", user);
      return user;
    }),
  };
  const config = {
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
    auth: { stateStore: { type: distributed ? "redis" : "memory" } },
    server: { url: "http://localhost:3000" },
    oidc: { issuer: "http://localhost:3000/oidc" },
    clients: [
      {
        ...credentials,
        redirect_uris: ["http://localhost:3000/admin/callback"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_basic",
      },
      {
        client_id: "portal-client",
        client_secret: "secret",
        redirect_uris: ["http://localhost:3000/portal/callback"],
        post_logout_redirect_uris: ["http://localhost:3000/portal/signed-out"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_basic",
      },
    ],
  };
  const oidcProvider = {
    AccessToken: {
      find: vi.fn(async (token: string) => ({
        accountId: "victim",
        clientId: token === "portal-token" ? "portal-client" : credentials.client_id,
        grantId: token,
        kind: "AccessToken",
        destroy: vi.fn(),
      })),
    },
    Grant: {
      find: vi.fn(async (grantId: string) => ({
        accountId: "victim",
        clientId: grantId === "portal-token" ? "portal-client" : credentials.client_id,
      })),
    },
    Client: { find: vi.fn(async (clientId: string) => ({ clientId })) },
  };
  const stateStore = new MemoryStateStore();
  const admin = registerAdminRoutes({
    app,
    config: config as any,
    oidcProvider: oidcProvider as any,
    authCoordinator: { getProviders: () => [] } as any,
    userRepository: repository as any,
    publicDir,
    stateStore,
    oidcAccountLifecycle: {
      acquireBlock: async () => ({ accountId: "victim", commit: vi.fn(), release: vi.fn() }),
      revoke: vi.fn(),
      allow: vi.fn(),
    },
  })!;
  const portal = registerPortalRoutes({
    app,
    config: config as any,
    oidcProvider: oidcProvider as any,
    userRepository: repository as any,
    publicDir,
    stateStore,
    listPortalApplications: () => [] as any,
  })!;
  cleanup.push(async () => {
    await app.close();
    stateStore.destroy();
  });
  return { app, admin, portal };
}

for (const distributed of [false, true]) {
  describe(`${distributed ? "共享" : "内存"} BFF 真实路由撤销`, () => {
    for (const lifecycle of ["disable-enable", "delete-recreate"] as const) {
      it(`${lifecycle} 后未再次访问过的后台与门户旧 cookie 仍失效`, async () => {
        const { app, admin, portal } = register(distributed);
        const actor = await admin.createSession("actor");
        const oldAdmin = await admin.createSession("victim");
        const oldPortal = await portal.createSession("victim");
        const headers = {
          cookie: `x_oidc_admin_session=${actor.id}`,
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-oidc-admin-action": "1",
        };
        if (lifecycle === "disable-enable") {
          expect(
            (
              await app.inject({
                method: "PATCH",
                url: "/admin/api/users/victim",
                headers,
                payload: { status: "disabled" },
              })
            ).statusCode,
          ).toBe(200);
          expect(
            (
              await app.inject({
                method: "PATCH",
                url: "/admin/api/users/victim",
                headers,
                payload: { status: "active" },
              })
            ).statusCode,
          ).toBe(200);
        } else {
          expect(
            (
              await app.inject({
                method: "DELETE",
                url: "/admin/api/users/victim",
                payload: {},
                headers,
              })
            ).statusCode,
          ).toBe(204);
          expect(
            (
              await app.inject({
                method: "POST",
                url: "/admin/api/users",
                headers,
                payload: { username: "victim", authProvider: "local", externalId: "victim" },
              })
            ).statusCode,
          ).toBe(201);
        }
        expect(
          (
            await app.inject({
              url: "/admin/api/me",
              headers: { cookie: `x_oidc_admin_session=${oldAdmin.id}` },
            })
          ).statusCode,
        ).toBe(401);
        expect(
          (
            await app.inject({
              url: "/portal/api/me",
              headers: { cookie: `x_oidc_portal_session=${oldPortal.id}` },
            })
          ).statusCode,
        ).toBe(401);
        const fresh = await portal.createSession("victim");
        expect(
          (
            await app.inject({
              url: "/portal/api/me",
              headers: { cookie: `x_oidc_portal_session=${fresh.id}` },
            })
          ).statusCode,
        ).toBe(200);
      });
    }

    for (const surface of ["admin", "portal"] as const) {
      it(`${surface} callback 在交换令牌期间被撤销重建时不签发新 cookie`, async () => {
        const { app, admin, portal } = register(distributed);
        const actor = await admin.createSession("actor");
        const binding = "a".repeat(64);
        const bindingHash = createHash("sha256").update(binding).digest("hex");
        const state =
          surface === "admin"
            ? await admin.createLoginState("/admin/users", bindingHash)
            : await portal.createLoginState("/portal", bindingHash, "b".repeat(64));
        let started!: () => void;
        let complete!: () => void;
        const exchangeStarted = new Promise<void>((resolve) => {
          started = resolve;
        });
        const exchange = new Promise<void>((resolve) => {
          complete = resolve;
        });
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            started();
            await exchange;
            return { ok: true, json: async () => ({ access_token: `${surface}-token` }) };
          }),
        );
        const pending = app.inject({
          url: `/${surface}/callback?code=old-code&state=${state}`,
          headers: { cookie: `x_oidc_${surface}_login=${binding}` },
        });
        const responsePromise = Promise.resolve(pending);
        await exchangeStarted;
        const headers = {
          cookie: `x_oidc_admin_session=${actor.id}`,
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-oidc-admin-action": "1",
        };
        expect(
          (
            await app.inject({
              method: "DELETE",
              url: "/admin/api/users/victim",
              payload: {},
              headers,
            })
          ).statusCode,
        ).toBe(204);
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/admin/api/users",
              headers,
              payload: { username: "victim", authProvider: "local", externalId: "victim" },
            })
          ).statusCode,
        ).toBe(201);
        complete();
        const response = await responsePromise;
        expect(response.statusCode).toBe(403);
        expect(String(response.headers["set-cookie"])).not.toContain(`x_oidc_${surface}_session=`);
      });
    }
  });
}

it("后台 Basic 认证对加号、百分号、冒号、空格和 Unicode 分别进行表单编码", async () => {
  const credentials = { client_id: "gitea+%: 登录", client_secret: "s+%: 密钥" };
  const { app, admin } = register(false, credentials);
  const binding = "a".repeat(64);
  const state = await admin.createLoginState(
    "/admin/users",
    createHash("sha256").update(binding).digest("hex"),
  );
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ access_token: "admin-token" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const response = await app.inject({
    url: `/admin/callback?code=code&state=${state}`,
    headers: { cookie: `x_oidc_admin_login=${binding}` },
  });
  expect(response.statusCode).toBe(302);
  const request = fetchMock.mock.calls[0] as unknown as [
    string,
    { headers: { Authorization: string } },
  ];
  expect(
    Buffer.from(request[1].headers.Authorization.slice("Basic ".length), "base64").toString(),
  ).toBe("gitea%2B%25%3A+%E7%99%BB%E5%BD%95:s%2B%25%3A+%E5%AF%86%E9%92%A5");
});
