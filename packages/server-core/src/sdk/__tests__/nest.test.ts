import { afterEach, describe, expect, it, vi } from "vitest";
import { createXOidcNestGuard, getXOidcUser } from "../nest.js";

describe("createXOidcNestGuard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createContext = (request: any) => ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  });

  it("returns true and attaches user when token is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sub: "user-1" }),
      }),
    );
    const Guard = createXOidcNestGuard({
      userInfoEndpoint: "https://id.example.com/oidc/me",
    });
    const request = { headers: { authorization: "Bearer token" } };

    const result = await new Guard().canActivate(createContext(request));

    expect(result).toBe(true);
    expect(getXOidcUser(request)).toEqual({ sub: "user-1" });
  });

  it("returns false when token is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const Guard = createXOidcNestGuard({
      userInfoEndpoint: "https://id.example.com/oidc/me",
    });

    const result = await new Guard().canActivate(
      createContext({ headers: { authorization: "Bearer bad" } }),
    );

    expect(result).toBe(false);
  });
});
