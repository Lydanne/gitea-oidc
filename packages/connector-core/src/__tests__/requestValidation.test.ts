import { describe, expect, it } from "vitest";
import {
  extractRequestQuery,
  parseLoginReturnTo,
  validateExternalRedirect,
  validateLocalReturnTo,
  validateRequestOrigin,
} from "../index.js";

describe("connector request validation", () => {
  it("accepts only a single local returnTo query", () => {
    expect(parseLoginReturnTo("/oidc/login?returnTo=%2Fdashboard%3Ftab%3Done", "/oidc/login")).toBe(
      "/dashboard?tab=one",
    );
    expect(parseLoginReturnTo("/oidc/login", "/oidc/login")).toBe("/");
    expect(() => parseLoginReturnTo("/oidc/login?scope=admin", "/oidc/login")).toThrow();
    expect(() =>
      parseLoginReturnTo("/oidc/login?returnTo=%2Fa&returnTo=%2Fb", "/oidc/login"),
    ).toThrow();
  });

  it.each([
    "https://evil.example.com",
    "//evil.example.com",
    "/%2f%2fevil.example.com",
    "/..//evil.example",
    "/%2e%2e//evil.example",
    "/path#fragment",
    "/path\\evil",
  ])("rejects unsafe returnTo %s", (value) => {
    expect(() => validateLocalReturnTo(value)).toThrow();
  });

  it("extracts only query data from an exact origin-form callback path", () => {
    expect(extractRequestQuery("/oidc/callback?code=one&state=two", "/oidc/callback")).toBe(
      "code=one&state=two",
    );
    expect(() =>
      extractRequestQuery("https://evil.example.com/oidc/callback?code=one", "/oidc/callback"),
    ).toThrow();
    expect(() => extractRequestQuery("/other?code=one", "/oidc/callback")).toThrow();
  });

  it("requires an exact configured Origin for logout", () => {
    expect(() =>
      validateRequestOrigin("https://app.example.com", "https://app.example.com"),
    ).not.toThrow();
    expect(() => validateRequestOrigin(undefined, "https://app.example.com")).toThrow();
    expect(() =>
      validateRequestOrigin("https://sub.app.example.com", "https://app.example.com"),
    ).toThrow();
    expect(() =>
      validateRequestOrigin(["https://app.example.com"], "https://app.example.com"),
    ).toThrow();
  });

  it("never treats a lookalike hostname as loopback", () => {
    expect(validateExternalRedirect("http://127.0.0.1:3000/next")).toBe(
      "http://127.0.0.1:3000/next",
    );
    expect(() => validateExternalRedirect("http://127.evil.example.com/next")).toThrow();
    expect(() => validateExternalRedirect("javascript:alert(1)")).toThrow();
    expect(() => validateExternalRedirect("\nhttps://id.example.com/authorize")).toThrow();
  });
});
