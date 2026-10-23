import type { UserGroup } from "../types/admin";

/** 将分组树格式化为管理台编辑器使用的 JSON。 */
export const userGroupsToJson = (groups?: UserGroup[]) =>
  JSON.stringify(Array.isArray(groups) ? groups : [], null, 2);

/** 解析并校验管理台提交的分组树。 */
export const parseUserGroupsJson = (value: string): UserGroup[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "[]");
  } catch {
    throw new Error("用户组必须是有效的 JSON 数组");
  }
  return parseUserGroups(parsed);
};

/** 展平分组名称，供列表和详情展示。 */
export const flattenUserGroupNames = (groups?: UserGroup[]): string[] => {
  const names: string[] = [];
  const visit = (nodes: UserGroup[]) => {
    for (const node of nodes) {
      names.push(node.name);
      if (node.children) visit(node.children);
    }
  };
  visit(groups ?? []);
  return names;
};

function parseUserGroups(value: unknown, depth = 0): UserGroup[] {
  if (!Array.isArray(value)) {
    throw new Error("用户组必须是 JSON 数组");
  }
  if (depth >= 32 && value.length > 0) {
    throw new Error("用户组层级不能超过 32 层");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("每个用户组必须包含 id 和 name");
    }
    const group = item as Record<string, unknown>;
    const unsupported = Object.keys(group).filter(
      (key) => key !== "id" && key !== "name" && key !== "children",
    );
    if (unsupported.length > 0) {
      throw new Error(`用户组包含不支持的字段：${unsupported.join(", ")}`);
    }
    if (
      typeof group.id !== "string" ||
      !group.id.trim() ||
      typeof group.name !== "string" ||
      !group.name.trim()
    ) {
      throw new Error("用户组的 id 和 name 必须是非空字符串");
    }
    const children = group.children === undefined ? [] : parseUserGroups(group.children, depth + 1);
    return {
      id: group.id.trim(),
      name: group.name.trim(),
      ...(children.length > 0 ? { children } : {}),
    };
  });
}
