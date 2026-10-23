import type { OidcAccountBlockLease } from "../adapters/oidcClientRevocationBarrier.js";
import type { BffSessionBlockLease } from "../sessions/BffSessionRevocations.js";

export interface PasswordChangeLifecycle {
  run(accountId: string, persistPassword: () => Promise<void>): Promise<void>;
}

/** 改密只持有临时租约，不释放并发停用账号等操作持有的封锁。 */
export class PasswordChangeRevocations implements PasswordChangeLifecycle {
  constructor(
    private readonly sessions: {
      blockUser(
        accountId: string,
        invalidateAllLogins?: boolean,
      ): BffSessionBlockLease | Promise<BffSessionBlockLease>;
    },
    private readonly oidc: {
      acquireBlock(accountId: string): OidcAccountBlockLease | Promise<OidcAccountBlockLease>;
      revoke(accountId: string): Promise<void>;
    },
  ) {}

  async run(accountId: string, persistPassword: () => Promise<void>): Promise<void> {
    const oidcLease = await this.oidc.acquireBlock(accountId);
    let sessionLease: BffSessionBlockLease | undefined;
    const errors: unknown[] = [];
    try {
      // 只撤销当前账号的 BFF 会话；凭据版本随密码原子提交，不轮换其他账号的登录代际。
      sessionLease = await this.sessions.blockUser(accountId, false);
      await this.oidc.revoke(accountId);
      await persistPassword();
    } catch (error) {
      errors.push(error);
    } finally {
      // 任一释放失败都不能阻止另一租约清理，也不能把改密报告为成功。
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => oidcLease.release()),
        Promise.resolve().then(() => sessionLease?.release()),
      ]);
      for (const result of cleanup) {
        if (result.status === "rejected") errors.push(result.reason);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Password change revocation failed");
  }
}
