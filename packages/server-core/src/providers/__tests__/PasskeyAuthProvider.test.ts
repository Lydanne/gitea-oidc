import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryUserRepository } from "../../repositories/MemoryUserRepository.js";
import { AccountSecurity } from "../../security/AccountSecurity.js";
import { MemorySecurityRepository } from "../../security/SecurityRepository.js";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import { PasskeyAuthProvider } from "../PasskeyAuthProvider.js";

describe("Passkey 浏览器绑定入口", () => {
  let app: FastifyInstance;
  let state: MemoryStateStore;
  let flow: string;
  let cookie: string;
  beforeEach(async () => {
    app = Fastify();
    state = new MemoryStateStore();
    const security = new AccountSecurity(
      new MemorySecurityRepository(),
      state,
      new MemoryUserRepository(),
      "https://id.example.com",
    );
    const provider = new PasskeyAuthProvider(security, {
      captureAuthenticationGeneration: vi.fn().mockResolvedValue("generation"),
      assertAuthenticationGeneration: vi.fn(),
      recordAuthenticationEvent: vi.fn(),
    } as any);
    for (const route of provider.registerRoutes())
      app.route({
        method: route.method,
        url: `/auth/passkey${route.path}`,
        handler: route.handler,
      });
    app.get("/test/interaction", async (request, reply) =>
      provider.renderLoginUI({ interactionUid: "uid", request, reply } as any),
    );
    const entry = await app.inject({ url: "/test/interaction" });
    flow = new URL(entry.json().redirectUrl, "https://id.example.com").searchParams.get("flow")!;
    cookie = `${entry.cookies[0].name}=${entry.cookies[0].value}`;
  });
  afterEach(async () => {
    await app.close();
    await state.destroy();
  });
  it("仅持有正确浏览器 Cookie 和原流程才可打开登录页", async () => {
    expect((await app.inject({ url: `/auth/passkey/login?flow=${flow}` })).statusCode).toBe(400);
    const valid = await app.inject({
      url: `/auth/passkey/login?flow=${flow}`,
      headers: { cookie },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.body).toContain('id="passkey-login"');
    expect(valid.headers["cache-control"]).toBe("no-store");
    expect(
      (await app.inject({ url: "/auth/passkey/login?flow=forged", headers: { cookie } }))
        .statusCode,
    ).toBe(400);
  });
  it("挑战请求需要同源防 CSRF 头、浏览器绑定和有效流程", async () => {
    const headers = { origin: "https://id.example.com", "x-oidc-security": "1", cookie };
    const payload = { flow, username: "unknown" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/passkey/options",
          headers: { ...headers, origin: "https://attacker.example" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/passkey/options",
          headers: { ...headers, cookie: "other=browser" },
          payload,
        })
      ).statusCode,
    ).toBe(400);
    const valid = await app.inject({
      method: "POST",
      url: "/auth/passkey/options",
      headers,
      payload,
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().options.userVerification).toBe("required");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/passkey/verify",
          headers,
          payload: { flow, id: valid.json().id, response: {} },
        })
      ).statusCode,
    ).toBe(400);
  });
});
