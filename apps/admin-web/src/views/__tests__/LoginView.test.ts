import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import LoginView from "../LoginView.vue";

async function renderLogin(query: string = "") {
  const router = createRouter({
    history: createMemoryHistory("/admin/"),
    routes: [{ path: "/login", component: LoginView }],
  });
  const app = createSSRApp(LoginView);
  app.use(router);
  await router.push(`/login${query}`);
  await router.isReady();
  return renderToString(app);
}

describe("管理台登录页", () => {
  it("使用 shadcn Card 和链接按钮，图标直接输出 SVG", async () => {
    const html = await renderLogin();
    expect(html).toContain('data-slot="card"');
    expect(html).toMatch(/<a[^>]*data-slot="button"/u);
    expect(html).toContain('aria-labelledby="admin-login-title"');
    expect(html).toContain('<h1 id="admin-login-title">登录管理台</h1>');
    expect(html).toContain("<svg");
    expect(html).not.toContain("pi-lock");
    expect(html).not.toContain("<button");
  });

  it("保留登录后的管理台返回位置", async () => {
    const html = await renderLogin("?returnTo=%2Fadmin%2Fapplications");
    expect(html).toContain('href="/admin/login/start?returnTo=%2Fadmin%2Fapplications"');
  });

  it("外部返回地址回退到管理台用户页", async () => {
    const html = await renderLogin("?returnTo=https%3A%2F%2Foutside.example.com");
    expect(html).toContain('href="/admin/login/start?returnTo=%2Fadmin%2Fusers"');
    expect(html).not.toContain("outside.example.com");
  });
});
