import { isPortalPath, portalRuntimeConfig, toPortalPath } from "../runtimeConfig";
import type { PortalApplication, PortalSession } from "../types/portal";

const portalApiBase = `${portalRuntimeConfig.basePath}/api`;
const portalActionHeader = "X-Gitea-OIDC-Portal-Action";
let loginRedirectStarted = false;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function parsePortalSession(value: unknown): PortalSession {
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    typeof value.user.sub !== "string" ||
    typeof value.admin !== "boolean" ||
    typeof value.basePath !== "string" ||
    typeof value.adminBasePath !== "string"
  ) {
    throw new Error("门户会话响应格式无效");
  }
  return value as unknown as PortalSession;
}

function parsePortalApplications(value: unknown): PortalApplication[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.launchUrl !== "string" ||
        typeof item.order !== "number" ||
        !Number.isInteger(item.order) ||
        item.order < 0 ||
        item.order > 1_000_000 ||
        (item.description !== undefined && typeof item.description !== "string") ||
        (item.iconUrl !== undefined && typeof item.iconUrl !== "string")
      ) {
        return true;
      }
      return (
        !isAbsoluteHttpUrl(item.launchUrl) ||
        (typeof item.iconUrl === "string" && !isAbsoluteHttpUrl(item.iconUrl))
      );
    })
  ) {
    throw new Error("门户应用响应格式无效");
  }
  return value as PortalApplication[];
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !value.includes("*")
    );
  } catch {
    return false;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  if (!text) return `请求失败（${response.status}）`;

  try {
    const body = JSON.parse(text) as unknown;
    if (isRecord(body) && typeof body.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
    if (isRecord(body) && typeof body.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
  } catch {
    // 非 JSON 错误正文直接按纯文本展示。
  }
  return text;
}

/** 跳转到门户登录入口；returnTo 只能是门户内部路径。 */
export function redirectToPortalLogin(returnTo?: string): void {
  if (loginRedirectStarted) return;
  loginRedirectStarted = true;

  const currentPath = returnTo ?? `${globalThis.location.pathname}${globalThis.location.search}`;
  const safeReturnTo = isPortalPath(currentPath) ? currentPath : portalRuntimeConfig.basePath;
  const loginUrl = `${toPortalPath("/login/start")}?returnTo=${encodeURIComponent(safeReturnTo)}`;
  globalThis.location.assign(loginUrl);
}

/** 统一处理门户 API 请求和失效会话。 */
export async function portalApiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${portalApiBase}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401) {
    redirectToPortalLogin();
    return null;
  }

  if (!response.ok) throw new Error(await readErrorMessage(response));
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
}

/** 获取当前门户会话。 */
export async function fetchPortalSession(): Promise<PortalSession | null> {
  const response = await portalApiRequest("/me");
  return response === null ? null : parsePortalSession(response);
}

/** 获取当前用户可见的应用目录。 */
export async function fetchPortalApplications(): Promise<PortalApplication[] | null> {
  const response = await portalApiRequest("/applications");
  return response === null ? null : parsePortalApplications(response);
}

/** 清理门户会话，并进入服务端生成的 OIDC 退出流程。 */
export async function logoutPortal(): Promise<void> {
  const response = await fetch(toPortalPath("/logout"), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [portalActionHeader]: "logout",
    },
    body: "{}",
  });

  if (!response.ok && response.status !== 401) {
    throw new Error(await readErrorMessage(response));
  }
  if (response.status === 401) {
    redirectToPortalLogin(portalRuntimeConfig.basePath);
    return;
  }

  const body = (await response.json()) as unknown;
  if (!isRecord(body) || body.ok !== true || typeof body.redirectTo !== "string") {
    throw new Error("门户退出响应格式无效");
  }
  const redirectUrl = new URL(body.redirectTo, globalThis.location.origin);
  if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
    throw new Error("门户退出地址无效");
  }
  globalThis.location.assign(body.redirectTo);
}
