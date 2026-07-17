/**
 * Provider token 列表查询选项校验。
 *
 * 后台 token 列表会展示第三方凭证状态，查询参数必须限制在可预期字段和值范围内。
 */

import type {
  ProviderTokenListOptions,
  ProviderTokenOwnerType,
  ProviderTokenProbeCandidateOptions,
  ProviderTokenStatus,
} from "../types/providerApi.js";

export const PROVIDER_TOKEN_OWNER_TYPES = ["user", "app"] as const;
export const PROVIDER_TOKEN_STATUSES = [
  "valid",
  "expired",
  "refresh_failed",
  "revoked",
  "unknown",
] as const;

const MAX_PROVIDER_TOKEN_STRING_LENGTH = 256;
const MAX_PROVIDER_TOKEN_PROBE_LIMIT = 500;

/**
 * 校验 Provider token 列表查询选项，返回可安全传给仓储实现的副本。
 */
export function normalizeProviderTokenListOptions(
  options?: ProviderTokenListOptions,
): ProviderTokenListOptions {
  if (!options) {
    return {};
  }

  const normalized: ProviderTokenListOptions = {};

  if (options.provider !== undefined) {
    normalized.provider = normalizeTokenListString(options.provider, "provider");
  }

  if (options.ownerType !== undefined) {
    if (!isProviderTokenOwnerType(options.ownerType)) {
      throw new Error("Unsupported provider token owner type");
    }
    normalized.ownerType = options.ownerType;
  }

  if (options.ownerId !== undefined) {
    normalized.ownerId = normalizeTokenListString(options.ownerId, "ownerId");
  }

  if (options.status !== undefined) {
    if (!isProviderTokenStatus(options.status)) {
      throw new Error("Unsupported provider token status");
    }
    normalized.status = options.status;
  }

  if (options.offset !== undefined) {
    normalized.offset = normalizeNonNegativeInteger(options.offset, "offset");
  }

  if (options.limit !== undefined) {
    normalized.limit = normalizePositiveInteger(options.limit, "limit");
  }

  return normalized;
}

/**
 * 校验 Provider token 探活候选查询选项。
 */
export function normalizeProviderTokenProbeCandidateOptions(
  options: ProviderTokenProbeCandidateOptions,
): ProviderTokenProbeCandidateOptions {
  if (!(options.expiresBefore instanceof Date) || Number.isNaN(options.expiresBefore.getTime())) {
    throw new Error("Provider token probe expiresBefore must be a valid Date");
  }

  const limit = normalizePositiveInteger(options.limit, "limit");
  if (limit > MAX_PROVIDER_TOKEN_PROBE_LIMIT) {
    throw new Error(
      `Provider token probe limit must be less than or equal to ${MAX_PROVIDER_TOKEN_PROBE_LIMIT}`,
    );
  }

  return {
    expiresBefore: new Date(options.expiresBefore),
    limit,
  };
}

export function isProviderTokenOwnerType(value: unknown): value is ProviderTokenOwnerType {
  return typeof value === "string" && PROVIDER_TOKEN_OWNER_TYPES.includes(value as any);
}

export function isProviderTokenStatus(value: unknown): value is ProviderTokenStatus {
  return typeof value === "string" && PROVIDER_TOKEN_STATUSES.includes(value as any);
}

export function normalizeTokenListString(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_TOKEN_STRING_LENGTH
  ) {
    throw new Error(`Provider token ${name} must be a non-empty string`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Provider token list ${name} must be a non-negative integer`);
  }
  return value;
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Provider token list ${name} must be a positive integer`);
  }
  return value;
}
