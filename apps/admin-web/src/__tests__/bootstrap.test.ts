import { expect, it, vi } from "vitest";

const startup = vi.hoisted(() => {
  let resolveRoute!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveRoute = resolve;
  });
  const app = { use: vi.fn(), mount: vi.fn() };
  return { app, ready, resolveRoute };
});

vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  createApp: vi.fn(() => startup.app),
}));
vi.mock("../App.vue", () => ({ default: {} }));
vi.mock("../router", () => ({ router: { isReady: () => startup.ready } }));

it("初始路由解析前不挂载页面，防止公开登录页提前触发鉴权跳转", async () => {
  await import("../main");
  expect(startup.app.mount).not.toHaveBeenCalled();
  startup.resolveRoute();
  await startup.ready;
  expect(startup.app.mount).toHaveBeenCalledExactlyOnceWith("#app");
});
