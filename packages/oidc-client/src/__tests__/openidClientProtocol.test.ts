import { ResponseBodyError } from "openid-client";
import { describe, expect, it } from "vitest";
import {
  classifyOpenIdClientFailure,
  validateLoopbackServerMetadata,
} from "../internal/testing.js";

describe("loopback discovery metadata", () => {
  it("accepts only endpoint URLs on the exact loopback origin", () => {
    expect(() =>
      validateLoopbackServerMetadata(new URL("http://127.0.0.1:3000"), {
        issuer: "http://127.0.0.1:3000",
        authorization_endpoint: "http://127.0.0.1:3000/authorize",
        token_endpoint: "http://127.0.0.1:3000/token",
        jwks_uri: "http://127.0.0.1:3000/jwks",
        revocation_endpoint: "http://127.0.0.1:3000/revoke",
        end_session_endpoint: "http://127.0.0.1:3000/logout",
      }),
    ).not.toThrow();
  });

  it.each([
    ["remote HTTP", "http://internal.example/token"],
    ["another loopback port", "http://127.0.0.1:4000/token"],
    ["another loopback spelling", "http://localhost:3000/token"],
    ["HTTPS cross-origin", "https://tokens.example.com/token"],
  ])("rejects %s endpoint metadata", (_name, tokenEndpoint) => {
    expect(() =>
      validateLoopbackServerMetadata(new URL("http://127.0.0.1:3000"), {
        token_endpoint: tokenEndpoint,
      }),
    ).toThrow(expect.objectContaining({ kind: "UNSAFE_METADATA" }));
  });

  it("does not impose same-origin restrictions on standards-compliant HTTPS issuers", () => {
    expect(() =>
      validateLoopbackServerMetadata(new URL("https://id.example.com"), {
        token_endpoint: "https://tokens.example.net/token",
      }),
    ).not.toThrow();
  });
});

describe("openid-client error classification", () => {
  it("maps invalid_grant without retaining the upstream description or response", () => {
    const upstream = new ResponseBodyError("upstream secret", {
      cause: {
        error: "invalid_grant",
        error_description: "refresh_token=must-never-leak",
      },
      response: new Response("{}", { status: 400 }),
    });

    const classified = classifyOpenIdClientFailure(upstream);

    expect(classified).toMatchObject({ kind: "INVALID_GRANT", message: "OIDC grant 已失效" });
    expect(classified.cause).toBeUndefined();
    expect(JSON.stringify(classified)).not.toContain("must-never-leak");
  });
});
