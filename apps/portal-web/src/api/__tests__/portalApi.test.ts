import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("门户 API", () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("location", {
      pathname: "/portal",
      search: "",
      origin: "https://id.example.com",
      assign,
    });
    assign.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("读取用户会话和可见应用", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: { sub: "user-1", name: "测试用户" },
            admin: true,
            basePath: "/portal",
            adminBasePath: "/admin",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "gitea", name: "Gitea", launchUrl: "https://git.example.com", order: 1 },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchPortalApplications, fetchPortalSession } = await import("../portalApi");

    await expect(fetchPortalSession()).resolves.toMatchObject({
      user: { sub: "user-1" },
      admin: true,
    });
    await expect(fetchPortalApplications()).resolves.toEqual([
      { id: "gitea", name: "Gitea", launchUrl: "https://git.example.com", order: 1 },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/portal/api/me",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("会话失效时跳转到登录入口并保留门户内返回地址", async () => {
    vi.stubGlobal("location", {
      pathname: "/portal/apps",
      search: "?tab=all",
      origin: "https://id.example.com",
      assign,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const { fetchPortalSession } = await import("../portalApi");

    await expect(fetchPortalSession()).resolves.toBeNull();
    expect(assign).toHaveBeenCalledWith(
      "/portal/login/start?returnTo=%2Fportal%2Fapps%3Ftab%3Dall",
    );
  });

  it("退出时携带动作头并进入服务端返回的 OIDC 退出流程", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          redirectTo: "https://id.example.com/oidc/session/end?post_logout_redirect_uri=signed-out",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { logoutPortal } = await import("../portalApi");

    await logoutPortal();

    expect(fetchMock).toHaveBeenCalledWith(
      "/portal/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: "{}",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Gitea-OIDC-Portal-Action": "logout",
        }),
      }),
    );
    expect(assign).toHaveBeenCalledWith(
      "https://id.example.com/oidc/session/end?post_logout_redirect_uri=signed-out",
    );
  });

  it("显示服务端错误字段并拒绝不安全的应用投影", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "应用目录暂不可用" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { id: "unsafe", name: "危险入口", launchUrl: "javascript:alert(1)", order: 0 },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );
    const { fetchPortalApplications } = await import("../portalApi");

    await expect(fetchPortalApplications()).rejects.toThrow("应用目录暂不可用");
    await expect(fetchPortalApplications()).rejects.toThrow("门户应用响应格式无效");
  });
});
