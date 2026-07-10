import { describe, expect, it } from "vitest";
import type { AuthContext, AuthProvider } from "../../types/auth.js";
import { renderLoginPageHTML } from "../loginPageRenderer.js";

const context = { interactionUid: "interaction-1" } as AuthContext;
const provider = {
  name: "test",
  displayName: '测试 "Provider"',
} as AuthProvider;

describe("renderLoginPageHTML", () => {
  it("escapes OAuth button text, href and icon attributes", () => {
    const html = renderLoginPageHTML(context, [
      {
        provider,
        ui: {
          type: "redirect",
          redirectUrl: 'https://id.example.com/login?next="><script>alert(1)</script>',
          button: {
            text: '<img src=x onerror="alert(1)">',
            icon: '/auth/test/icon.svg?name="><script>alert(1)</script>',
          },
        },
      },
    ]);

    expect(html).toContain(
      'href="https://id.example.com/login?next=%22%3E%3Cscript%3Ealert(1)%3C/script%3E"',
    );
    expect(html).toContain(
      'src="/auth/test/icon.svg?name=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
    );
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("skips OAuth buttons with executable or non-web URLs", () => {
    const html = renderLoginPageHTML(context, [
      {
        provider,
        ui: {
          type: "redirect",
          redirectUrl: "javascript:alert(1)",
          button: { text: "危险登录", icon: "data:image/svg+xml,<svg></svg>" },
        },
      },
      {
        provider,
        ui: {
          type: "redirect",
          redirectUrl: "//evil.example.com/login",
          button: { text: "协议相对地址" },
        },
      },
    ]);

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("危险登录");
    expect(html).not.toContain("协议相对地址");
  });
});
