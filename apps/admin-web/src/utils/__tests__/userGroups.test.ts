import { describe, expect, it } from "vitest";
import { flattenUserGroupNames, parseUserGroupsJson, userGroupsToJson } from "../userGroups";

describe("user groups", () => {
  const groups = [
    {
      id: "engineering",
      name: "研发中心",
      children: [{ id: "backend", name: "后端组" }],
    },
  ];

  it("解析并保留树形结构", () => {
    expect(parseUserGroupsJson(userGroupsToJson(groups))).toEqual(groups);
  });

  it("展平名称用于列表展示", () => {
    expect(flattenUserGroupNames(groups)).toEqual(["研发中心", "后端组"]);
  });

  it("拒绝无效 JSON 和缺失标识的节点", () => {
    expect(() => parseUserGroupsJson("not-json")).toThrow("有效的 JSON 数组");
    expect(() => parseUserGroupsJson('[{"name":"研发组"}]')).toThrow("id 和 name");
    expect(() => parseUserGroupsJson('[{"id":"dev","name":"研发组","role":"admin"}]')).toThrow(
      "不支持的字段",
    );
  });
});
