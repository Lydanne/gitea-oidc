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
      vi.fn().mockResolvedValue(
        Response.json({
          active: true,
          sub: "user-1",
          iss: "https://id.example.com/oidc",
          aud: "https://api.example.com",
          exp: Math.floor(Date.now() / 1000) + 60,
          token_type: "Bearer",
        }),
      ),
    );
    const Guard = createXOidcNestGuard({
      issuer: "https://id.example.com/oidc",
      audience: "https://api.example.com",
      introspectionEndpoint: "https://id.example.com/oidc/token/introspection",
      clientId: "resource-server",
      clientSecret: "test-resource-secret",
    });
    const request = { headers: { authorization: "Bearer token" } };

    const result = await new Guard().canActivate(createContext(request));

    expect(result).toBe(true);
    expect(getXOidcUser(request)).toMatchObject({ sub: "user-1" });
  });

  it("returns false when token is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const Guard = createXOidcNestGuard({
      issuer: "https://id.example.com/oidc",
      audience: "https://api.example.com",
      introspectionEndpoint: "https://id.example.com/oidc/token/introspection",
      clientId: "resource-server",
      clientSecret: "test-resource-secret",
    });

    const result = await new Guard().canActivate(
      createContext({ headers: { authorization: "Bearer bad" } }),
    );

    expect(result).toBe(false);
  });
});
