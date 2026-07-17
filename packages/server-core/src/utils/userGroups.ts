import type { UserGroup } from "../types/user.js";

const MAX_USER_GROUP_DEPTH = 32;

/** 规范化 UserGroup 树，忽略不完整或非法节点。 */
export function normalizeUserGroups(value: unknown, depth = 0): UserGroup[] {
  if (!Array.isArray(value) || depth >= MAX_USER_GROUP_DEPTH) {
    return [];
  }

  const groups: UserGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = readNonEmptyString(record.id);
    const name = readNonEmptyString(record.name);
    if (!id || !name) {
      continue;
    }

    const children = normalizeUserGroups(record.children, depth + 1);
    groups.push({ id, name, ...(children.length > 0 ? { children } : {}) });
  }

  return mergeUserGroups(groups);
}

/** 将一组字符串标识转换为没有层级的分组对象。 */
export function userGroupsFromValues(values: Iterable<string>): UserGroup[] {
  return normalizeUserGroups(
    Array.from(values, (value) => ({
      id: value,
      name: value,
    })),
  );
}

/** 将分组树展平为从根节点到当前节点的名称路径和 ID 路径。 */
export function flattenUserGroups(groups: unknown): string[] {
  const values = new Set<string>();
  const visit = (nodes: UserGroup[], idPath: string[], namePath: string[]) => {
    for (const node of nodes) {
      const nextIdPath = [...idPath, node.id];
      const nextNamePath = [...namePath, node.name];
      values.add(nextNamePath.join("/"));
      values.add(nextIdPath.join("/"));
      if (node.children) visit(node.children, nextIdPath, nextNamePath);
    }
  };
  visit(normalizeUserGroups(groups), [], []);
  return Array.from(values);
}

/**
 * 判断用户组树是否命中任一权限分组。
 *
 * 权限配置既可以使用新的完整路径，也继续支持单节点 ID 或名称。
 */
export function userHasAnyGroup(groups: unknown, expected: Iterable<string>): boolean {
  const allowed = new Set(Array.from(expected));
  return userGroupPermissionValues(groups).some((value) => allowed.has(value));
}

/** 返回权限判断使用的完整路径和单节点兼容值。 */
export function userGroupPermissionValues(groups: unknown): string[] {
  return Array.from(new Set([...flattenUserGroups(groups), ...collectUserGroupNodeValues(groups)]));
}

/** 移除命中指定 ID 或名称的节点；被移除节点的子节点会提升到当前层级。 */
export function withoutUserGroupValues(groups: unknown, excluded: Iterable<string>): UserGroup[] {
  const values = new Set(Array.from(excluded));
  const filter = (nodes: UserGroup[]): UserGroup[] =>
    nodes.flatMap((node) => {
      const children = filter(node.children ?? []);
      if (values.has(node.id) || values.has(node.name)) {
        return children;
      }
      return [
        {
          id: node.id,
          name: node.name,
          ...(children.length > 0 ? { children } : {}),
        },
      ];
    });
  return filter(normalizeUserGroups(groups));
}

/** 合并同级同 ID 节点，并递归合并它们的子树。 */
export function mergeUserGroups(groups: UserGroup[]): UserGroup[] {
  const merged = new Map<string, UserGroup>();
  for (const group of groups) {
    const existing = merged.get(group.id);
    if (!existing) {
      merged.set(group.id, cloneUserGroup(group));
      continue;
    }

    const children = mergeUserGroups([...(existing.children ?? []), ...(group.children ?? [])]);
    merged.set(group.id, {
      id: existing.id,
      name: existing.name || group.name,
      ...(children.length > 0 ? { children } : {}),
    });
  }
  return Array.from(merged.values());
}

/** 将若干条根到叶路径合并为分组树。 */
export function buildUserGroupTree(paths: UserGroup[][]): UserGroup[] {
  return mergeUserGroups(
    paths.map((path) => buildPath(path)).filter((group): group is UserGroup => group !== undefined),
  );
}

function buildPath(path: UserGroup[]): UserGroup | undefined {
  let child: UserGroup | undefined;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const current = path[index];
    if (!current) continue;
    child = {
      id: current.id,
      name: current.name,
      ...(child ? { children: [child] } : {}),
    };
  }
  return child;
}

function cloneUserGroup(group: UserGroup): UserGroup {
  const children = group.children?.map(cloneUserGroup) ?? [];
  return {
    id: group.id,
    name: group.name,
    ...(children.length > 0 ? { children } : {}),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function collectUserGroupNodeValues(groups: unknown): string[] {
  const values = new Set<string>();
  const visit = (nodes: UserGroup[]) => {
    for (const node of nodes) {
      values.add(node.id);
      values.add(node.name);
      if (node.children) visit(node.children);
    }
  };
  visit(normalizeUserGroups(groups));
  return Array.from(values);
}
