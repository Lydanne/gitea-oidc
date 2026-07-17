import type { AuthSessionView, AuthUserProfile } from "@x-oidc/node";
import { connectorError } from "./errors.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });

const readRequiredString = (value: unknown, maximum: number): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    hasControlCharacters(value)
  ) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  return value;
};

const readOptionalString = (value: unknown, maximum: number): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredString(value, maximum);
};

const readIsoDate = (value: unknown): string => {
  const date = readRequiredString(value, 64);
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== date) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  return date;
};

const failInvalidClientResponse = (): never => {
  throw connectorError("INVALID_CLIENT_RESPONSE");
};

/** 只投影公开会话白名单，调用方实现意外附带的 Token 或内部字段会被丢弃。 */
export const projectAuthSessionView = (input: unknown): AuthSessionView => {
  if (!isRecord(input) || input.authenticated !== true || !isRecord(input.user)) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }
  const rawUser = input.user;
  const groups =
    rawUser.groups === undefined
      ? undefined
      : Array.isArray(rawUser.groups) &&
          rawUser.groups.length <= 100 &&
          rawUser.groups.every((group) => typeof group === "string")
        ? Object.freeze(rawUser.groups.map((group) => readRequiredString(group, 255)))
        : failInvalidClientResponse();

  const user: Readonly<AuthUserProfile> = Object.freeze({
    subject: readRequiredString(rawUser.subject, 255),
    name: readOptionalString(rawUser.name, 512),
    preferredUsername: readOptionalString(rawUser.preferredUsername, 255),
    email: readOptionalString(rawUser.email, 320),
    emailVerified:
      rawUser.emailVerified === undefined
        ? undefined
        : typeof rawUser.emailVerified === "boolean"
          ? rawUser.emailVerified
          : failInvalidClientResponse(),
    picture: readOptionalString(rawUser.picture, 2_048),
    groups,
  });
  if (
    !Array.isArray(input.scopes) ||
    input.scopes.length === 0 ||
    input.scopes.length > 100 ||
    !input.scopes.every((scope) => typeof scope === "string") ||
    typeof input.canRefresh !== "boolean"
  ) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }

  const createdAt = readIsoDate(input.createdAt);
  const expiresAt = readIsoDate(input.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw connectorError("INVALID_CLIENT_RESPONSE");
  }

  return Object.freeze({
    authenticated: true,
    user,
    scopes: Object.freeze(input.scopes.map((scope) => readRequiredString(scope, 255))),
    canRefresh: input.canRefresh,
    createdAt,
    expiresAt,
  });
};
