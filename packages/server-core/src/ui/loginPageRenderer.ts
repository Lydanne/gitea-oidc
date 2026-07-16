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
        <a href="${escapeHtml(redirectUrl)}" class="oauth-button">
          <span class="oauth-icon" aria-hidden="true">
            ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" />` : `<span class="oauth-icon-fallback">${escapeHtml(provider.displayName.slice(0, 1).toUpperCase())}</span>`}
          </span>
          <span class="oauth-label">${escapeHtml(ui.button.text)}</span>
          <svg class="oauth-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3 8h9m-3.5-3.5L12 8l-3.5 3.5" />
          </svg>
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
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
  <title>登录 - X OIDC</title>
  <style>
    :root {
      color-scheme: light;
      --page-background: #ffffff;
      --surface: #ffffff;
      --surface-subtle: #fafafa;
      --foreground: #1d1d1f;
      --muted: #666666;
      --faint: #8f8f8f;
      --border: #eaeaea;
      --border-strong: #d4d4d4;
      --grid-line: rgba(0, 0, 0, 0.045);
      --control-background: #ffffff;
      --control-hover: #fafafa;
      --primary-background: #1d1d1f;
      --primary-hover: #333333;
      --primary-foreground: #ffffff;
      --focus-ring: rgba(0, 112, 243, 0.28);
      --error-background: #fff5f5;
      --error-border: #ffdbdb;
      --error-foreground: #c9242b;
      --shadow: 0 24px 60px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
    }
    * { box-sizing: border-box; }
    html { min-width: 320px; background: var(--page-background); }
    body {
      min-height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-x: hidden;
      padding: 40px 20px;
      background: var(--page-background);
      color: var(--foreground);
      font-family: Geist, "Geist Sans", Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont,
        "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    body::before {
      position: fixed;
      inset: 0;
      content: "";
      pointer-events: none;
      background-image:
        linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
        linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
      background-size: 32px 32px;
      -webkit-mask-image: radial-gradient(circle at center, #000 0%, transparent 72%);
      mask-image: radial-gradient(circle at center, #000 0%, transparent 72%);
    }
    button,
    input { font: inherit; }
    .page-shell {
      position: relative;
      z-index: 1;
      display: grid;
      width: min(100%, 440px);
      gap: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: var(--foreground);
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .brand-mark {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: 7px;
      background: var(--primary-background);
      color: var(--primary-foreground);
      font-family: "Geist Mono", "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.08em;
    }
    .login-card {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .login-header {
      padding: 32px 32px 28px;
      border-bottom: 1px solid var(--border);
      text-align: center;
    }
    .login-header h1 {
      margin: 0;
      color: var(--foreground);
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.04em;
      line-height: 1.25;
    }
    .login-header p {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }
    .login-content { padding: 28px 32px 32px; }
    .login-form { display: grid; gap: 18px; }
    .form-group { display: grid; gap: 8px; }
    .form-group label {
      color: var(--foreground);
      font-size: 14px;
      font-weight: 500;
      line-height: 1.35;
    }
    .form-group input {
      width: 100%;
      height: 44px;
      padding: 0 12px;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      outline: none;
      background: var(--control-background);
      color: var(--foreground);
      font-size: 14px;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }
    .form-group input::placeholder { color: var(--faint); }
    .form-group input:hover { border-color: var(--faint); }
    .form-group input:focus-visible {
      border-color: var(--foreground);
      box-shadow: 0 0 0 3px var(--focus-ring);
    }
    .submit-button {
      width: 100%;
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--primary-background);
      border-radius: 6px;
      background: var(--primary-background);
      color: var(--primary-foreground);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
    }
    .submit-button:hover {
      border-color: var(--primary-hover);
      background: var(--primary-hover);
    }
    .submit-button:active { transform: translateY(1px); }
    .submit-button:focus-visible,
    .oauth-button:focus-visible {
      outline: 2px solid var(--foreground);
      outline-offset: 3px;
    }
    .divider {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 14px;
      margin: 24px 0;
      color: var(--faint);
      font-size: 12px;
      line-height: 1;
    }
    .divider::before,
    .divider::after {
      content: "";
      height: 1px;
      background: var(--border);
    }
    .oauth-buttons { display: grid; gap: 12px; }
    .oauth-button {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) 16px;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0 13px;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      background: var(--control-background);
      color: var(--foreground);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
    }
    .oauth-button:hover {
      border-color: var(--foreground);
      background: var(--control-hover);
    }
    .oauth-button:active { transform: translateY(1px); }
    .oauth-icon {
      display: grid;
      width: 20px;
      height: 20px;
      place-items: center;
    }
    .oauth-icon img {
      display: block;
      width: 20px;
      height: 20px;
      object-fit: contain;
    }
    .oauth-icon-fallback {
      display: grid;
      width: 20px;
      height: 20px;
      place-items: center;
      border: 1px solid var(--border-strong);
      border-radius: 5px;
      background: var(--surface-subtle);
      color: var(--muted);
      font-size: 10px;
      font-weight: 600;
    }
    .oauth-label {
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .oauth-arrow {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.5;
      opacity: 0.52;
      transition: transform 150ms ease, opacity 150ms ease;
    }
    .oauth-button:hover .oauth-arrow {
      opacity: 1;
      transform: translateX(2px);
    }
    .error {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      padding: 11px 12px;
      border: 1px solid var(--error-border);
      border-radius: 6px;
      background: var(--error-background);
      color: var(--error-foreground);
      font-size: 13px;
      line-height: 1.45;
    }
    .error::before {
      display: grid;
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
      place-items: center;
      margin-top: 1px;
      border: 1px solid currentColor;
      border-radius: 50%;
      content: "!";
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
    }
    .empty-state {
      margin: 0;
      padding: 20px 16px;
      border: 1px dashed var(--border-strong);
      border-radius: 8px;
      background: var(--surface-subtle);
      color: var(--muted);
      line-height: 1.6;
      text-align: center;
    }
    .login-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      margin: 0;
      color: var(--faint);
      font-size: 12px;
      line-height: 1.4;
    }
    .login-footer svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.5;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --page-background: #000000;
        --surface: #0a0a0a;
        --surface-subtle: #111111;
        --foreground: #ededed;
        --muted: #a1a1a1;
        --faint: #7a7a7a;
        --border: #262626;
        --border-strong: #3a3a3a;
        --grid-line: rgba(255, 255, 255, 0.06);
        --control-background: #0a0a0a;
        --control-hover: #151515;
        --primary-background: #ededed;
        --primary-hover: #ffffff;
        --primary-foreground: #0a0a0a;
        --focus-ring: rgba(0, 112, 243, 0.4);
        --error-background: #2a1113;
        --error-border: #5f2024;
        --error-foreground: #ff8d94;
        --shadow: 0 24px 60px rgba(0, 0, 0, 0.48);
      }
    }
    @media (max-width: 480px) {
      body { padding: 24px 16px; }
      .page-shell { gap: 20px; }
      .login-header { padding: 28px 24px 24px; }
      .login-content { padding: 24px; }
      .login-header h1 { font-size: 22px; }
    }
    @media (max-height: 680px) {
      body { align-items: flex-start; }
    }
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <div class="brand" aria-label="X OIDC">
      <span class="brand-mark" aria-hidden="true">GO</span>
      <span>X OIDC</span>
    </div>
    <main class="login-card" aria-labelledby="login-title">
      <header class="login-header">
        <h1 id="login-title">继续登录</h1>
        <p>选择一种身份验证方式以继续访问</p>
      </header>
      <div class="login-content">
        ${forms.join("\n")}
        ${forms.length > 0 && buttons.length > 0 ? '<div class="divider" role="separator" aria-label="其他登录方式"><span>或</span></div>' : ""}
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
