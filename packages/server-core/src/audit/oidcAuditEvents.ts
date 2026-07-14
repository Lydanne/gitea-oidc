import type { Provider } from "oidc-provider";
import type { AuditLogRepository } from "../types/audit.js";
import type { UserInfo, UserRepository } from "../types/auth.js";
import { Logger } from "../utils/Logger.js";
import { sanitizeForLog } from "../utils/logSanitizer.js";

/** 记录 oidc-provider 真正完成的退出事件。 */
export function registerOidcAuditEvents(
  provider: Provider,
  auditLogRepository: AuditLogRepository,
  userRepository?: UserRepository,
): void {
  provider.on("authorization.success", (context: unknown) => {
    void recordSuccessfulAuthorization(context, auditLogRepository, userRepository).catch(
      (error) => {
        Logger.error("[审计日志] 记录 OIDC 登录失败:", sanitizeForLog(error));
      },
    );
  });

  provider.on("end_session.success", (context: unknown) => {
    const event = readLogoutEvent(context);
    if (!event.userId) return;
    void auditLogRepository.append(event).catch((error) => {
      Logger.error("[审计日志] 记录 OIDC 退出失败:", sanitizeForLog(error));
    });
  });
}

async function recordSuccessfulAuthorization(
  context: unknown,
  auditLogRepository: AuditLogRepository,
  userRepository?: UserRepository,
): Promise<void> {
  const event = readSessionEvent(context);
  if (!event.userId || !event.clientId) return;

  let user: UserInfo | null = null;
  if (userRepository) {
    try {
      user = await userRepository.findById(event.userId);
    } catch (error) {
      Logger.error("[审计日志] 读取最终登录用户失败:", sanitizeForLog(error));
    }
    try {
      await userRepository.update(event.userId, { lastLoginAt: new Date() });
    } catch (error) {
      Logger.error("[审计日志] 更新最终登录时间失败:", sanitizeForLog(error));
    }
  }

  await auditLogRepository.append({
    eventType: "user.login",
    outcome: "success",
    source: "oidc",
    ...event,
    username: user?.username,
    provider: user?.authProvider,
  });
}

function readLogoutEvent(context: unknown) {
  return {
    eventType: "user.logout" as const,
    outcome: "success" as const,
    source: "oidc" as const,
    ...readSessionEvent(context),
  };
}

function readSessionEvent(context: unknown) {
  const ctx = context as {
    ip?: unknown;
    headers?: Record<string, unknown>;
    oidc?: {
      session?: { accountId?: unknown; state?: { clientId?: unknown } };
      client?: { clientId?: unknown };
    };
  };
  return {
    userId: readString(ctx?.oidc?.session?.accountId),
    clientId:
      readString(ctx?.oidc?.client?.clientId) ?? readString(ctx?.oidc?.session?.state?.clientId),
    ipAddress: readString(ctx?.ip),
    userAgent: readString(ctx?.headers?.["user-agent"]),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
