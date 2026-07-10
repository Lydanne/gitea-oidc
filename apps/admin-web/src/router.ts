import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { adminRuntimeConfig } from "./runtimeConfig";

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
    path: "/login",
    name: "login",
    component: () => import("./views/LoginView.vue"),
    meta: {
      title: "登录管理台",
      description: "使用本服务 OIDC 进入后台管理系统。",
    } satisfies AdminRouteMeta,
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
    path: "/applications",
    name: "applications",
    component: () => import("./views/ApplicationsView.vue"),
    meta: {
      title: "应用管理",
      description: "创建并管理接入认证系统的应用与 OIDC Client。",
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

/** 管理台路由实例，部署前缀由服务端静态页面注入。 */
export const router = createRouter({
  history: createWebHistory(`${adminRuntimeConfig.basePath}/`),
  routes: adminRoutes,
});

router.beforeEach((to) => {
  if (to.name === "applications" && adminRuntimeConfig.capabilities.applications === false) {
    return { name: "users" };
  }
  return true;
});
