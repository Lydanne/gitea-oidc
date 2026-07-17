import { describe, expect, it } from "vitest";
import {
  createCookieConfiguration,
  OIDC_CALLBACK_PATH,
  readUniqueOpaqueCookie,
  secondsUntil,
  serializeOpaqueCookie,
} from "../index.js";

const OPAQUE = "a".repeat(43);
const COOKIE_PREFIX_CASES = [
  { label: "canonical", host: "__Host-", secure: "__Secure-" },
  { label: "lowercase", host: "__host-", secure: "__secure-" },
  { label: "uppercase", host: "__HOST-", secure: "__SECURE-" },
  { label: "mixed case", host: "__HoSt-", secure: "__SeCuRe-" },
] as const;

describe("connector cookies", () => {
  it("uses namespaced host-only secure defaults for both cookies", () => {
    const configuration = createCookieConfiguration(true);
    const transaction = serializeOpaqueCookie({
      name: configuration.transaction.name,
      value: OPAQUE,
      path: configuration.transaction.path,
      secure: configuration.secure,
      maxAgeSeconds: 600,
    });
    const session = serializeOpaqueCookie({
      name: configuration.session.name,
      value: OPAQUE,
      path: configuration.session.path,
      secure: configuration.secure,
      maxAgeSeconds: 3_600,
    });

    expect(configuration).toEqual({
      secure: true,
      transaction: {
        name: "__Host-x_oidc_transaction_default",
        path: "/",
      },
      session: { name: "__Host-x_oidc_session_default", path: "/" },
    });
    expect(transaction).toContain("HttpOnly");
    expect(transaction).toContain("SameSite=Lax");
    expect(transaction).toContain("Path=/;");
    expect(transaction).toContain("Secure");
    expect(transaction).not.toContain("Domain=");
    expect(session).toContain("Path=/;");
    expect(() =>
      createCookieConfiguration(true, { transaction: "__Secure-x_oidc_transaction" }),
    ).toThrow();
    expect(
      createCookieConfiguration(
        true,
        {
          transaction: "__Host-custom_transaction",
          session: "__Host-custom_session",
        },
        "app_01",
      ).transaction.name,
    ).toBe("__Host-custom_transaction");
  });

  it("allows non-Secure cookies only for an explicitly non-HTTPS connector", () => {
    const configuration = createCookieConfiguration(false);
    const header = serializeOpaqueCookie({
      name: configuration.session.name,
      value: OPAQUE,
      path: "/",
      secure: false,
      maxAgeSeconds: 60,
    });

    expect(configuration.session.name).toBe("x_oidc_session_default");
    expect(header).not.toContain("Secure");
    expect(() => createCookieConfiguration(false, { transaction: "__Host-transaction" })).toThrow();
    expect(() => createCookieConfiguration(false, { session: "__Host-session" })).toThrow();
    expect(() => createCookieConfiguration(false, null as never)).toThrow();
    expect(() => createCookieConfiguration(undefined as never)).toThrow();
    expect(() => createCookieConfiguration(true, {}, "invalid namespace")).toThrow();
  });

  it.each(
    COOKIE_PREFIX_CASES,
  )("enforces cookie configuration rules for $label security prefixes", ({ host, secure }) => {
    const configuration = createCookieConfiguration(true, {
      transaction: `${host}transaction`,
      session: `${host}session`,
    });

    expect(configuration.transaction.name).toBe(`${host}transaction`);
    expect(configuration.session.name).toBe(`${host}session`);
    for (const field of ["transaction", "session"] as const) {
      const hostNames =
        field === "transaction"
          ? { transaction: `${host}transaction` }
          : { session: `${host}session` };
      const secureNames =
        field === "transaction"
          ? { transaction: `${secure}transaction` }
          : { session: `${secure}session` };

      expect(() => createCookieConfiguration(false, hostNames)).toThrowError(
        expect.objectContaining({ code: "INVALID_CONNECTOR_CONFIGURATION" }),
      );
      expect(() => createCookieConfiguration(false, secureNames)).toThrowError(
        expect.objectContaining({ code: "INVALID_CONNECTOR_CONFIGURATION" }),
      );
      expect(() => createCookieConfiguration(true, secureNames)).toThrowError(
        expect.objectContaining({ code: "INVALID_CONNECTOR_CONFIGURATION" }),
      );
    }
  });

  it.each(COOKIE_PREFIX_CASES)("enforces serialization rules for $label security prefixes", ({
    host,
    secure,
  }) => {
    const hostName = `${host}transaction`;
    const secureName = `${secure}transaction`;
    const serialize = (name: string, isSecure: boolean, path: "/" | typeof OIDC_CALLBACK_PATH) =>
      serializeOpaqueCookie({
        name,
        value: OPAQUE,
        path,
        secure: isSecure,
        maxAgeSeconds: 60,
      });

    expect(() => serialize(hostName, false, "/")).toThrowError(
      expect.objectContaining({ code: "INVALID_CLIENT_RESPONSE" }),
    );
    expect(() => serialize(hostName, true, OIDC_CALLBACK_PATH)).toThrowError(
      expect.objectContaining({ code: "INVALID_CLIENT_RESPONSE" }),
    );
    expect(() => serialize(secureName, false, "/")).toThrowError(
      expect.objectContaining({ code: "INVALID_CLIENT_RESPONSE" }),
    );

    const hostHeader = serialize(hostName, true, "/");
    const secureHeader = serialize(secureName, true, OIDC_CALLBACK_PATH);
    expect(hostHeader).toContain("Path=/;");
    expect(hostHeader).toContain("Secure");
    expect(hostHeader).not.toContain("Domain=");
    expect(secureHeader).toContain(`Path=${OIDC_CALLBACK_PATH};`);
    expect(secureHeader).toContain("Secure");
    expect(secureHeader).not.toContain("Domain=");
  });

  it("rejects duplicate, padded and malformed target cookie values", () => {
    const name = "x_oidc_session";

    expect(readUniqueOpaqueCookie(undefined, name)).toEqual({ kind: "missing" });
    expect(readUniqueOpaqueCookie(`other=x; ${name}=${OPAQUE}`, name)).toEqual({
      kind: "value",
      value: OPAQUE,
    });
    expect(readUniqueOpaqueCookie(`${name}=${OPAQUE}; ${name}=${OPAQUE}`, name)).toEqual({
      kind: "invalid",
    });
    expect(readUniqueOpaqueCookie(`${name}= ${OPAQUE}`, name)).toEqual({ kind: "invalid" });
    expect(readUniqueOpaqueCookie(`${name}=short`, name)).toEqual({ kind: "invalid" });
  });

  it("clears cookies with matching attributes and an epoch expiry", () => {
    const header = serializeOpaqueCookie({
      name: "__Host-x_oidc_session",
      value: "",
      path: "/",
      secure: true,
      maxAgeSeconds: 0,
    });

    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(header).toContain("Secure");
  });

  it("derives a bounded cookie age from an absolute expiration", () => {
    const now = Date.parse("2026-07-10T08:00:00.000Z");

    expect(secondsUntil("2026-07-10T08:10:00.000Z", now)).toBe(600);
    expect(() => secondsUntil("2026-07-10T07:59:59.000Z", now)).toThrow();
    expect(() => secondsUntil("invalid", now)).toThrow();
  });
});
