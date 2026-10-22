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
    if (ui.showInUnifiedPage === false) {
      continue;
    }

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
        <a href="${escapeHtml(redirectUrl)}" class="oauth-button" data-slot="button" data-variant="outline">
          <span class="oauth-icon" aria-hidden="true">
            ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" />` : `<span class="oauth-icon-fallback">${escapeHtml(provider.displayName.slice(0, 1).toUpperCase())}</span>`}
          </span>
          <span class="oauth-label">${escapeHtml(ui.button.text)}</span>
        </a>
      `);
    }
  }

  const hasLoginOptions = forms.length > 0 || buttons.length > 0;

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
  <title>登录 - X OIDC</title>
  <style>
    /* 与 shadcn-vue neutral 主题保持一致，认证页无需客户端脚本。 */
    :root {
      color-scheme: light;
      --background: #fafafa;
      --card: #fff;
      --foreground: #171717;
      --muted: #737373;
      --subtle: #f5f5f5;
      --border: #e5e5e5;
      --primary: #171717;
      --primary-foreground: #fafafa;
      --ring: #a3a3a3;
      --error-background: #fef2f2;
      --error-border: #fecaca;
      --error-foreground: #b91c1c;
    }
    * {
      box-sizing: border-box;
    }
    html {
      background: var(--background);
    }
    body {
      min-height: 100vh;
      min-height: 100svh;
      display: grid;
      place-items: center;
      margin: 0;
      padding: 32px 20px;
      color: var(--foreground);
      font-family:
        ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial,
        sans-serif;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }
    button,
    input {
      font: inherit;
    }
    .page-shell {
      display: grid;
      gap: 24px;
      width: min(100%, 400px);
      min-width: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
    }
    .brand-mark {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--primary);
      color: var(--primary-foreground);
    }
    .login-card {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--card);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.05);
    }
    .login-header {
      padding: 24px 24px 0;
      text-align: center;
    }
    .login-header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.035em;
      line-height: 1.4;
    }
    .login-header p {
      margin: 8px 0 0;
      color: var(--muted);
      line-height: 1.7;
    }
    .login-content {
      padding: 24px;
    }
    .login-form {
      display: grid;
      gap: 20px;
    }
    .form-group {
      display: grid;
      gap: 9px;
    }
    .form-group label {
      font-weight: 500;
      line-height: 1.4;
    }
    .form-group input {
      width: 100%;
      min-width: 0;
      height: 42px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      outline: none;
      background: transparent;
      color: var(--foreground);
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.03);
      transition:
        border-color 150ms,
        box-shadow 150ms;
    }
    .form-group input::placeholder {
      color: var(--muted);
    }
    .form-group input:focus-visible {
      border-color: var(--ring);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 35%, transparent);
    }
    .submit-button,
    .oauth-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      min-height: 42px;
      padding: 10px 14px;
      border: 1px solid transparent;
      border-radius: 6px;
      font-weight: 500;
      line-height: 1.4;
      text-decoration: none;
      cursor: pointer;
      transition:
        background-color 150ms,
        box-shadow 150ms;
    }
    .submit-button {
      background: var(--primary);
      color: var(--primary-foreground);
    }
    .submit-button:hover {
      background: color-mix(in srgb, var(--primary) 90%, var(--card));
    }
    .submit-button:focus-visible,
    .oauth-button:focus-visible {
      outline: 3px solid var(--ring);
      outline-offset: 3px;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 24px 0;
      color: var(--muted);
      font-size: 12px;
    }
    .divider::before,
    .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--border);
    }
    .oauth-buttons {
      display: grid;
      gap: 12px;
    }
    .oauth-button {
      border-color: var(--border);
      background: var(--card);
      color: var(--foreground);
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.03);
    }
    .oauth-button:hover {
      background: var(--subtle);
    }
    .oauth-icon,
    .oauth-icon img,
    .oauth-icon-fallback {
      display: block;
      flex: 0 0 auto;
      width: 20px;
      height: 20px;
    }
    .oauth-icon img {
      object-fit: contain;
    }
    .oauth-icon-fallback {
      display: grid;
      place-items: center;
      border-radius: 4px;
      background: var(--subtle);
      font-size: 12px;
    }
    .oauth-label {
      overflow-wrap: anywhere;
    }
    .error {
      padding: 12px;
      border: 1px solid var(--error-border);
      border-radius: 6px;
      background: var(--error-background);
      color: var(--error-foreground);
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .empty-state {
      margin: 0;
      padding: 16px;
      border: 1px dashed var(--border);
      border-radius: 6px;
      color: var(--muted);
      text-align: center;
      line-height: 1.7;
    }
    .login-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
      text-align: center;
    }
    .login-footer svg {
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --background: #0a0a0a;
        --card: #171717;
        --foreground: #fafafa;
        --muted: #a3a3a3;
        --subtle: #262626;
        --border: #404040;
        --primary: #fafafa;
        --primary-foreground: #171717;
        --ring: #737373;
        --error-background: #301719;
        --error-border: #7f1d1d;
        --error-foreground: #fca5a5;
      }
    }
    @media (max-width: 480px) {
      body {
        padding: 24px 16px;
      }
      .form-group input {
        font-size: 16px;
      }
      .submit-button,
      .oauth-button {
        min-height: 44px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <div class="brand" aria-label="X OIDC">
      <span class="brand-mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" focusable="false">
          <path d="m6 5 12 14M18 5 6 19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          <path d="M4 12h3m10 0h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </span>
      <span>X OIDC</span>
    </div>
    <main class="login-card" aria-labelledby="login-title" data-slot="card">
      <header class="login-header">
        <h1 id="login-title">登录你的账号</h1>
        <p>欢迎回来，选择一种方式继续。</p>
      </header>
      <div class="login-content">
        ${forms.join("\n")}
        ${forms.length > 0 && buttons.length > 0 ? '<div class="divider" role="separator" aria-label="其他登录方式"><span>或使用其他方式</span></div>' : ""}
        ${buttons.length > 0 ? `<div class="oauth-buttons">${buttons.join("\n")}</div>` : ""}
        ${hasLoginOptions ? "" : '<p class="empty-state" role="status">当前没有可用的登录方式，请联系系统管理员。</p>'}
      </div>
    </main>
    <p class="login-footer">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </svg>
      <span>安全身份认证由 X OIDC 提供</span>
    </p>
  </div>
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

export function sanitizeLoginUrl(url: string): string | null {
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
