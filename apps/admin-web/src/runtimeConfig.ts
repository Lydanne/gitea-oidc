const DEFAULT_ADMIN_BASE_PATH = "/admin";

function normalizeAdminBasePath(value: string | undefined): string {
  if (!value || !/^\/[a-zA-Z0-9/_-]*$/u.test(value)) {
    return DEFAULT_ADMIN_BASE_PATH;
  }
  return value.replace(/\/+$/u, "") || DEFAULT_ADMIN_BASE_PATH;
}

const rootDataset = globalThis.document?.documentElement.dataset;
const applicationsAttribute = rootDataset?.giteaOidcApplicationsEnabled;

/** 服务端注入的管理台部署信息；Vite 开发模式缺少注入时回退到 `/admin`。 */
export const adminRuntimeConfig = Object.freeze({
  basePath: normalizeAdminBasePath(rootDataset?.giteaOidcAdminBasePath),
  capabilities: Object.freeze({
    applications:
      applicationsAttribute === undefined ? undefined : applicationsAttribute === "true",
  }),
});

/** 将管理台内的绝对子路径拼到当前部署前缀下。 */
export function toAdminPath(path: string): string {
  const suffix = path === "" || path === "/" ? "" : `/${path.replace(/^\/+|\/+$/gu, "")}`;
  return `${adminRuntimeConfig.basePath}${suffix}`;
}

/** 判断返回地址是否仍位于当前管理台前缀内。 */
export function isAdminPath(path: string): boolean {
  return path === adminRuntimeConfig.basePath || path.startsWith(`${adminRuntimeConfig.basePath}/`);
}
