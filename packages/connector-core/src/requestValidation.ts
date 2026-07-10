import { connectorError } from "./errors.js";

const MAXIMUM_REQUEST_URL_LENGTH = 8_192;
const ENCODED_UNSAFE_PATH_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/iu;

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });

const isUnsafeLocalReturnTo = (value: string): boolean =>
  value.length === 0 ||
  value.length > 2_048 ||
  !value.startsWith("/") ||
  value.startsWith("//") ||
  value.includes("\\") ||
  value.includes("#") ||
  hasControlCharacters(value) ||
  ENCODED_UNSAFE_PATH_PATTERN.test(value);

export const validateLocalReturnTo = (value: string): string => {
  if (isUnsafeLocalReturnTo(value)) {
    throw connectorError("INVALID_REQUEST");
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "https://return-to.invalid");
  } catch {
    throw connectorError("INVALID_REQUEST");
  }
  const normalized = `${parsed.pathname}${parsed.search}`;
  if (
    parsed.origin !== "https://return-to.invalid" ||
    parsed.hash ||
    isUnsafeLocalReturnTo(normalized)
  ) {
    throw connectorError("INVALID_REQUEST");
  }
  return normalized;
};

export const extractRequestQuery = (requestUrl: string, expectedPath: string): string => {
  if (
    requestUrl.length === 0 ||
    requestUrl.length > MAXIMUM_REQUEST_URL_LENGTH ||
    !requestUrl.startsWith("/") ||
    requestUrl.startsWith("//") ||
    requestUrl.includes("#") ||
    hasControlCharacters(requestUrl)
  ) {
    throw connectorError("INVALID_REQUEST");
  }
  const queryIndex = requestUrl.indexOf("?");
  const path = queryIndex < 0 ? requestUrl : requestUrl.slice(0, queryIndex);
  if (path !== expectedPath) {
    throw connectorError("INVALID_REQUEST");
  }
  return queryIndex < 0 ? "" : requestUrl.slice(queryIndex + 1);
};

export const parseLoginReturnTo = (requestUrl: string, loginPath: string): string => {
  const query = extractRequestQuery(requestUrl, loginPath);
  const parameters = new URLSearchParams(query);
  if (
    [...parameters.keys()].some((key) => key !== "returnTo") ||
    parameters.getAll("returnTo").length > 1
  ) {
    throw connectorError("INVALID_REQUEST");
  }
  return validateLocalReturnTo(parameters.get("returnTo") ?? "/");
};

export const validateRequestOrigin = (
  originHeader: string | readonly string[] | undefined,
  expectedOrigin: string,
): void => {
  if (typeof originHeader !== "string" || originHeader !== expectedOrigin) {
    throw connectorError("CSRF_REJECTED");
  }
  try {
    const parsed = new URL(originHeader);
    if (parsed.origin !== expectedOrigin || parsed.href !== `${expectedOrigin}/`) {
      throw connectorError("CSRF_REJECTED");
    }
  } catch {
    throw connectorError("CSRF_REJECTED");
  }
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) <= 255)
  );
};

export const validateExternalRedirect = (value: string): string => {
  if (
    value.length === 0 ||
    value.length > MAXIMUM_REQUEST_URL_LENGTH ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))
  ) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  return url.href;
};
