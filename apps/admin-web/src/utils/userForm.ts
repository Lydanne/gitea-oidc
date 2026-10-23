import type { AdminUser, AdminUserPayload, UserForm } from "../types/admin";
import { parseUserGroupsJson, userGroupsToJson } from "./userGroups";

/** 创建空用户表单。 */
export const createBlankUserForm = (): UserForm => ({
  username: "",
  name: "",
  email: "",
  authProvider: "local",
  externalId: "",
  groups: "[]",
  roles: "",
  status: "active",
  picture: "",
  phone: "",
});

/** 将字符串数组格式化为逗号分隔文本。 */
export const listToText = (value?: string[]) => (Array.isArray(value) ? value.join(", ") : "");

/** 将逗号分隔文本转换为去空白的字符串数组。 */
export const textToList = (value: string) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** 将用户对象转换为可编辑表单。 */
export const userToForm = (user: AdminUser): UserForm => ({
  username: user.username ?? "",
  name: user.name ?? "",
  email: user.email ?? "",
  authProvider: user.authProvider ?? "local",
  externalId: user.externalId ?? user.username ?? "",
  groups: userGroupsToJson(user.groups),
  roles: listToText(user.roles),
  status: user.status ?? "active",
  picture: user.picture ?? "",
  phone: user.phone ?? "",
});

/** 将用户表单转换为后台 API 载荷。 */
export const formToPayload = (
  form: UserForm,
  options: { includeIdentity?: boolean } = {},
): AdminUserPayload => {
  const username = form.username.trim();
  const externalId = form.externalId.trim() || username;
  const includeIdentity = options.includeIdentity ?? true;

  return {
    username,
    name: form.name.trim() || username,
    email: form.email.trim() || `${username}@local`,
    ...(includeIdentity
      ? {
          authProvider: form.authProvider.trim() || "local",
          externalId,
        }
      : {}),
    groups: parseUserGroupsJson(form.groups),
    roles: textToList(form.roles),
    status: form.status,
    ...(form.picture.trim() ? { picture: form.picture.trim() } : {}),
    ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
  };
};
