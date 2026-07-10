import { z } from "zod";

const OAUTH_SCOPE_PATTERN = /^[\u0021\u0023-\u005b\u005d-\u007e]+$/u;

const hasExactWhitespace = (value: string) => value === value.trim();
export const hasNoControlCharacters = (value: string): boolean =>
  Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && (codePoint < 127 || codePoint > 159);
  });

const exactProtocolStringSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(hasExactWhitespace, "协议字段不能包含首尾空白")
    .refine(hasNoControlCharacters, "协议字段不能包含控制字符");

export const identifierSchema = exactProtocolStringSchema(255).refine(
  (value) => !/\s/u.test(value),
  "标识符不能包含空白字符",
);

export const clientIdSchema = exactProtocolStringSchema(255).refine(
  (value) => !/\s/u.test(value),
  "client_id 不能包含空白字符",
);

export const displayNameSchema = z.string().trim().min(1).max(120);

export const descriptionSchema = z.string().trim().min(1).max(2000);

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和单个连字符");

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const isLoopbackHostname = (hostname: string): boolean => {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalizedHostname === "localhost" || normalizedHostname === "::1") {
    return true;
  }

  const octets = normalizedHostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => {
      if (!/^\d+$/u.test(octet)) {
        return false;
      }
      const value = Number(octet);
      return value >= 0 && value <= 255;
    })
  );
};

const absoluteHttpUrlSchema = exactProtocolStringSchema(2048).superRefine((value, context) => {
  const url = parseUrl(value);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    context.addIssue({ code: "custom", message: "必须是绝对 HTTP(S) URL" });
    return;
  }
  if (url.username || url.password) {
    context.addIssue({ code: "custom", message: "URL 不能包含 userinfo" });
  }
  if (url.hash) {
    context.addIssue({ code: "custom", message: "URL 不能包含 fragment" });
  }
  if (value.includes("*")) {
    context.addIssue({ code: "custom", message: "URL 不能包含通配符" });
  }
});

export const issuerUrlSchema = absoluteHttpUrlSchema.superRefine((value, context) => {
  const url = parseUrl(value);
  if (!url) {
    return;
  }
  if (url.search) {
    context.addIssue({ code: "custom", message: "issuer 不能包含 query" });
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    context.addIssue({ code: "custom", message: "issuer 仅允许 HTTPS 或 loopback HTTP" });
  }
});

export const redirectUriSchema = absoluteHttpUrlSchema.superRefine((value, context) => {
  const url = parseUrl(value);
  if (url?.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    context.addIssue({ code: "custom", message: "HTTP redirect URI 仅允许 loopback 地址" });
  }
});

export const resourceSchema = exactProtocolStringSchema(2048);

export const scopeSchema = exactProtocolStringSchema(255).regex(
  OAUTH_SCOPE_PATTERN,
  "scope 必须符合 OAuth scope-token 语法",
);

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const uniqueStringArraySchema = <T extends z.ZodType<string>>(itemSchema: T, minimum = 0) =>
  z
    .array(itemSchema)
    .min(minimum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: "数组不能包含重复值",
        });
      }
    });

export const uriAllowedForEnvironment = (
  value: string,
  environment: "development" | "staging" | "production",
): boolean => {
  const url = parseUrl(value);
  if (!url) {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return (
    environment === "development" && url.protocol === "http:" && isLoopbackHostname(url.hostname)
  );
};

export const unorderedStringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

export const addIssue = (context: z.core.$RefinementCtx, path: PropertyKey[], message: string) => {
  context.addIssue({ code: "custom", path, message });
};
