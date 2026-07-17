import type {
  AuditLogInput,
  AuditLogRepository,
  UserMutationAuditContext,
} from "../types/audit.js";
import type { ListOptions, UserInfo, UserRepository } from "../types/auth.js";
import { Logger } from "../utils/Logger.js";
import { sanitizeForLog } from "../utils/logSanitizer.js";

const AUDITED_USER_FIELDS = [
  "username",
  "name",
  "email",
  "picture",
  "phone",
  "authProvider",
  "externalId",
  "emailVerified",
  "phoneVerified",
  "groups",
  "status",
  "roles",
] as const satisfies ReadonlyArray<keyof UserInfo>;

/** 在不让持久化实现感知 HTTP 的前提下，统一记录用户资料变更。 */
export class AuditedUserRepository implements UserRepository {
  private readonly mutationTails = new Map<string, Promise<void>>();

  constructor(
    private readonly delegate: UserRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  findById(sub: string): Promise<UserInfo | null> {
    return this.delegate.findById(sub);
  }

  findByUsername(username: string): Promise<UserInfo | null> {
    return this.delegate.findByUsername(username);
  }

  findByEmail(email: string): Promise<UserInfo | null> {
    return this.delegate.findByEmail(email);
  }

  findByProviderAndExternalId(provider: string, externalId: string): Promise<UserInfo | null> {
    return this.delegate.findByProviderAndExternalId(provider, externalId);
  }

  async findOrCreate(
    provider: string,
    externalId: string,
    userData: Omit<
      UserInfo,
      "id" | "sub" | "createdAt" | "updatedAt" | "externalId" | "authProvider"
    >,
    auditContext: UserMutationAuditContext = { source: "provider" },
  ): Promise<UserInfo> {
    const result = this.delegate.findOrCreateWithResult
      ? await this.delegate.findOrCreateWithResult(provider, externalId, userData)
      : await this.withMutationLock(`identity:${provider}:${externalId}`, async () => {
          const before = await this.delegate.findByProviderAndExternalId(provider, externalId);
          const user = await this.delegate.findOrCreate(provider, externalId, userData);
          return { user, before, created: before === null };
        });
    if (result.created) {
      const user = result.user;
      await this.appendSafely(createMutationRecord("user.created", user, auditContext));
      return user;
    }
    if (result.before) {
      await this.recordUpdate(result.before, result.user, auditContext);
    }
    return result.user;
  }

  async create(
    userData: Omit<UserInfo, "id" | "sub">,
    auditContext: UserMutationAuditContext = { source: "system" },
  ): Promise<UserInfo> {
    const user = await this.delegate.create(userData);
    await this.appendSafely(createMutationRecord("user.created", user, auditContext));
    return user;
  }

  async update(
    sub: string,
    updates: Partial<UserInfo>,
    auditContext: UserMutationAuditContext = { source: "system" },
  ): Promise<UserInfo> {
    const result = this.delegate.updateWithResult
      ? await this.delegate.updateWithResult(sub, updates)
      : await this.withMutationLock(`user:${sub}`, async () => {
          const before = await this.delegate.findById(sub);
          const user = await this.delegate.update(sub, updates);
          return { before, user };
        });
    if (result.before) {
      await this.recordUpdate(result.before, result.user, auditContext, Object.keys(updates));
    }
    return result.user;
  }

  async delete(
    sub: string,
    auditContext: UserMutationAuditContext = { source: "system" },
  ): Promise<void> {
    const deleted = this.delegate.deleteWithResult
      ? (await this.delegate.deleteWithResult(sub)).deleted
      : await this.withMutationLock(`user:${sub}`, async () => {
          const before = await this.delegate.findById(sub);
          await this.delegate.delete(sub);
          return before;
        });
    if (deleted) {
      await this.appendSafely(createMutationRecord("user.deleted", deleted, auditContext));
    }
  }

  list(options?: ListOptions): Promise<UserInfo[]> {
    return this.delegate.list(options);
  }

  async clear(): Promise<void> {
    await this.delegate.clear?.();
  }

  private async recordUpdate(
    before: UserInfo,
    after: UserInfo,
    context: UserMutationAuditContext,
    requestedFields?: string[],
  ): Promise<void> {
    const requested = requestedFields ? new Set(requestedFields) : undefined;
    const changedFields = AUDITED_USER_FIELDS.filter(
      (field) =>
        (!requested || requested.has(field)) &&
        stableValue(before[field]) !== stableValue(after[field]),
    );
    if (changedFields.length === 0) return;

    await this.appendSafely({
      ...createMutationRecord("user.updated", after, context),
      changedFields,
      ...(before.status !== after.status
        ? { statusFrom: before.status, statusTo: after.status }
        : {}),
    });
  }

  private async appendSafely(input: AuditLogInput): Promise<void> {
    try {
      await this.auditLogRepository.append(input);
    } catch (error) {
      Logger.error("[审计日志] 记录用户变更失败:", sanitizeForLog(error));
    }
  }

  private async withMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.mutationTails.set(key, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(key) === tail) {
        this.mutationTails.delete(key);
      }
    }
  }
}

function createMutationRecord(
  eventType: Extract<AuditLogInput["eventType"], "user.created" | "user.updated" | "user.deleted">,
  user: UserInfo,
  context: UserMutationAuditContext,
): AuditLogInput {
  return {
    eventType,
    outcome: "success",
    source: context.source,
    userId: user.sub,
    actorUserId: context.actorUserId,
    username: user.username,
    provider: user.authProvider,
  };
}

function stableValue(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}
