import {
  type NormalizedCreateCustomApplicationRequestV1,
  type NormalizedCreateTemplateApplicationRequestV1,
  type NormalizedPreviewApplicationTemplateRequestV1,
  safeParseCreateCustomApplicationRequestV1,
  safeParseCreateTemplateApplicationRequestV1,
  safeParsePreviewApplicationTemplateRequestV1,
} from "@gitea-oidc/contracts";
import { ApplicationValidationError } from "./errors.js";
import type {
  CreateCustomApplicationRequestV1,
  CreateTemplateApplicationRequestV1,
  PreviewApplicationTemplateRequestV1,
} from "./types.js";

export type NormalizedCreateCustomApplicationRequest = NormalizedCreateCustomApplicationRequestV1;
export type NormalizedCreateTemplateApplicationRequest =
  NormalizedCreateTemplateApplicationRequestV1;
export type NormalizedPreviewApplicationTemplateRequest =
  NormalizedPreviewApplicationTemplateRequestV1;

export function validateAndNormalizeCreateCustomRequest(
  input: CreateCustomApplicationRequestV1,
): NormalizedCreateCustomApplicationRequest {
  const parsed = safeParseCreateCustomApplicationRequestV1(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join(".") ?? "request";
    const message = firstIssue?.message ?? "请求格式无效";
    throw new ApplicationValidationError(`${path}: ${message}`, { cause: parsed.error });
  }
  return parsed.data;
}

export function validateAndNormalizeCreateTemplateRequest(
  input: CreateTemplateApplicationRequestV1,
): NormalizedCreateTemplateApplicationRequest {
  const parsed = safeParseCreateTemplateApplicationRequestV1(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join(".") ?? "request";
    const message = firstIssue?.message ?? "请求格式无效";
    throw new ApplicationValidationError(`${path}: ${message}`, { cause: parsed.error });
  }
  return parsed.data;
}

export function validateAndNormalizePreviewTemplateRequest(
  input: PreviewApplicationTemplateRequestV1,
): NormalizedPreviewApplicationTemplateRequest {
  const parsed = safeParsePreviewApplicationTemplateRequestV1(input);
  if (!parsed.success) {
    throw new ApplicationValidationError("模板预览请求格式无效", { cause: parsed.error });
  }
  return parsed.data;
}

function isLoopbackHost(hostname: string): boolean {
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
}

export function validateIssuer(input: string): string {
  if (input.trim() !== input || input === "") {
    throw new ApplicationValidationError("issuer 不能包含首尾空白");
  }

  let issuer: URL;
  try {
    issuer = new URL(input);
  } catch (error) {
    throw new ApplicationValidationError("issuer 必须是绝对 URL", { cause: error });
  }

  if (
    issuer.hash !== "" ||
    issuer.search !== "" ||
    issuer.username !== "" ||
    issuer.password !== ""
  ) {
    throw new ApplicationValidationError("issuer 不允许包含 query、fragment 或用户凭据");
  }
  if (
    issuer.protocol !== "https:" &&
    !(issuer.protocol === "http:" && isLoopbackHost(issuer.hostname))
  ) {
    throw new ApplicationValidationError("issuer 必须使用 HTTPS，本地 loopback 开发地址除外");
  }

  return issuer.toString().replace(/\/$/, "");
}
