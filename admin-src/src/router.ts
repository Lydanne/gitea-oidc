import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

/** 管理台路由元数据。 */
export interface AdminRouteMeta {
  title: string;
  description: string;
}

/** 管理台路由定义。 */
export const adminRoutes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/users",
  },
  {
    path: "/users",
    name: "users",
    component: () => import("./views/UsersView.vue"),
    meta: {
      title: "账号管理",
      description: "管理本服务内的 OIDC 用户、状态、组和角色。",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/providers",
    name: "providers",
    component: () => import("./views/ProvidersView.vue"),
    meta: {
      title: "Provider 状态",
      description: "查看登录 Provider 与统一 Provider API 的注册状态。",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/tokens",
    name: "tokens",
    component: () => import("./views/TokensView.vue"),
    meta: {
      title: "Token 状态",
      description: "查看第三方用户 token 的过期时间、异常状态并手动探活。",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/users",
  },
];

/** 管理台路由实例，部署在 `/admin/` 子路径下。 */
export const router = createRouter({
  history: createWebHistory("/admin/"),
  routes: adminRoutes,
});
