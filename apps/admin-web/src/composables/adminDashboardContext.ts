import { type InjectionKey, inject, provide } from "vue";
import type { AdminDashboardContext } from "./useAdminDashboard";

/** 管理台全局状态注入 key。 */
const adminDashboardContextKey: InjectionKey<AdminDashboardContext> =
  Symbol("admin-dashboard-context");

/** 向路由视图提供管理台状态。 */
export const provideAdminDashboard = (context: AdminDashboardContext) => {
  provide(adminDashboardContextKey, context);
};

/** 在管理台页面中读取全局状态。 */
export const useAdminDashboardContext = () => {
  const context = inject(adminDashboardContextKey);
  if (!context) {
    throw new Error("Admin dashboard context is not provided");
  }

  return context;
};
