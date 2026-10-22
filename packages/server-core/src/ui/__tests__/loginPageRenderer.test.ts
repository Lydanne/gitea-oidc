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

    expect(html).toContain(
      '<main class="login-card" aria-labelledby="login-title" data-slot="card">',
    );
    expect(html).toContain('<h1 id="login-title">登录你的账号</h1>');
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

const redirectOption = (
  redirectUrl: string = "https://id.example.com/login?state=one&scope=openid",
) => ({
  provider,
  ui: { type: "redirect" as const, redirectUrl, button: { text: "继续登录" } },
});

describe("单一按钮登录倒计时", () => {
  it("3 秒后导航到同一个登录目标，同时保留可立即使用的按钮", () => {
    const html = renderLoginPageHTML(context, [redirectOption()]);
    const escapedUrl = "https://id.example.com/login?state=one&amp;scope=openid";
    expect(html).toContain(`<meta http-equiv="refresh" content="3;url=${escapedUrl}">`);
    expect(html).toContain(`<a href="${escapedUrl}" class="oauth-button"`);
    expect(html).toContain('href="/interaction/interaction-1?autoLogin=0"');
    expect(html).toContain("秒后自动继续登录");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick=");
  });

  it("隐藏方式不计入可见入口数量", () => {
    const html = renderLoginPageHTML(context, [
      redirectOption(),
      { provider, ui: { type: "html", html: "<form></form>", showInUnifiedPage: false } },
    ]);
    expect(html).toContain('http-equiv="refresh"');
  });

  it.each([
    ["多个按钮", [redirectOption(), redirectOption("/auth/another")]],
    ["账号密码表单", [{ provider, ui: { type: "html" as const, html: "<form></form>" } }]],
    [
      "表单与按钮混合",
      [redirectOption(), { provider, ui: { type: "html" as const, html: "<form></form>" } }],
    ],
    ["没有可用入口", []],
    ["非法跳转", [redirectOption("javascript:alert(1)")]],
  ])("%s 时不启动自动登录", (_name, options) => {
    const html = renderLoginPageHTML(context, options);
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('class="auto-login"');
  });

  it.each([
    { autoLogin: "0" },
    { error: "登录失败" },
  ])("取消或错误返回后保持手动登录：%j", (query) => {
    const html = renderLoginPageHTML({ ...context, query }, [redirectOption()]);
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('class="oauth-button"');
  });

  it("取消地址编码 interaction 标识，跳转地址不会注入额外 HTML", () => {
    const html = renderLoginPageHTML({ ...context, interactionUid: 'id/"<test>' }, [
      redirectOption('/auth/test?value="<test>&other=1'),
    ]);
    expect(html).toContain('href="/interaction/id%2F%22%3Ctest%3E?autoLogin=0"');
    expect(html).toContain('content="3;url=/auth/test?value=&quot;&lt;test&gt;&amp;other=1"');
    expect(html).not.toContain("<test>");
  });
});
