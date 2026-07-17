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
    expect(userHasAnyGroup(groups, ["后端组"])).toBe(true);
    expect(userHasAnyGroup(groups, ["tenant-1/engineering/backend"])).toBe(true);
  });
});

describe("userToClaims", () => {
  it("保留 Gitea 字符串 groups 并输出 groups_tree", () => {
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
