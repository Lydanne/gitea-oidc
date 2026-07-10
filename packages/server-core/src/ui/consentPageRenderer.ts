export interface ConsentPageInput {
  uid: string;
  applicationName: string;
  clientId: string;
  scopes: string[];
  claims?: string[];
  resources?: Array<{
    indicator: string;
    scopes: string[];
  }>;
}

export interface ConsentGrantDisclosure {
  oidcScopes: string[];
  oidcClaims: string[];
  resourceScopes: Array<{ indicator: string; scopes: string[] }>;
}

/** 把 oidc-provider 的 consent details 收敛成展示和 grant 共用的权限集。 */
export function readConsentGrantDisclosure(promptDetails: unknown): ConsentGrantDisclosure {
  const details =
    promptDetails !== null && typeof promptDetails === "object" && !Array.isArray(promptDetails)
      ? (promptDetails as Record<string, unknown>)
      : {};
  const oidcScopes = readUniqueStrings(details.missingOIDCScope);
  const oidcClaims = readUniqueStrings(details.missingOIDCClaims);
  const resourceScopes: ConsentGrantDisclosure["resourceScopes"] = [];
  const missingResourceScopes = details.missingResourceScopes;

  if (
    missingResourceScopes !== null &&
    typeof missingResourceScopes === "object" &&
    !Array.isArray(missingResourceScopes)
  ) {
    for (const [indicator, value] of Object.entries(missingResourceScopes)) {
      const scopes = readUniqueStrings(value);
      if (indicator !== "" && scopes.length > 0) {
        resourceScopes.push({ indicator, scopes });
      }
    }
  }

  return { oidcScopes, oidcClaims, resourceScopes };
}

/** 只渲染结构化、已转义的授权数据，避免应用元数据注入任意 HTML。 */
export function renderConsentPage(input: ConsentPageInput): string {
  const action = `/interaction/${encodeURIComponent(input.uid)}/consent`;
  const scopes = input.scopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("");
  const claims = (input.claims ?? [])
    .map((claim) => `<li><code>${escapeHtml(claim)}</code></li>`)
    .join("");
  const resources = (input.resources ?? [])
    .map(
      ({ indicator, scopes: resourceScopes }) => `<li>
            <code>${escapeHtml(indicator)}</code>
            <ul>${resourceScopes
              .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
              .join("")}</ul>
          </li>`,
    )
    .join("");
  const claimsSection = claims
    ? `<p>还会授予以下 Claim：</p>
      <ul>${claims}</ul>`
    : "";
  const resourcesSection = resources
    ? `<p>还会授予以下 Resource Scope：</p>
      <ul>${resources}</ul>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>确认应用授权</title>
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f7; color: #111; }
      main { width: min(460px, calc(100% - 32px)); padding: 28px; box-sizing: border-box; background: #fff; border: 1px solid #ddd; border-radius: 10px; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { color: #555; line-height: 1.6; overflow-wrap: anywhere; }
      ul { padding-left: 24px; line-height: 1.8; }
      .actions { display: flex; gap: 10px; margin-top: 24px; }
      button { flex: 1; min-height: 42px; border: 1px solid #111; border-radius: 7px; cursor: pointer; }
      button[value="approve"] { background: #111; color: #fff; }
      button[value="deny"] { background: #fff; color: #111; }
    </style>
  </head>
  <body>
    <main>
      <h1>确认应用授权</h1>
      <p><strong>${escapeHtml(input.applicationName)}</strong> 请求访问你的账号。</p>
      <p>Client ID：<code>${escapeHtml(input.clientId)}</code></p>
      <p>将授予以下 OIDC Scope：</p>
      <ul>${scopes}</ul>
      ${claimsSection}
      ${resourcesSection}
      <form method="post" action="${escapeHtml(action)}">
        <div class="actions">
          <button type="submit" name="decision" value="deny">拒绝</button>
          <button type="submit" name="decision" value="approve">允许</button>
        </div>
      </form>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    return (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      } as Record<string, string>
    )[character] as string;
  });
}

function readUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry !== "")),
  ];
}
