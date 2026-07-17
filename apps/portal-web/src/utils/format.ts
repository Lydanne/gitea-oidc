import type { PortalUser } from "../types/portal";

/** 选择稳定且易读的门户用户显示名。 */
export function formatUserName(user: PortalUser): string {
  const candidates = [user.name, user.username, user.email?.split("@")[0]];
  return candidates.find((value) => value?.trim())?.trim() ?? "用户";
}

/** 从 Unicode 显示名中取首个字符作为图片回退。 */
export function formatInitial(value: string): string {
  return Array.from(value.trim())[0]?.toLocaleUpperCase() ?? "?";
}

/** 仅允许浏览器跳转到 HTTP(S) 或同源相对地址。 */
export function toSafeLaunchUrl(value: string, origin = "http://localhost"): string | null {
  try {
    const parsed = new URL(value, origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
}
