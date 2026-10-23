const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

export function securityPage(title: string, content: string, interactive = false): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · X OIDC</title><link rel="stylesheet" href="/security/security.css">${interactive ? '<script defer src="/security/security.js"></script>' : ""}</head><body><main><a class="brand" href="/">X OIDC</a><h1>${escapeHtml(title)}</h1>${content}<p id="message" role="status" aria-live="polite"></p></main></body></html>`;
}

export function passwordChangePage(uid: string, username: string, error?: string): string {
  return securityPage(
    "重设初始密码",
    `<p>首次登录必须重设密码，完成后使用新密码重新登录。</p>${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<form method="post" action="/interaction/${encodeURIComponent(uid)}/login"><input type="hidden" name="authMethod" value="local"><label>用户名<input name="username" autocomplete="username" value="${escapeHtml(username)}" readonly required></label><label>当前临时密码<input type="password" name="password" autocomplete="current-password" required autofocus></label><label>新密码<input type="password" name="newPassword" autocomplete="new-password" minlength="12" maxlength="72" required></label><label>确认新密码<input type="password" name="confirmPassword" autocomplete="new-password" minlength="12" maxlength="72" required></label><p>至少 12 位，包含大小写字母、数字和特殊字符；不能与临时密码相同。</p><button type="submit">重设密码并退出旧会话</button></form>`,
  );
}

export function passwordChangedPage(restartUrl: string): string {
  return securityPage(
    "密码已更新",
    `<p>已有会话和改密前的登录结果已失效，请使用新密码重新登录。</p><a href="${escapeHtml(restartUrl)}">使用新密码重新登录</a>`,
  );
}

export function passkeyLoginPage(uid: string, flow: string): string {
  return securityPage(
    "使用 Passkey 登录",
    `<form id="passkey-login" data-flow="${escapeHtml(flow)}"><p>使用已绑定的设备、指纹或安全密钥验证身份。</p><label>用户名<input name="username" autocomplete="username webauthn" required autofocus maxlength="200"></label><button type="submit">使用 Passkey 登录</button></form><a href="/interaction/${encodeURIComponent(uid)}?autoLogin=0">返回其他登录方式</a>`,
    true,
  );
}

export function accountSecurityPage(basePath: string): string {
  return securityPage(
    "账号安全",
    `<div id="account-security" data-base="${escapeHtml(basePath)}"><p>管理本地账号的密码、动态验证码和 Passkey。</p><p id="security-status">正在加载…</p><section id="security-controls" hidden><h2>验证当前身份</h2><p>每次修改安全设置前，需要填写当前密码；已启用 OTP 时还需动态码或恢复码。</p><label>当前密码<input id="current-password" type="password" autocomplete="current-password"></label><label>动态码或恢复码<input id="current-otp" autocomplete="one-time-code" maxlength="32"></label><h2>密码</h2><form id="change-password"><label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label><label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label><p>至少 12 位，包含大小写字母、数字和特殊字符。</p><p>更新后会退出所有设备，需要使用新密码重新登录。</p><button>更新密码并退出所有会话</button></form><h2>OTP 动态验证码</h2><button id="begin-otp" type="button">绑定认证器</button><button id="disable-otp" type="button" hidden>停用 OTP</button><div id="otp-setup" hidden><p>在认证器中手动添加以下密钥（时间型、6 位、30 秒）。</p><code id="otp-secret"></code><details><summary>显示 otpauth 链接</summary><code id="otp-uri"></code></details><form id="confirm-otp"><label>认证器动态码<input name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label><button>确认并启用 OTP</button></form></div><div id="recovery" hidden><h3>保存恢复码</h3><p>每个恢复码只能使用一次。此列表只显示一次，请保存到密码管理器。</p><pre id="recovery-codes"></pre><button id="hide-recovery" type="button">我已保存，隐藏恢复码</button></div><h2>Passkey</h2><p>Passkey 登录将使用设备的指纹、面容或 PIN，无需密码和动态码。</p><label>设备名称<input id="passkey-name" maxlength="80" placeholder="例如：工作电脑"></label><button id="register-passkey" type="button">添加 Passkey</button><ul id="passkeys"></ul></section></div><a href="${escapeHtml(basePath)}">返回</a>`,
    true,
  );
}
