import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalAuthProvider } from "../providers/LocalAuthProvider.js";
import { isSecurityMutation, setSecurityPageHeaders } from "../providers/PasskeyAuthProvider.js";
import { type AccountSecurity, SecurityInputError } from "../security/AccountSecurity.js";
import { accountSecurityPage } from "../security/securityPages.js";
import type { UserInfo } from "../types/auth.js";

/** 共用管理台和门户的 HttpOnly BFF 会话，安全设置始终只操作当前用户。 */
export function registerAccountSecurityRoutes(options: {
  app: FastifyInstance;
  basePath: string;
  security: AccountSecurity;
  localProvider: LocalAuthProvider;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<UserInfo | null>;
}): void {
  const { app, basePath, security, localProvider, requireUser } = options;
  app.get(`${basePath}/security`, async (request, reply) => {
    if (!(await requireUser(request, reply))) return;
    setSecurityPageHeaders(reply);
    return reply.type("text/html").send(accountSecurityPage(basePath));
  });
  app.get(`${basePath}/api/security`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    reply.header("Cache-Control", "no-store");
    return security.summary(user);
  });
  const actions = [
    "password",
    "otp/start",
    "otp/confirm",
    "otp/disable",
    "passkeys/start",
    "passkeys/finish",
    "passkeys/delete",
  ] as const;
  for (const action of actions) {
    app.post(
      `${basePath}/api/security/${action}`,
      { bodyLimit: 64 * 1024 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!isSecurityMutation(request, security.origin))
          return reply.code(403).send({ error: "CSRF protection failed" });
        const user = await requireUser(request, reply);
        if (!user) return;
        if (user.authProvider !== "local" || (await security.requiresPasswordChange(user)))
          return reply.code(403).send({ error: "请先使用本地账号完成密码设置" });
        const body = request.body as Record<string, any> | null;
        if (!body || typeof body !== "object" || Array.isArray(body))
          return reply.code(400).send({ error: "请求参数无效" });
        const binding = createHash("sha256")
          .update(request.headers.cookie ?? "")
          .digest("hex");
        try {
          await security.rateLimit(`settings:${user.id}`);
          const before = (await security.record(user)).value;
          let authorized = before;
          // 确认步骤使用已经过验证且绑定当前会话的一次性挑战，不重复消费 OTP。
          if (action !== "otp/confirm" && action !== "passkeys/finish") {
            if (
              typeof body.password !== "string" ||
              !body.password ||
              Buffer.byteLength(body.password) > 1024 ||
              !(await localProvider.verifyUserPassword(user, body.password))
            ) {
              return reply.code(400).send({ error: "当前密码或动态码无效" });
            }
            const proof = await security.verifySecondFactor(
              user,
              body.otp,
              before?.revision ?? null,
            );
            if (proof === false) return reply.code(400).send({ error: "当前密码或动态码无效" });
            authorized = proof;
          }
          const revision = authorized?.revision ?? null;
          if (action === "password") {
            if (
              typeof body.newPassword !== "string" ||
              body.newPassword !== body.confirmPassword ||
              body.newPassword === body.password
            )
              throw new SecurityInputError("两次新密码必须一致，且不能与当前密码相同");
            await security.changePassword(
              user,
              body.newPassword,
              localProvider.getConfig(),
              revision,
            );
            return {
              ok: true,
              redirectTo: `${basePath}/login/start?returnTo=${encodeURIComponent(`${basePath}/security`)}`,
            };
          } else if (action === "otp/start")
            return await security.beginOtp(user, binding, revision);
          else if (action === "otp/confirm") {
            if (typeof body.id !== "string" || typeof body.token !== "string")
              throw new SecurityInputError("验证码参数无效");
            return await security.confirmOtp(user, binding, body.id, body.token);
          } else if (action === "otp/disable") await security.disableOtp(user, revision);
          else if (action === "passkeys/start")
            return await security.beginRegistration(user, binding, revision);
          else if (action === "passkeys/finish") {
            if (typeof body.id !== "string" || !body.response || typeof body.name !== "string")
              throw new SecurityInputError("Passkey 参数无效");
            await security.finishRegistration(user, binding, body.id, body.response, body.name);
          } else {
            if (typeof body.id !== "string") throw new SecurityInputError("Passkey 参数无效");
            await security.deletePasskey(user, body.id, revision);
          }
          return { ok: true };
        } catch (error) {
          if (!(error instanceof SecurityInputError)) throw error;
          return reply.code(400).send({ error: error.message });
        }
      },
    );
  }
}
