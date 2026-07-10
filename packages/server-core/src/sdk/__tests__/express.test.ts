import { afterEach, describe, expect, it, vi } from "vitest";
import { createGiteaOidcExpressMiddleware } from "../express.js";

describe("createGiteaOidcExpressMiddleware", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads userinfo and attaches it to the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ sub: "user-1", name: "User One" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = { headers: { authorization: "Bearer token" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const middleware = createGiteaOidcExpressMiddleware({
      userInfoEndpoint: "https://id.example.com/oidc/me",
    });

    await middleware(req, res, next);

    expect(req).toMatchObject({ user: { sub: "user-1" } });
    expect(fetchMock).toHaveBeenCalledWith("https://id.example.com/oidc/me", {
      headers: { Authorization: "Bearer token" },
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const middleware = createGiteaOidcExpressMiddleware({
      userInfoEndpoint: "https://id.example.com/oidc/me",
    });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing Authorization header" });
    expect(next).not.toHaveBeenCalled();
  });
});
