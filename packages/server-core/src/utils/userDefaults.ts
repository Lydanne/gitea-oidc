/**
 * 用户默认值工具
 */

import type { UserInfo } from "../types/auth.js";

/**
 * 补齐规范化用户字段默认值
 * @param user 用户信息
 * @returns 补齐默认值后的用户信息
 */
export function withUserDefaults<T extends UserInfo>(user: T): T {
  return {
    ...user,
    status: user.status ?? "active",
  };
}
