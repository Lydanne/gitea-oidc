import { afterEach, describe, expect, it, vi } from "vitest";
import { createXOidcExpressMiddleware } from "../express.js";

describe("createXOidcExpressMiddleware", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("校验资源令牌后把可信 claims 放入请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        active: true,
        sub: "user-1",
        name: "User One",
        iss: "https://id.example.com/oidc",
        aud: "https://api.example.com",
        exp: Math.floor(Date.now() / 1000) + 60,
        token_type: "Bearer",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = { headers: { authorization: "Bearer token" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const middleware = createXOidcExpressMiddleware({
      issuer: "https://id.example.com/oidc",
      audience: "https://api.example.com",
      introspectionEndpoint: "https://id.example.com/oidc/token/introspection",
      clientId: "resource-server",
      clientSecret: "test-resource-secret",
    });

    await middleware(req, res, next);

    expect(req).toMatchObject({ user: { sub: "user-1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://id.example.com/oidc/token/introspection",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const middleware = createXOidcExpressMiddleware({
      issuer: "https://id.example.com/oidc",
      audience: "https://api.example.com",
      introspectionEndpoint: "https://id.example.com/oidc/token/introspection",
      clientId: "resource-server",
      clientSecret: "test-resource-secret",
    });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid access token" });
    expect(next).not.toHaveBeenCalled();
  });
});
