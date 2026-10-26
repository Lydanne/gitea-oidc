import { describe, expect, it } from "vitest";
import { normalizeBasePath } from "../../runtimeConfig";

describe("门户运行时路径", () => {
  it("规范化站内基础路径", () => {
    expect(normalizeBasePath("/workspace/portal/", "/portal")).toBe("/workspace/portal");
    expect(normalizeBasePath("//evil.example", "/portal")).toBe("/portal");
    expect(normalizeBasePath("https://evil.example", "/portal")).toBe("/portal");
  });
});
