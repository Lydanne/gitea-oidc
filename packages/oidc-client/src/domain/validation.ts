import type { ApplicationConnectionV1 } from "@x-oidc/contracts";
import { oidcError } from "./errors.js";
import type {
  AuthUserProfile,
  LoginTransaction,
  OidcIdentityClaims,
  OidcProtocolTokenSet,
  SensitiveAuthSessionRecord,
  SensitiveTokenSet,
} from "./types.js";

const OPAQUE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const ENCODED_UNSAFE_PATH_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/iu;
const MAX_URL_LENGTH = 8_192;
const MAX_TOKEN_LENGTH = 65_536;

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

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });

export const isValidOpaqueValue = (value: string): boolean => OPAQUE_VALUE_PATTERN.test(value);

const isUnsafeReturnTo = (value: string): boolean =>
  value.length === 0 ||
  value.length > 2_048 ||
  !value.startsWith("/") ||
  value.startsWith("//") ||
  value.includes("\\") ||
  value.includes("#") ||
  hasControlCharacters(value) ||
  ENCODED_UNSAFE_PATH_PATTERN.test(value);

export const validateReturnTo = (input: string): string => {
  if (isUnsafeReturnTo(input)) {
    throw oidcError("INVALID_RETURN_TO");
  }

  let parsed: URL;
  try {
    parsed = new URL(input, "https://return-to.invalid");
  } catch {
    throw oidcError("INVALID_RETURN_TO");
  }
  const normalized = `${parsed.pathname}${parsed.search}`;
  if (
    parsed.origin !== "https://return-to.invalid" ||
    parsed.hash ||
    isUnsafeReturnTo(normalized)
  ) {
    throw oidcError("INVALID_RETURN_TO");
  }
  return normalized;
};

export const selectRedirectUri = (
  connection: ApplicationConnectionV1,
  requested?: string,
): string => {
  const redirectUri = requested ?? connection.redirectUris[0];
  if (!connection.redirectUris.includes(redirectUri)) {
    throw oidcError("INVALID_REDIRECT_URI");
  }
  return redirectUri;
};

export const validatePostLogoutRedirectUri = (
  connection: ApplicationConnectionV1,
  requested?: string,
): string | undefined => {
  if (requested === undefined) {
    return undefined;
  }
  if (!connection.postLogoutRedirectUris.includes(requested)) {
    throw oidcError("INVALID_REDIRECT_URI");
  }
  return requested;
};

type CallbackParameters =
  | string
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

const parseCallbackParameters = (input: CallbackParameters): URLSearchParams => {
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input);
  }
  if (typeof input === "string") {
    if (input.length > MAX_URL_LENGTH || input.includes("#") || hasControlCharacters(input)) {
      throw oidcError("INVALID_CALLBACK");
    }
    return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw oidcError("INVALID_CALLBACK");
  }
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      parameters.append(key, value);
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      for (const item of value) {
        parameters.append(key, item);
      }
    } else if (value !== undefined) {
      throw oidcError("INVALID_CALLBACK");
    }
  }
  if (parameters.toString().length > MAX_URL_LENGTH) {
    throw oidcError("INVALID_CALLBACK");
  }
  return parameters;
};

export const buildAndValidateCallbackUrl = (
  input: CallbackParameters,
  registeredRedirectUri: string,
  expectedState: string,
): URL => {
  let registered: URL;
  try {
    registered = new URL(registeredRedirectUri);
  } catch {
    throw oidcError("INVALID_CALLBACK");
  }
  if (registered.username || registered.password || registered.hash || registered.search) {
    throw oidcError("INVALID_CALLBACK");
  }

  const parameters = parseCallbackParameters(input);
  if (parameters.toString().length > MAX_URL_LENGTH) {
    throw oidcError("INVALID_CALLBACK");
  }
  const callback = new URL(registered);
  callback.search = parameters.toString();

  const states = parameters.getAll("state");
  const codes = parameters.getAll("code");
  const errors = parameters.getAll("error");
  if (
    states.length !== 1 ||
    states[0] !== expectedState ||
    codes.length > 1 ||
    errors.length > 1 ||
    (codes.length > 0 && errors.length > 0)
  ) {
    throw oidcError("INVALID_CALLBACK");
  }
  return callback;
};

interface ExpectedAuthorizationParameters {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  resources: readonly string[];
  state: string;
  nonce: string;
}

export const validateAuthorizationUrl = (
  input: URL,
  expected?: ExpectedAuthorizationParameters,
): string => {
  const serialized = input.href;
  if (
    serialized.length > MAX_URL_LENGTH ||
    input.username ||
    input.password ||
    input.hash ||
    (input.protocol !== "https:" &&
      !(input.protocol === "http:" && isLoopbackHostname(input.hostname)))
  ) {
    throw oidcError("LOGIN_FAILED");
  }
  if (
    expected &&
    (input.searchParams.getAll("client_id").length !== 1 ||
      input.searchParams.get("client_id") !== expected.clientId ||
      input.searchParams.getAll("redirect_uri").length !== 1 ||
      input.searchParams.get("redirect_uri") !== expected.redirectUri ||
      input.searchParams.getAll("response_type").length !== 1 ||
      input.searchParams.get("response_type") !== "code" ||
      input.searchParams.getAll("scope").length !== 1 ||
      input.searchParams.get("scope") !== expected.scopes.join(" ") ||
      input.searchParams.getAll("state").length !== 1 ||
      input.searchParams.get("state") !== expected.state ||
      input.searchParams.getAll("nonce").length !== 1 ||
      input.searchParams.get("nonce") !== expected.nonce ||
      input.searchParams.getAll("code_challenge_method").length !== 1 ||
      input.searchParams.get("code_challenge_method") !== "S256" ||
      !isValidOpaqueValue(input.searchParams.get("code_challenge") ?? "") ||
      input.searchParams.getAll("resource").length !== expected.resources.length ||
      input.searchParams
        .getAll("resource")
        .some((resource, index) => resource !== expected.resources[index]))
  ) {
    throw oidcError("LOGIN_FAILED");
  }
  return serialized;
};

const selectAllowedValues = (
  requested: readonly string[] | undefined,
  allowed: readonly string[],
  requiredValue?: string,
): readonly string[] => {
  const values = requested ? [...requested] : [...allowed];
  if (
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((value) => !allowed.includes(value)) ||
    (requiredValue !== undefined && !values.includes(requiredValue))
  ) {
    throw oidcError("INVALID_LOGIN_REQUEST");
  }
  return values;
};

export const selectScopes = (
  requested: readonly string[] | undefined,
  allowed: readonly string[],
): readonly string[] => selectAllowedValues(requested, allowed, "openid");

export const selectResources = (
  requested: readonly string[] | undefined,
  allowed: readonly string[],
): readonly string[] => {
  if (requested === undefined && allowed.length === 0) {
    return [];
  }
  if (requested?.length === 0) {
    return [];
  }
  return selectAllowedValues(requested, allowed);
};

const readSafeString = (value: unknown, maximum: number): string | undefined => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    hasControlCharacters(value)
  ) {
    return undefined;
  }
  return value;
};

const readPicture = (value: unknown): string | undefined => {
  const picture = readSafeString(value, 2_048);
  if (!picture) {
    return undefined;
  }
  try {
    const url = new URL(picture);
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
};

export const toAuthUserProfile = (claims: OidcIdentityClaims): AuthUserProfile => {
  const subject = readSafeString(claims.sub, 255);
  if (!subject) {
    throw oidcError("CALLBACK_FAILED");
  }

  const groups = Array.isArray(claims.groups)
    ? [
        ...new Set(
          claims.groups
            .map((group) => readSafeString(group, 255))
            .filter((group): group is string => group !== undefined),
        ),
      ].slice(0, 100)
    : undefined;

  return {
    subject,
    name: readSafeString(claims.name, 512),
    preferredUsername: readSafeString(claims.preferred_username, 255),
    email: readSafeString(claims.email, 320),
    emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : undefined,
    picture: readPicture(claims.picture),
    groups: groups && groups.length > 0 ? groups : undefined,
  };
};

interface NormalizeTokenSetOptions {
  now: number;
  requestedScopes: readonly string[];
  claimsRequired: boolean;
  expectedSubject?: string;
}

export interface NormalizedProtocolTokens {
  subject?: string;
  user?: AuthUserProfile;
  scopes: readonly string[];
  tokens: SensitiveTokenSet;
}

const readToken = (value: unknown, required: boolean): string | undefined => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TOKEN_LENGTH ||
    hasControlCharacters(value)
  ) {
    if (required) {
      throw oidcError("CALLBACK_FAILED");
    }
    return undefined;
  }
  return value;
};

export const normalizeProtocolTokens = (
  tokenSet: OidcProtocolTokenSet,
  options: NormalizeTokenSetOptions,
): NormalizedProtocolTokens => {
  const accessToken = readToken(tokenSet.accessToken, true)!;
  if (typeof tokenSet.tokenType !== "string" || tokenSet.tokenType.toLowerCase() !== "bearer") {
    throw oidcError(options.claimsRequired ? "CALLBACK_FAILED" : "REFRESH_FAILED");
  }

  let accessTokenExpiresAt: number | undefined;
  if (tokenSet.expiresIn !== undefined) {
    if (!Number.isFinite(tokenSet.expiresIn) || tokenSet.expiresIn <= 0) {
      throw oidcError(options.claimsRequired ? "CALLBACK_FAILED" : "REFRESH_FAILED");
    }
    accessTokenExpiresAt = options.now + Math.floor(tokenSet.expiresIn * 1_000);
  }

  const scopes = tokenSet.scope
    ? tokenSet.scope.split(/\s+/u).filter((scope) => scope.length > 0)
    : [...options.requestedScopes];
  if (
    scopes.length === 0 ||
    new Set(scopes).size !== scopes.length ||
    !scopes.includes("openid") ||
    scopes.some((scope) => !options.requestedScopes.includes(scope))
  ) {
    throw oidcError(options.claimsRequired ? "CALLBACK_FAILED" : "REFRESH_FAILED");
  }

  let user: AuthUserProfile | undefined;
  if (tokenSet.claims) {
    user = toAuthUserProfile(tokenSet.claims);
    if (options.expectedSubject !== undefined && user.subject !== options.expectedSubject) {
      throw oidcError(options.claimsRequired ? "CALLBACK_FAILED" : "REFRESH_FAILED");
    }
  } else if (options.claimsRequired) {
    throw oidcError("CALLBACK_FAILED");
  }

  return {
    subject: user?.subject,
    user,
    scopes,
    tokens: {
      accessToken,
      tokenType: "Bearer",
      refreshToken: readToken(tokenSet.refreshToken, false),
      idToken: readToken(tokenSet.idToken, options.claimsRequired),
      accessTokenExpiresAt,
    },
  };
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
};

const isSafeTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const parseStoredList = (
  value: unknown,
  allowed: readonly string[],
  requiredValue?: string,
): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.length > allowed.length ||
    !value.every((item): item is string => typeof item === "string") ||
    new Set(value).size !== value.length ||
    value.some((item) => !allowed.includes(item)) ||
    (requiredValue !== undefined && !value.includes(requiredValue))
  ) {
    throw oidcError("STORAGE_FAILED");
  }
  return [...value];
};

const parseStoredUser = (value: unknown, expectedSubject: string): AuthUserProfile => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(
      value,
      ["subject"],
      ["name", "preferredUsername", "email", "emailVerified", "picture", "groups"],
    ) ||
    readSafeString(value.subject, 255) !== expectedSubject
  ) {
    throw oidcError("STORAGE_FAILED");
  }
  const optionalString = (key: string, maximum: number): string | undefined => {
    const input = value[key];
    if (input === undefined) return undefined;
    const parsed = readSafeString(input, maximum);
    if (parsed === undefined) throw oidcError("STORAGE_FAILED");
    return parsed;
  };
  const picture = value.picture === undefined ? undefined : readPicture(value.picture);
  if (value.picture !== undefined && picture !== value.picture) {
    throw oidcError("STORAGE_FAILED");
  }
  let groups: readonly string[] | undefined;
  if (value.groups !== undefined) {
    if (
      !Array.isArray(value.groups) ||
      value.groups.length === 0 ||
      value.groups.length > 100 ||
      !value.groups.every((group) => readSafeString(group, 255) === group) ||
      new Set(value.groups).size !== value.groups.length
    ) {
      throw oidcError("STORAGE_FAILED");
    }
    groups = [...value.groups];
  }
  if (value.emailVerified !== undefined && typeof value.emailVerified !== "boolean") {
    throw oidcError("STORAGE_FAILED");
  }
  return {
    subject: expectedSubject,
    name: optionalString("name", 512),
    preferredUsername: optionalString("preferredUsername", 255),
    email: optionalString("email", 320),
    emailVerified: value.emailVerified as boolean | undefined,
    picture,
    groups,
  };
};

const parseStoredTokens = (value: unknown, refreshAllowed: boolean): SensitiveTokenSet => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(
      value,
      ["accessToken", "tokenType"],
      ["refreshToken", "idToken", "accessTokenExpiresAt"],
    ) ||
    readSafeString(value.accessToken, MAX_TOKEN_LENGTH) !== value.accessToken ||
    value.tokenType !== "Bearer"
  ) {
    throw oidcError("STORAGE_FAILED");
  }
  const optionalToken = (key: "refreshToken" | "idToken"): string | undefined => {
    const input = value[key];
    if (input === undefined) return undefined;
    const parsed = readSafeString(input, MAX_TOKEN_LENGTH);
    if (parsed === undefined) throw oidcError("STORAGE_FAILED");
    return parsed;
  };
  const refreshToken = optionalToken("refreshToken");
  if (!refreshAllowed && refreshToken !== undefined) {
    throw oidcError("STORAGE_FAILED");
  }
  if (value.accessTokenExpiresAt !== undefined && !isSafeTimestamp(value.accessTokenExpiresAt)) {
    throw oidcError("STORAGE_FAILED");
  }
  return {
    accessToken: value.accessToken as string,
    tokenType: "Bearer",
    refreshToken,
    idToken: optionalToken("idToken"),
    accessTokenExpiresAt: value.accessTokenExpiresAt as number | undefined,
  };
};

const isCanonicalStoredReturnTo = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    return validateReturnTo(value) === value;
  } catch {
    return false;
  }
};

/** 外部 Transaction Store 的返回值必须重新建立完整信任边界。 */
export const parseStoredLoginTransaction = (
  value: unknown,
  connection: ApplicationConnectionV1,
  ownerNamespace: string,
  transactionId: string,
  now: number,
): LoginTransaction => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "ownerNamespace",
      "transactionId",
      "state",
      "nonce",
      "codeVerifier",
      "redirectUri",
      "returnTo",
      "scopes",
      "resources",
      "createdAt",
      "expiresAt",
    ]) ||
    value.ownerNamespace !== ownerNamespace ||
    value.transactionId !== transactionId ||
    !isValidOpaqueValue(value.state as string) ||
    !isValidOpaqueValue(value.nonce as string) ||
    !isValidOpaqueValue(value.codeVerifier as string) ||
    typeof value.redirectUri !== "string" ||
    !connection.redirectUris.includes(value.redirectUri) ||
    !isCanonicalStoredReturnTo(value.returnTo) ||
    !isSafeTimestamp(value.createdAt) ||
    !isSafeTimestamp(value.expiresAt) ||
    value.createdAt > now ||
    value.expiresAt <= value.createdAt ||
    value.expiresAt - value.createdAt > 15 * 60_000
  ) {
    throw oidcError("STORAGE_FAILED");
  }
  return {
    ownerNamespace,
    transactionId,
    state: value.state as string,
    nonce: value.nonce as string,
    codeVerifier: value.codeVerifier as string,
    redirectUri: value.redirectUri,
    returnTo: value.returnTo,
    scopes: parseStoredList(value.scopes, connection.scopes, "openid"),
    resources: parseStoredList(value.resources, connection.resources),
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
};

/** 外部 Session Store 不得扩大连接配置允许的 scope、resource 或公开任意字段。 */
export const parseStoredAuthSession = (
  value: unknown,
  connection: ApplicationConnectionV1,
  ownerNamespace: string,
  sessionId: string,
  now: number,
): SensitiveAuthSessionRecord => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "ownerNamespace",
      "sessionId",
      "subject",
      "user",
      "scopes",
      "resources",
      "tokens",
      "refreshVersion",
      "createdAt",
      "updatedAt",
      "expiresAt",
    ]) ||
    value.ownerNamespace !== ownerNamespace ||
    value.sessionId !== sessionId ||
    readSafeString(value.subject, 255) !== value.subject ||
    !Number.isSafeInteger(value.refreshVersion) ||
    (value.refreshVersion as number) < 0 ||
    !isSafeTimestamp(value.createdAt) ||
    !isSafeTimestamp(value.updatedAt) ||
    !isSafeTimestamp(value.expiresAt) ||
    value.updatedAt < value.createdAt ||
    value.updatedAt > now + 5 * 60_000 ||
    value.expiresAt <= value.createdAt ||
    value.expiresAt - value.createdAt > 30 * 24 * 60 * 60_000
  ) {
    throw oidcError("STORAGE_FAILED");
  }
  const subject = value.subject as string;
  return {
    ownerNamespace,
    sessionId,
    subject,
    user: parseStoredUser(value.user, subject),
    scopes: parseStoredList(value.scopes, connection.scopes, "openid"),
    resources: parseStoredList(value.resources, connection.resources),
    tokens: parseStoredTokens(value.tokens, connection.capabilities.refreshToken),
    refreshVersion: value.refreshVersion as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
  };
};
