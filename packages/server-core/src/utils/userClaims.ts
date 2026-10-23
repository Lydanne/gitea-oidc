import type { UserInfo } from "../types/auth.js";
import type { UserClaims } from "../types/user.js";
import { flattenUserGroups, normalizeUserGroups } from "./userGroups.js";

/** 将内部用户模型统一投影为 OIDC Claims。 */
export function userToClaims(user: UserInfo): UserClaims {
  const groupsTree = normalizeUserGroups(user.groups);
  return {
    sub: user.sub,
    preferred_username: user.username,
    name: user.name,
    email: user.email,
    email_verified: user.emailVerified ?? false,
    picture: user.picture,
    phone: user.phone,
    phone_verified: user.phoneVerified ?? false,
    groups: flattenUserGroups(groupsTree),
    groups_tree: groupsTree,
    roles: user.roles ?? [],
    status: user.status ?? "active",
    updated_at: user.updatedAt ? Math.floor(user.updatedAt.getTime() / 1000) : undefined,
  };
}
