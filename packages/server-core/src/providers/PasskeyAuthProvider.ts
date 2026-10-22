import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthCoordinator } from "../core/AuthCoordinator.js";
import { type AccountSecurity, SecurityInputError } from "../security/AccountSecurity.js";
import { passkeyLoginPage } from "../security/securityPages.js";
import type {
  AuthContext,
  AuthProvider,
  AuthProviderConfig,
  AuthResult,
  LoginUIResult,
  PluginRoute,
  UserRepository,
} from "../types/auth.js";
import { PluginPermission } from "../types/auth.js";
import { AuthErrors } from "../utils/authErrors.js";

function cookieName(secure: boolean): string {
  return `${secure ? "__Host-" : ""}x_oidc_passkey_login`;
}
export function passkeyBinding(request: FastifyRequest, secure = false): string | undefined {
  const name = cookieName(secure);
  const value = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function setSecurityPageHeaders(reply: FastifyReply, interactive = true): void {
  reply.header("Cache-Control", "no-store");
  reply.header(
    "Content-Security-Policy",
    `default-src 'none'; script-src ${interactive ? "'self'" : "'none'"}; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  );
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "same-origin");
}

export function isSecurityMutation(request: FastifyRequest, origin: string): boolean {
  return (
    request.headers.origin === origin &&
    request.headers["x-oidc-security"] === "1" &&
    request.headers["content-type"]?.split(";")[0]?.trim() === "application/json"
  );
}

export class PasskeyAuthProvider implements AuthProvider {
  readonly name = "passkey";
  readonly displayName = "Passkey";
  constructor(
    private security: AccountSecurity,
    private coordinator: AuthCoordinator,
    private userRepository: UserRepository,
  ) {}
  async initialize(_config: AuthProviderConfig): Promise<void> {}
  canHandle(): boolean {
    return false;
  }
  async authenticate(): Promise<AuthResult> {
    return { success: false, error: AuthErrors.invalidCredentials() };
  }
  async getUserInfo(userId: string) {
    return this.userRepository.findById(userId);
  }
  async renderLoginUI(context: AuthContext): Promise<LoginUIResult> {
    const secure = this.security.origin.startsWith("https:");
    const binding = passkeyBinding(context.request, secure) ?? randomBytes(32).toString("hex");
    const previous = context.reply.getHeader("set-cookie");
    context.reply.header("Set-Cookie", [
      ...(Array.isArray(previous) ? previous : typeof previous === "string" ? [previous] : []),
      `${cookieName(secure)}=${binding}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600${secure ? "; Secure" : ""}`,
    ]);
    // Interaction Cookie 仅发送到 /interaction/:uid，插件入口复用从合法交互创建的浏览器绑定流程。
    const flow = await this.security.createLoginFlow(
      binding,
      context.interactionUid,
      await this.coordinator.captureAuthenticationGeneration(),
    );
    return {
      type: "redirect",
      redirectUrl: `/auth/passkey/login?flow=${encodeURIComponent(flow)}`,
      showInUnifiedPage: true,
      button: { text: "使用 Passkey 登录" },
    };
  }
  registerRoutes(): PluginRoute[] {
    return [
      {
        method: "GET",
        path: "/login",
        handler: async (request, reply) => {
          setSecurityPageHeaders(reply);
          const flow = (request.query as { flow?: string }).flow;
          const binding = passkeyBinding(request, this.security.origin.startsWith("https:"));
          if (typeof flow !== "string" || !binding)
            return reply.code(400).send("Invalid interaction");
          try {
            const pending = await this.security.readLoginFlow(flow, binding);
            return reply.type("text/html").send(passkeyLoginPage(pending.interactionUid, flow));
          } catch (error) {
            if (!(error instanceof SecurityInputError)) throw error;
            return reply.code(400).send("Invalid interaction");
          }
        },
      },
      ...(["options", "verify"] as const).map(
        (action): PluginRoute => ({
          method: "POST",
          path: `/${action}`,
          handler: async (request, reply) => {
            setSecurityPageHeaders(reply);
            if (!isSecurityMutation(request, this.security.origin))
              return reply.code(403).send({ error: "CSRF protection failed" });
            const body = request.body as Record<string, any> | null;
            const binding = passkeyBinding(request, this.security.origin.startsWith("https:"));
            if (!binding || !body || typeof body.flow !== "string")
              return reply.code(400).send({ error: "登录会话已过期" });
            try {
              await this.security.rateLimit(`passkey:${request.ip}`);
              const pending = await this.security.readLoginFlow(body.flow, binding);
              await this.coordinator.assertAuthenticationGeneration(pending.generation);
              if (action === "options") {
                if (
                  typeof body.username !== "string" ||
                  !body.username ||
                  body.username.length > 200
                )
                  return reply.code(400).send({ error: "请输入用户名" });
                return await this.security.beginAuthentication(
                  body.username,
                  binding,
                  pending.interactionUid,
                  pending.generation,
                );
              }
              if (typeof body.id !== "string" || !body.response)
                return reply.code(400).send({ error: "验证参数无效" });
              const result = await this.security.finishAuthentication(
                binding,
                pending.interactionUid,
                body.id,
                body.response,
              );
              await this.security.readLoginFlow(body.flow, binding, true);
              await this.coordinator.assertAuthenticationGeneration(result.generation);
              await this.coordinator.storeAuthResult(
                pending.interactionUid,
                result.user.sub,
                {
                  provider: this.name,
                  ipAddress: request.ip,
                  userAgent: request.headers["user-agent"],
                },
                result.generation,
              );
              return {
                redirectTo: `/interaction/${encodeURIComponent(pending.interactionUid)}/complete`,
              };
            } catch (error) {
              if (!(error instanceof SecurityInputError)) throw error;
              await this.coordinator.recordAuthenticationEvent({
                provider: this.name,
                outcome: "failure",
                reason: "invalid_passkey",
                ipAddress: request.ip,
                userAgent: request.headers["user-agent"],
              });
              return reply.code(400).send({ error: error.message });
            }
          },
        }),
      ),
    ];
  }
  getMetadata() {
    return {
      name: this.name,
      displayName: this.displayName,
      version: "1.0.0",
      permissions: [PluginPermission.READ_USER, PluginPermission.REGISTER_ROUTES],
    };
  }
}
