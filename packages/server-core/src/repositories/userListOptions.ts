/**
 * 用户列表查询选项校验。
 *
 * 仓储实现会把排序字段映射到 SQL ORDER BY，运行时必须使用白名单避免字段名注入。
 */

import type { ListOptions } from "../types/auth.js";

export const USER_LIST_FILTER_FIELDS = ["username", "name", "email", "authProvider", "status"];

const USER_LIST_SORT_SQL_COLUMNS: Record<string, string> = {
  username: "username",
  name: "name",
  email: "email",
  authProvider: '"authProvider"',
  status: "status",
  createdAt: '"createdAt"',
  updatedAt: '"updatedAt"',
};

/**
 * 校验用户列表查询选项，返回可安全传给仓储实现的副本。
 */
export function normalizeUserListOptions(options?: ListOptions): ListOptions {
  if (!options) {
    return {};
  }

  const normalized: ListOptions = {};

  if (options.filter) {
    normalized.filter = normalizeUserListFilter(options.filter);
  }

  if (options.sortBy !== undefined) {
    assertAllowedUserSortField(options.sortBy);
    normalized.sortBy = options.sortBy;
  }

  if (options.sortOrder !== undefined) {
    if (options.sortOrder !== "asc" && options.sortOrder !== "desc") {
      throw new Error("Unsupported user sort order");
    }
    normalized.sortOrder = options.sortOrder;
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
 * 将排序字段映射为仓储可使用的安全 SQL 列名。
 */
export function getUserListSortColumn(sortBy: string): string {
  assertAllowedUserSortField(sortBy);
  return USER_LIST_SORT_SQL_COLUMNS[sortBy];
}

export function isUserListFilterField(field: string): boolean {
  return USER_LIST_FILTER_FIELDS.includes(field);
}

export function isUserListSortField(field: string): boolean {
  return Object.hasOwn(USER_LIST_SORT_SQL_COLUMNS, field);
}

function normalizeUserListFilter(filter: Record<string, any>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (!isUserListFilterField(key)) {
      throw new Error(`Unsupported user filter field: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`User filter field must be a string: ${key}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function assertAllowedUserSortField(sortBy: string): void {
  if (!isUserListSortField(sortBy)) {
    throw new Error(`Unsupported user sort field: ${sortBy}`);
  }
}

function normalizeNonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`User list ${name} must be a non-negative integer`);
  }
  return value;
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`User list ${name} must be a positive integer`);
  }
  return value;
}
