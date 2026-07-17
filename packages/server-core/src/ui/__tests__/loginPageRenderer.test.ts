import { describe, expect, it } from "vitest";
import type { AuthContext, AuthProvider } from "../../types/auth.js";
import { renderLoginPageHTML } from "../loginPageRenderer.js";

const context = { interactionUid: "interaction-1" } as AuthContext;
const provider = {
  name: "test",
  displayName: '测试 "Provider"',
} as AuthProvider;

describe("renderLoginPageHTML", () => {
  it("renders local and OAuth options with accessible page semantics", () => {
    const html = renderLoginPageHTML(context, [
      {
        provider,
        ui: {
          type: "html",
          html: '<form id="local-login"></form>',
        },
      },
      {
        provider,
        ui: {
          type: "redirect",
          redirectUrl: "https://id.example.com/login",
          button: { text: "使用测试账号继续", icon: "/auth/test/icon.svg" },
        },
      },
    ]);

    expect(html).toContain('<main class="login-card" aria-labelledby="login-title">');
    expect(html).toContain('<h1 id="login-title">继续登录</h1>');
    expect(html).toContain('<form id="local-login"></form>');
    expect(html).toContain('role="separator" aria-label="其他登录方式"');
    expect(html).toContain('<img src="/auth/test/icon.svg" alt="" />');
    expect(html).toContain("使用测试账号继续");
  });

  it("shows a useful empty state when no login option is available", () => {
    const html = renderLoginPageHTML(context, []);

    expect(html).toContain('class="empty-state" role="status"');
    expect(html).toContain("当前没有可用的登录方式，请联系系统管理员。");
  });

  it("does not render options explicitly hidden from the unified page", () => {
    const html = renderLoginPageHTML(context, [
      {
        provider,
        ui: {
          type: "redirect",
          redirectUrl: "https://id.example.com/hidden",
          showInUnifiedPage: false,
          button: { text: "隐藏入口" },
        },
      },
    ]);

    expect(html).not.toContain("https://id.example.com/hidden");
    expect(html).not.toContain("隐藏入口");
    expect(html).toContain('class="empty-state" role="status"');
  });

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
