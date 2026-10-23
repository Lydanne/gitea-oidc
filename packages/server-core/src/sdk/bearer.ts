/** 业务 API 只信任受认证的 introspection 结果，不把 UserInfo 成功当作资源授权。 */
export interface XOidcBearerOptions {
  /** 授权服务器的准确 issuer，必须与 introspection 响应中的 iss 一致。 */
  issuer: string;
  /** 当前业务资源的 audience，不能用签发客户端的 client_id 替代。 */
  audience: string;
  introspectionEndpoint: string;
  /** 资源服务器用于 client_secret_basic 的凭据，仅保存在服务端。 */
  clientId: string;
  clientSecret: string;
  requiredScopes?: readonly string[];
  /** 整个 introspection 请求（含响应体）的超时，默认 5 秒。 */
  requestTimeoutMs?: number;
}

export interface XOidcBearerClaims extends Record<string, unknown> {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  scope?: string;
}

const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;
const invalidConfig = () => new Error("Invalid bearer token validation configuration");

function trustedUrl(value: unknown): URL {
  if (typeof value !== "string" || value.trim() !== value) throw invalidConfig();
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw invalidConfig();
  return url;
}

async function readClaims(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Introspection response is too large");
  }
  if (!response.body) throw new Error("Empty introspection response");
  const reader = response.body.getReader();
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Introspection response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function createBearerTokenVerifier(options: XOidcBearerOptions) {
  let issuer: string, audience: string, endpoint: string, authorization: string;
  let scopes: string[], timeout: number;
  try {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw invalidConfig();
    const issuerUrl = trustedUrl(options.issuer);
    const introspectionUrl = trustedUrl(options.introspectionEndpoint);
    if (issuerUrl.origin !== introspectionUrl.origin) throw invalidConfig();
    for (const value of [
      options.issuer,
      options.audience,
      options.clientId,
      options.clientSecret,
    ]) {
      if (
        typeof value !== "string" ||
        !value ||
        value.length > 8192 ||
        value.trim() !== value ||
        Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw invalidConfig();
    }
    if (
      options.requiredScopes !== undefined &&
      (!Array.isArray(options.requiredScopes) ||
        !options.requiredScopes.every(
          (scope) => typeof scope === "string" && SCOPE_TOKEN.test(scope),
        ))
    )
      throw invalidConfig();
    timeout = options.requestTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw invalidConfig();
    issuer = options.issuer;
    audience = options.audience;
    endpoint = introspectionUrl.href;
    scopes = [...(options.requiredScopes ?? [])];
    // OAuth client_secret_basic 要先对 client_id 和 secret 分别执行表单编码。
    const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    authorization = `Basic ${Buffer.from(`${encode(options.clientId)}:${encode(options.clientSecret)}`).toString("base64")}`;
  } catch {
    throw invalidConfig();
  }

  return async (header: unknown): Promise<XOidcBearerClaims | null> => {
    if (typeof header !== "string" || header.length > 65536 || header.trim() !== header)
      return null;
    const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/iu.exec(header);
    if (!match) return null;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: authorization,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ token: match[1], token_type_hint: "access_token" }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const claims = await readClaims(response);
      if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
      const value = claims as Record<string, unknown>;
      const now = Math.floor(Date.now() / 1000);
      const audiences = typeof value.aud === "string" ? [value.aud] : value.aud;
      if (
        value.active !== true ||
        value.iss !== issuer ||
        typeof value.sub !== "string" ||
        !value.sub.trim() ||
        !Array.isArray(audiences) ||
        audiences.length === 0 ||
        !audiences.every((aud) => typeof aud === "string" && aud.length > 0) ||
        !audiences.includes(audience) ||
        !Number.isSafeInteger(value.exp) ||
        (value.exp as number) <= now ||
        (value.nbf !== undefined &&
          (!Number.isSafeInteger(value.nbf) || (value.nbf as number) > now)) ||
        (value.iat !== undefined &&
          (!Number.isSafeInteger(value.iat) || (value.iat as number) > now)) ||
        typeof value.token_type !== "string" ||
        value.token_type.toLowerCase() !== "bearer" ||
        value.cnf !== undefined
      )
        return null;
      if (
        value.scope !== undefined &&
        (typeof value.scope !== "string" ||
          value.scope
            .split(" ")
            .filter(Boolean)
            .some((scope) => !SCOPE_TOKEN.test(scope)))
      )
        return null;
      const granted = new Set(typeof value.scope === "string" ? value.scope.split(" ") : []);
      if (!scopes.every((scope) => granted.has(scope))) return null;
      return value as XOidcBearerClaims;
    } catch {
      // 认证失败与网络异常均不附带 token、客户端凭据或服务端错误细节。
      return null;
    }
  };
}
