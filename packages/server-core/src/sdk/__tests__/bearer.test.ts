import { afterEach, describe, expect, it, vi } from "vitest";
import type { XOidcBearerOptions } from "../bearer.js";
import { createXOidcExpressMiddleware } from "../express.js";
import { createXOidcNestGuard } from "../nest.js";

const options: XOidcBearerOptions = {
  issuer: "https://id.example.com/oidc",
  audience: "https://api.example.com",
  introspectionEndpoint: "https://id.example.com/oidc/token/introspection",
  clientId: "resource-server",
  clientSecret: "test-only-resource-secret",
  requiredScopes: ["read:items", "write:items"],
};
const validClaims = () => ({
  active: true,
  sub: "user-1",
  iss: options.issuer,
  aud: options.audience,
  exp: Math.floor(Date.now() / 1000) + 60,
  token_type: "Bearer",
  scope: "openid read:items write:items",
});

// 两种公开入口必须在相同输入下保持一致的拒绝边界。
function createRunner(kind: "Express" | "Nest", config: XOidcBearerOptions) {
  if (kind === "Nest") {
    const Guard = createXOidcNestGuard(config);
    return async (header: unknown) => {
      const request: any = { headers: { authorization: header } };
      const allowed = await new Guard().canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      });
      if (!allowed) expect(request.user).toBeUndefined();
      return { allowed, user: request.user };
    };
  }
  const middleware = createXOidcExpressMiddleware(config);
  return async (header: unknown) => {
    const request: any = { headers: { authorization: header } };
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await middleware(request, response, next);
    if (!next.mock.calls.length) {
      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.json).toHaveBeenCalledWith({ error: "Invalid access token" });
      expect(request.user).toBeUndefined();
    }
    return { allowed: next.mock.calls.length === 1, user: request.user };
  };
}

afterEach(() => vi.unstubAllGlobals());

for (const kind of ["Express", "Nest"] as const) {
  describe(`${kind} 资源受众回归`, () => {
    it.each([
      { aud: options.audience },
      { aud: ["another-resource", options.audience] },
    ])("只接受准确的资源 audience：%j", async ({ aud }) => {
      const claims = { ...validClaims(), aud, client_id: "different-issuing-client" };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(claims)));
      expect(await createRunner(kind, options)("Bearer opaque-token")).toEqual({
        allowed: true,
        user: claims,
      });
    });

    const invalidClaims: [string, Record<string, unknown>][] = [
      ["其他资源令牌即使 client_id 相同也拒绝", { aud: "other-api", client_id: options.clientId }],
      ["签发客户端不能替代资源受众", { aud: options.clientId }],
      ["缺少受众", { aud: undefined }],
      ["受众前缀匹配", { aud: `${options.audience}/evil` }],
      ["受众数组含非字符串", { aud: [options.audience, 123] }],
      ["空受众数组", { aud: [] }],
      ["令牌已撤销", { active: false }],
      ["active 字符串不能替代布尔值", { active: "true" }],
      ["错误 issuer", { iss: "https://evil.example.com/oidc" }],
      ["issuer 尾斜杠不等价", { iss: `${options.issuer}/` }],
      ["缺少 issuer", { iss: undefined }],
      ["缺少账户", { sub: undefined }],
      ["空白账户", { sub: " " }],
      ["过期令牌", { exp: 1 }],
      ["缺少有效期", { exp: undefined }],
      ["字符串有效期", { exp: "9999999999" }],
      ["未来 nbf", { nbf: 9999999999 }],
      ["未来 iat", { iat: 9999999999 }],
      ["非法 nbf", { nbf: "1" }],
      ["缺少 token_type", { token_type: undefined }],
      ["非 Bearer 令牌", { token_type: "DPoP" }],
      ["绑定证书的令牌不支持无证明调用", { cnf: { "x5t#S256": "thumbprint" } }],
      ["权限不足", { scope: "read:items" }],
      ["权限子串不能替代准确权限", { scope: "read:items write:items:all" }],
      ["缺少 scope", { scope: undefined }],
      ["scope 类型错误", { scope: ["read:items", "write:items"] }],
      ["非法 scope 分隔符", { scope: "read:items\twrite:items" }],
    ];
    it.each(invalidClaims)("拒绝%s", async (_name, patch) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ ...validClaims(), ...patch })),
      );
      expect((await createRunner(kind, options)("Bearer opaque-token")).allowed).toBe(false);
    });

    it.each([
      undefined,
      ["Bearer token"],
      "",
      "Basic token",
      "Bearer token, Bearer other",
      "Bearer token\n",
      " Bearer token",
      "Bearer token extra",
      "Bearer ",
      `Bearer ${"a".repeat(65536)}`,
    ])("非法 Authorization 不触发上游请求", async (header) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect((await createRunner(kind, options)(header)).allowed).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      { userInfoEndpoint: "https://id.example.com/oidc/me" },
      { ...options, audience: undefined },
      { ...options, audience: " " },
      { ...options, issuer: "http://id.example.com/oidc" },
      { ...options, introspectionEndpoint: "https://evil.example.com/introspect" },
      { ...options, introspectionEndpoint: "https://name:secret@id.example.com/introspect" },
      { ...options, introspectionEndpoint: "https://id.example.com/introspect?secret=value" },
      { ...options, clientSecret: "" },
      { ...options, requiredScopes: ["read write"] },
      { ...options, requiredScopes: "read" },
      { ...options, requestTimeoutMs: 0 },
      { ...options, requestTimeoutMs: 30001 },
    ])("配置错误在初始化时失败且错误不泄露凭据：%j", (config) => {
      expect(() => createRunner(kind, config as XOidcBearerOptions)).toThrow(
        "Invalid bearer token validation configuration",
      );
    });

    it("JWT 自述的受众不能绕过可信 introspection", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ active: false })));
      const jwt = `e30.${Buffer.from(JSON.stringify(validClaims())).toString("base64url")}.fake`;
      expect((await createRunner(kind, options)(`Bearer ${jwt}`)).allowed).toBe(false);
    });

    it("固定端点、Basic 凭据和表单编码不受调用者或后续配置修改控制", async () => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(validClaims()));
      vi.stubGlobal("fetch", fetchMock);
      const config = {
        ...options,
        clientId: "resource:id",
        clientSecret: "test: secret+&",
        requiredScopes: [...options.requiredScopes!],
      };
      const run = createRunner(kind, config);
      config.audience = "other";
      config.introspectionEndpoint = "https://evil.example.com";
      config.requiredScopes.push("admin");
      expect((await run("bearer opaque+/==")).allowed).toBe(true);
      const [endpoint, init] = fetchMock.mock.calls[0];
      expect(endpoint).toBe(options.introspectionEndpoint);
      expect(init.redirect).toBe("error");
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("resource%3Aid:test%3A+secret%2B%26").toString("base64")}`,
      );
      expect(init.body.get("token")).toBe("opaque+/==");
      expect(init.body.get("token_type_hint")).toBe("access_token");
    });

    it.each([
      () => new Response("not JSON"),
      () => Response.json([validClaims()]),
      () => new Response(null, { status: 204 }),
      () => Response.json(validClaims(), { status: 401 }),
      () => Response.json(validClaims(), { status: 503 }),
      () => new Response("{}", { headers: { "content-length": "65537" } }),
      () => new Response(" ".repeat(65537)),
    ])("异常或超大响应一律拒绝", async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
      expect((await createRunner(kind, options)("Bearer opaque-token")).allowed).toBe(false);
    });

    it("上游请求失败不暴露底层错误", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(options.clientSecret)));
      expect((await createRunner(kind, options)("Bearer opaque-token")).allowed).toBe(false);
    });
  });
}
