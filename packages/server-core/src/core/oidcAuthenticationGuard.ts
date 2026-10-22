import type { KoaContextWithOIDC, Provider } from "oidc-provider";

export interface OidcAuthenticationGuardCoordinator {
  captureAuthenticationGeneration(): Promise<string | undefined>;
  assertAuthenticationGeneration(generation: unknown): Promise<void>;
  validateInteractionAuthentication(proof: unknown, accountId: string): Promise<void>;
}

/** 撤销必须覆盖已经读入内存的请求，以及在撤销后才完成持久化的登录结果。 */
export function registerOidcAuthenticationGuard(
  oidc: Provider,
  coordinator: OidcAuthenticationGuardCoordinator,
): void {
  oidc.use(async (baseContext, next) => {
    const ctx = baseContext as KoaContextWithOIDC;
    let generation: string | undefined;
    try {
      generation = await coordinator.captureAuthenticationGeneration();
      const resumeId = ctx.cookies.get(oidc.cookieName("resume"), { signed: true });
      if (resumeId) {
        const interaction = await oidc.Interaction.find(resumeId);
        if (interaction) {
          try {
            for (const result of [interaction.result, interaction.lastSubmission]) {
              if (!result) continue;
              const proof = result.x_oidc_authentication;
              const accountId = result.login?.accountId ?? readProofUserId(proof);
              if (result.login || result.consent || proof !== undefined) {
                await coordinator.validateInteractionAuthentication(proof, accountId ?? "");
              }
            }
          } catch (error) {
            await interaction.destroy();
            throw error;
          }
        }
      }
    } catch {
      rejectInvalidatedRequest(ctx);
      return;
    }

    // Provider 会先在内层 finally 保存 Session，因此返回客户端前还需再次检查并撤销。
    let requestError: unknown;
    try {
      await next();
    } catch (error) {
      requestError = error;
    }
    try {
      await coordinator.assertAuthenticationGeneration(generation);
    } catch {
      await cleanupInvalidatedRequest(oidc, ctx);
      rejectInvalidatedRequest(ctx);
      return;
    }
    if (requestError) throw requestError;
  });
}

function readProofUserId(proof: unknown): string | undefined {
  if (proof && typeof proof === "object" && "userId" in proof) {
    return typeof proof.userId === "string" ? proof.userId : undefined;
  }
  return undefined;
}

async function cleanupInvalidatedRequest(oidc: Provider, ctx: KoaContextWithOIDC): Promise<void> {
  const session = ctx.oidc?.session;
  const grant = ctx.oidc?.grant;
  const results = await Promise.allSettled([
    session?.destroy(),
    grant
      ? (async () => {
          await grant.destroy();
          await Promise.all([
            oidc.AccessToken.revokeByGrantId(grant.jti),
            oidc.RefreshToken.revokeByGrantId(grant.jti),
            oidc.AuthorizationCode.revokeByGrantId(grant.jti),
            oidc.DeviceCode.revokeByGrantId(grant.jti),
            oidc.BackchannelAuthenticationRequest.revokeByGrantId(grant.jti),
            oidc.PreAuthorizedCode.revokeByGrantId(grant.jti),
          ]);
        })()
      : undefined,
  ]);
  if (results.some((result) => result.status === "rejected")) {
    // 不向客户端或日志带出底层存储错误中的连接信息。
    ctx.app.emit("error", new Error("Failed to clean up invalidated OIDC request"), ctx);
  }
}

function rejectInvalidatedRequest(ctx: KoaContextWithOIDC): void {
  ctx.remove("Location");
  ctx.remove("Set-Cookie");
  ctx.set("Cache-Control", "no-store");
  ctx.status = 400;
  ctx.body = {
    error: "invalid_request",
    error_description: "Authentication changed during this request; please sign in again",
  };
}
