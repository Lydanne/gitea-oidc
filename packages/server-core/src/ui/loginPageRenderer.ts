/**
 * 统一登录页渲染器
 */

import type { AuthContext, AuthProvider, LoginUIResult } from "../types/auth.js";

/**
 * 渲染统一登录页 HTML
 * @param context 认证上下文
 * @param loginOptions 登录方式配置
 * @returns 登录页 HTML
 */
export function renderLoginPageHTML(
  context: AuthContext,
  loginOptions: Array<{ provider: AuthProvider; ui: LoginUIResult }>,
): string {
  const forms: string[] = [];
  const buttons: string[] = [];

  for (const { provider, ui } of loginOptions) {
    if (ui.type === "html" && ui.html) {
      forms.push(ui.html);
      continue;
    }

    if (ui.type === "redirect" && ui.button && ui.redirectUrl) {
      const redirectUrl = sanitizeLoginUrl(ui.redirectUrl);
      if (!redirectUrl) {
        continue;
      }
      const iconUrl = ui.button.icon ? sanitizeLoginUrl(ui.button.icon) : "";
      buttons.push(`
        <a href="${escapeHtml(redirectUrl)}" class="oauth-button">
          ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="${escapeHtml(provider.displayName)}" />` : ""}
          <span>${escapeHtml(ui.button.text)}</span>
        </a>
      `);
    }
  }

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - Gitea OIDC</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f4f7f8;
      color: #17202a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .login-container {
      width: min(420px, 100%);
      padding: 32px;
      background: #fff;
      border: 1px solid #d8dee7;
      border-radius: 8px;
      box-shadow: 0 16px 40px rgba(16, 42, 67, 0.08);
    }
    .logo { margin-bottom: 26px; }
    .logo h1 { font-size: 24px; margin-bottom: 8px; }
    .logo p { color: #667085; font-size: 14px; }
    .login-form { margin-bottom: 20px; }
    .form-group { margin-bottom: 16px; }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
      font-weight: 600;
    }
    .form-group input {
      width: 100%;
      padding: 11px 12px;
      border: 1px solid #cfd8e3;
      border-radius: 6px;
      font-size: 14px;
    }
    .form-group input:focus {
      outline: 2px solid rgba(23, 107, 135, 0.18);
      border-color: #176b87;
    }
    .submit-button {
      width: 100%;
      padding: 11px 12px;
      border: 0;
      border-radius: 6px;
      background: #176b87;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
    .submit-button:hover { background: #10566d; }
    .divider {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
      margin: 22px 0;
      color: #667085;
      font-size: 13px;
    }
    .divider::before,
    .divider::after {
      content: "";
      height: 1px;
      background: #d8dee7;
    }
    .oauth-buttons { display: grid; gap: 10px; }
    .oauth-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #cfd8e3;
      border-radius: 6px;
      color: #17202a;
      text-decoration: none;
      font-weight: 600;
    }
    .oauth-button:hover { border-color: #176b87; background: #f3fafb; }
    .oauth-button img { width: 20px; height: 20px; }
    .error {
      padding: 10px 12px;
      margin-bottom: 16px;
      border: 1px solid #fed7aa;
      border-radius: 6px;
      background: #fff7ed;
      color: #c2410c;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main class="login-container">
    <div class="logo">
      <h1>Gitea OIDC</h1>
      <p>统一身份认证平台</p>
    </div>
    ${forms.join("\n")}
    ${forms.length > 0 && buttons.length > 0 ? '<div class="divider"><span>或</span></div>' : ""}
    ${buttons.length > 0 ? `<div class="oauth-buttons">${buttons.join("\n")}</div>` : ""}
  </main>
</body>
</html>
  `.trim();
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (match) => map[match]);
}

function sanitizeLoginUrl(url: string): string | null {
  if (hasControlCharacter(url)) {
    return null;
  }

  if (url.startsWith("/") && !url.startsWith("//")) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}
