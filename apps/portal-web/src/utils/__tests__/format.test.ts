import { describe, expect, it } from "vitest";
import { formatInitial, formatUserName, toSafeLaunchUrl } from "../format";

describe("门户格式化工具", () => {
  it("按姓名、用户名和邮箱顺序生成显示名", () => {
    expect(formatUserName({ sub: "1", name: " 测试用户 ", username: "tester" })).toBe("测试用户");
    expect(formatUserName({ sub: "2", username: "tester" })).toBe("tester");
    expect(formatUserName({ sub: "3", email: "hello@example.com" })).toBe("hello");
  });

  it("安全处理 Unicode 首字母和空名称", () => {
    expect(formatInitial(" gitea")).toBe("G");
    expect(formatInitial("飞书")).toBe("飞");
    expect(formatInitial("  ")).toBe("?");
  });

  it("拒绝非 HTTP(S) 应用入口", () => {
    expect(toSafeLaunchUrl("https://git.example.com", "https://id.example.com")).toBe(
      "https://git.example.com",
    );
    expect(toSafeLaunchUrl("/oidc/start", "https://id.example.com")).toBe("/oidc/start");
    expect(toSafeLaunchUrl("javascript:alert(1)", "https://id.example.com")).toBeNull();
  });
});
