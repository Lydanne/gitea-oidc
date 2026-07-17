import { describe, expect, it } from "vitest";
import type { UserInfo } from "../../types/auth.js";
import { userToClaims } from "../userClaims.js";
import {
  buildUserGroupTree,
  flattenUserGroups,
  normalizeUserGroups,
  userHasAnyGroup,
} from "../userGroups.js";

describe("user groups", () => {
  it("忽略旧字符串数组", () => {
    expect(normalizeUserGroups(["developers", "admins"])).toEqual([]);
  });

  it("合并多条路径并按完整 ID 和名称路径展平", () => {
    const groups = buildUserGroupTree([
      [
        { id: "tenant-1", name: "示例组织" },
        { id: "engineering", name: "研发中心" },
        { id: "backend", name: "后端组" },
      ],
      [
        { id: "tenant-1", name: "示例组织" },
        { id: "engineering", name: "研发中心" },
        { id: "frontend", name: "前端组" },
      ],
    ]);

    expect(groups).toEqual([
      {
        id: "tenant-1",
        name: "示例组织",
        children: [
          {
            id: "engineering",
            name: "研发中心",
            children: [
              { id: "backend", name: "后端组" },
              { id: "frontend", name: "前端组" },
            ],
          },
        ],
      },
    ]);
    expect(flattenUserGroups(groups)).toEqual([
      "示例组织",
      "tenant-1",
      "示例组织/研发中心",
      "tenant-1/engineering",
      "示例组织/研发中心/后端组",
      "tenant-1/engineering/backend",
      "示例组织/研发中心/前端组",
      "tenant-1/engineering/frontend",
    ]);
    expect(userHasAnyGroup(groups, ["后端组"])).toBe(false);
    expect(userHasAnyGroup(groups, ["示例组织/研发中心/后端组"])).toBe(true);
    expect(userHasAnyGroup(groups, ["tenant-1/engineering/backend"])).toBe(true);
  });

  it("转义节点内的路径分隔符且不与原始百分号值碰撞", () => {
    const groups = [
      {
        id: "tenant/1",
        name: "示例/组织",
        children: [
          { id: "team%2Fone", name: "研发%2F平台" },
          { id: "team/one", name: "研发/平台" },
        ],
      },
    ];

    expect(flattenUserGroups(groups)).toEqual([
      "示例%2F组织",
      "tenant%2F1",
      "示例%2F组织/研发%252F平台",
      "tenant%2F1/team%252Fone",
      "示例%2F组织/研发%2F平台",
      "tenant%2F1/team%2Fone",
    ]);
    expect(userHasAnyGroup(groups, ["team/one", "研发/平台"])).toBe(false);
    expect(userHasAnyGroup(groups, ["tenant%2F1/team%2Fone"])).toBe(true);
  });
});

describe("userToClaims", () => {
  it("输出完整路径 groups 并保留 groups_tree", () => {
    const user: UserInfo = {
      id: "internal-user-1",
      sub: "user-1",
      username: "alice",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: true,
      authProvider: "feishu",
      externalId: "ou_1",
      groups: [
        { id: "Default", name: "Default" },
        {
          id: "tenant-1",
          name: "示例组织",
          children: [
            {
              id: "engineering",
              name: "研发中心",
              children: [{ id: "backend", name: "后端组" }],
            },
          ],
        },
      ],
      roles: ["developer"],
      updatedAt: new Date("2026-07-14T00:00:00.000Z"),
    };

    const claims = userToClaims(user);

    expect(claims).toMatchObject({
      sub: "user-1",
      preferred_username: "alice",
      email_verified: true,
      groups: [
        "Default",
        "示例组织",
        "tenant-1",
        "示例组织/研发中心",
        "tenant-1/engineering",
        "示例组织/研发中心/后端组",
        "tenant-1/engineering/backend",
      ],
      groups_tree: user.groups,
      roles: ["developer"],
      status: "active",
      updated_at: 1783987200,
    });
    expect(claims).not.toHaveProperty("id");
  });
});
