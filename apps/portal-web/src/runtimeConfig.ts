const DEFAULT_PORTAL_BASE_PATH = "/portal";
const DEFAULT_ADMIN_BASE_PATH = "/admin";
const SAFE_BASE_PATH_PATTERN = /^\/(?!\/)[a-zA-Z0-9/_-]*$/u;

/** 规范化服务端注入的站内路径，拒绝外部 URL 和查询参数。 */
export function normalizeBasePath(value: string | undefined, fallback: string): string {
  if (!value || !SAFE_BASE_PATH_PATTERN.test(value)) return fallback;
  return value.replace(/\/+$/u, "") || fallback;
}

const rootDataset = globalThis.document?.documentElement.dataset;

/** 服务端注入的门户部署信息；Vite 开发模式缺少注入时使用默认路径。 */
export const portalRuntimeConfig = Object.freeze({
  basePath: normalizeBasePath(rootDataset?.giteaOidcPortalBasePath, DEFAULT_PORTAL_BASE_PATH),
  adminBasePath: normalizeBasePath(rootDataset?.giteaOidcAdminBasePath, DEFAULT_ADMIN_BASE_PATH),
});

/** 将门户内的绝对子路径拼到当前部署前缀下。 */
export function toPortalPath(path: string): string {
  const suffix = path === "" || path === "/" ? "" : `/${path.replace(/^\/+|\/+$/gu, "")}`;
  return `${portalRuntimeConfig.basePath}${suffix}`;
}

/** 判断返回地址是否仍位于当前门户前缀内。 */
export function isPortalPath(path: string): boolean {
  return (
    path === portalRuntimeConfig.basePath || path.startsWith(`${portalRuntimeConfig.basePath}/`)
  );
}
