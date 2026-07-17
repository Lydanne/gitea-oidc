import { connectorError } from "./errors.js";
import {
  type ConnectorCookieConfiguration,
  type ConnectorCookieNames,
  OIDC_CALLBACK_PATH,
} from "./types.js";

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/u;
const COOKIE_NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;
const OPAQUE_COOKIE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const MAXIMUM_COOKIE_HEADER_LENGTH = 16_384;
const MAXIMUM_COOKIE_PAIRS = 128;
const MAXIMUM_COOKIE_AGE_SECONDS = 30 * 24 * 60 * 60;
const HOST_COOKIE_PREFIX = "__host-";
const SECURE_COOKIE_PREFIX = "__secure-";

export type UniqueCookieResult =
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" }
  | { readonly kind: "value"; readonly value: string };

const validateCookieName = (name: string): string => {
  if (typeof name !== "string" || !COOKIE_NAME_PATTERN.test(name)) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }
  return name;
};

const startsWithAsciiCaseInsensitive = (value: string, prefix: string): boolean => {
  if (value.length < prefix.length) {
    return false;
  }
  for (let index = 0; index < prefix.length; index += 1) {
    const valueCode = value.charCodeAt(index);
    const prefixCode = prefix.charCodeAt(index);
    const normalizedValueCode = valueCode >= 65 && valueCode <= 90 ? valueCode + 32 : valueCode;
    const normalizedPrefixCode =
      prefixCode >= 65 && prefixCode <= 90 ? prefixCode + 32 : prefixCode;
    if (normalizedValueCode !== normalizedPrefixCode) {
      return false;
    }
  }
  return true;
};

const hasHostCookiePrefix = (name: string): boolean =>
  startsWithAsciiCaseInsensitive(name, HOST_COOKIE_PREFIX);

const hasSecureCookiePrefix = (name: string): boolean =>
  startsWithAsciiCaseInsensitive(name, SECURE_COOKIE_PREFIX);

export const createCookieConfiguration = (
  secure: boolean,
  names: ConnectorCookieNames = {},
  namespace = "default",
): ConnectorCookieConfiguration => {
  if (
    typeof secure !== "boolean" ||
    !names ||
    typeof names !== "object" ||
    Array.isArray(names) ||
    !COOKIE_NAMESPACE_PATTERN.test(namespace)
  ) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }
  const transactionName = validateCookieName(
    names.transaction ??
      (secure ? `__Host-x_oidc_transaction_${namespace}` : `x_oidc_transaction_${namespace}`),
  );
  const sessionName = validateCookieName(
    names.session ??
      (secure ? `__Host-x_oidc_session_${namespace}` : `x_oidc_session_${namespace}`),
  );
  const transactionHasHostPrefix = hasHostCookiePrefix(transactionName);
  const sessionHasHostPrefix = hasHostCookiePrefix(sessionName);
  if (
    transactionName === sessionName ||
    (secure && (!transactionHasHostPrefix || !sessionHasHostPrefix)) ||
    (!secure &&
      (hasSecureCookiePrefix(transactionName) ||
        hasSecureCookiePrefix(sessionName) ||
        transactionHasHostPrefix ||
        sessionHasHostPrefix))
  ) {
    throw connectorError("INVALID_CONNECTOR_CONFIGURATION");
  }

  return Object.freeze({
    secure,
    transaction: Object.freeze({ name: transactionName, path: "/" as const }),
    session: Object.freeze({ name: sessionName, path: "/" as const }),
  });
};

export const readUniqueOpaqueCookie = (
  header: string | undefined,
  name: string,
): UniqueCookieResult => {
  if (header === undefined || header.length === 0) {
    return { kind: "missing" };
  }
  if (header.length > MAXIMUM_COOKIE_HEADER_LENGTH) {
    return { kind: "invalid" };
  }

  const parts = header.split(";");
  if (parts.length > MAXIMUM_COOKIE_PAIRS) {
    return { kind: "invalid" };
  }

  let found: string | undefined;
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    const rawValue = part.slice(separator + 1);
    const value = rawValue.trim();
    if (rawValue !== value || found !== undefined || !OPAQUE_COOKIE_VALUE_PATTERN.test(value)) {
      return { kind: "invalid" };
    }
    found = value;
  }
  return found === undefined ? { kind: "missing" } : { kind: "value", value: found };
};

interface SerializeCookieInput {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  readonly secure: boolean;
  readonly maxAgeSeconds: number;
}

export const serializeOpaqueCookie = (input: SerializeCookieInput): string => {
  validateCookieName(input.name);
  const hasHostPrefix = hasHostCookiePrefix(input.name);
  const hasSecurePrefix = hasSecureCookiePrefix(input.name);
  if (
    (input.value.length > 0 && !OPAQUE_COOKIE_VALUE_PATTERN.test(input.value)) ||
    (input.path !== "/" && input.path !== OIDC_CALLBACK_PATH) ||
    !Number.isSafeInteger(input.maxAgeSeconds) ||
    input.maxAgeSeconds < 0 ||
    input.maxAgeSeconds > MAXIMUM_COOKIE_AGE_SECONDS ||
    (hasSecurePrefix && !input.secure) ||
    (hasHostPrefix && (!input.secure || input.path !== "/"))
  ) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }

  return [
    `${input.name}=${input.value}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${input.path}`,
    `Max-Age=${input.maxAgeSeconds}`,
    ...(input.maxAgeSeconds === 0 ? ["Expires=Thu, 01 Jan 1970 00:00:00 GMT"] : []),
    ...(input.secure ? ["Secure"] : []),
  ].join("; ");
};

export const secondsUntil = (expiresAt: string, now: number): number => {
  const expiration = Date.parse(expiresAt);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(expiration) || expiration <= now) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  const seconds = Math.floor((expiration - now) / 1_000);
  if (seconds < 1 || seconds > MAXIMUM_COOKIE_AGE_SECONDS) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  return seconds;
};
