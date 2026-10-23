import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { compare, hash } from "bcrypt";
import { TOTP } from "otpauth";
import type { LocalAuthConfig, StateStore, UserInfo, UserRepository } from "../types/auth.js";
import { Logger } from "../utils/Logger.js";
import type { PasswordChangeLifecycle } from "./PasswordChangeRevocations.js";
import {
  newSecurityRecord,
  type SecurityRecord,
  type SecurityRepository,
} from "./SecurityRepository.js";

export class SecurityInputError extends Error {}
const fail = () => new SecurityInputError("验证失败，请检查凭据或重新开始操作");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const TTL = 300;

export class AccountSecurity {
  readonly origin: string;
  readonly rpID: string;
  private bootstrapFile?: string;
  constructor(
    readonly repository: SecurityRepository,
    private stateStore: StateStore,
    private users: UserRepository,
    serverUrl: string,
    private readonly passwordChanges?: PasswordChangeLifecycle,
  ) {
    const url = new URL(serverUrl);
    this.origin = url.origin;
    this.rpID = url.hostname;
  }

  async record(user: UserInfo): Promise<{ key: string; value: SecurityRecord | null }> {
    const bootstrap = await this.repository.get("bootstrap");
    if (bootstrap?.ownerId === user.id) return { key: "bootstrap", value: bootstrap };
    const key = `user:${user.id}`;
    return { key, value: await this.repository.get(key) };
  }

  async requiresPasswordChange(user: UserInfo): Promise<boolean> {
    return (await this.record(user)).value?.mustChangePassword === true;
  }

  async passwordHash(user: UserInfo): Promise<string | undefined> {
    return (await this.record(user)).value?.passwordHash;
  }

  captureAuthenticationVersion(): Promise<number> {
    return this.repository.captureAuthenticationVersion();
  }

  async assertAuthenticationVersion(version: unknown, userId?: string): Promise<void> {
    if (
      !Number.isSafeInteger(version) ||
      (version as number) < 0 ||
      (version as number) > (await this.captureAuthenticationVersion())
    )
      throw fail();
    if (userId !== undefined) {
      const user = await this.users.findById(userId);
      if (
        !user ||
        ((await this.record(user)).value?.authenticationVersion ?? 0) > (version as number)
      )
        throw fail();
    }
  }

  async bootstrap(
    config: LocalAuthConfig,
    passwordUsers: Set<string>,
    adminGroups = ["x-oidc-admins"],
  ): Promise<void> {
    if (config.bootstrapAdmin?.enabled === false) return;
    this.bootstrapFile =
      config.bootstrapAdmin?.credentialsFile ?? `${config.passwordFile}.bootstrap.json`;
    let record = await this.repository.get("bootstrap");
    if (!record) {
      const username = config.adminUsers?.[0] ?? "admin";
      if (
        (config.adminUsers ?? [username]).some((name) => passwordUsers.has(name)) ||
        (await this.users.count()) > 0
      )
        return;
      const group = adminGroups[0];
      if (!group)
        throw new Error("admin.allowedGroups must contain a group to initialize the administrator");
      const password = `Aa1!${randomBytes(24).toString("base64url")}`;
      // 先保存初始化意图；用户创建或最终绑定中断后，可用同一份临时凭据继续。
      const pending: SecurityRecord = {
        ...newSecurityRecord("", username),
        passwordHash: await hash(password, 12),
        mustChangePassword: true,
        bootstrapPassword: password,
        bootstrapPending: true,
        bootstrapGroup: group,
      };
      await this.repository.compareAndSet("bootstrap", null, pending);
      record = await this.repository.get("bootstrap");
    }
    if (!record) throw new Error("Administrator initialization state is unavailable");
    if (record.bootstrapPending) {
      let user = await this.users.findByProviderAndExternalId?.("local", record.username);
      if (!user) {
        try {
          user = await this.users.create({
            authProvider: "local",
            externalId: record.username,
            username: record.username,
            name: record.username,
            email: `${record.username}@local`,
            emailVerified: false,
            metadata: { bootstrapReservation: record.revision },
            groups: [{ id: record.bootstrapGroup!, name: record.bootstrapGroup! }],
          });
        } catch (error) {
          user = await this.users.findByProviderAndExternalId?.("local", record.username);
          if (!user || user.metadata?.bootstrapReservation !== record.revision) throw error;
        }
      }
      if (!user || user.metadata?.bootstrapReservation !== record.revision)
        throw new Error("Administrator initialization conflicts with an existing account");
      const completed = {
        ...record,
        ownerId: user.id,
        bootstrapPending: false,
        revision: randomUUID(),
      };
      await this.repository.compareAndSet("bootstrap", record.revision, completed);
      record = await this.repository.get("bootstrap");
      if (!record || record.bootstrapPending || record.ownerId !== user.id)
        throw new Error("Administrator initialization did not complete; restart to retry");
    }
    if (record.mustChangePassword && record.bootstrapPassword)
      await this.writeBootstrapFile(record);
    else await this.removeBootstrapFile();
  }

  private async writeBootstrapFile(record: SecurityRecord): Promise<void> {
    if (!this.bootstrapFile) return;
    // O_NOFOLLOW 避免已有符号链接将临时凭据写入其他位置；文件永远不进入日志。
    const file = await open(
      this.bootstrapFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.chmod(0o600);
      await file.truncate(0);
      await file.writeFile(
        JSON.stringify({ username: record.username, password: record.bootstrapPassword }, null, 2),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    const current = await this.repository.get("bootstrap");
    if (!current?.mustChangePassword) {
      await this.removeBootstrapFile();
      return;
    }
    Logger.info(`[账号安全] 初始管理员临时凭据已写入 ${this.bootstrapFile}，首次登录必须重设密码`);
  }

  private async removeBootstrapFile(): Promise<void> {
    if (!this.bootstrapFile) return;
    try {
      await unlink(this.bootstrapFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async isBootstrapUser(user: UserInfo): Promise<boolean> {
    return (await this.repository.get("bootstrap"))?.ownerId === user.id;
  }

  async changePassword(
    user: UserInfo,
    password: string,
    config: LocalAuthConfig,
    expectedRevision?: string | null,
  ): Promise<void> {
    validateNewPassword(password, config);
    const record = await this.record(user);
    this.assertRevision(record.value, expectedRevision);
    const saved: SecurityRecord = {
      ...(record.value ?? newSecurityRecord(user.id, user.username)),
      passwordHash: await hash(password, 12),
      mustChangePassword: false,
      bootstrapPassword: undefined,
    };
    const persist = () => this.save(record.key, record.value, saved, true);
    if (this.passwordChanges) await this.passwordChanges.run(user.sub, persist);
    else await persist();
    if (record.key === "bootstrap") await this.removeBootstrapFile();
  }

  /** 所有验证码消费与凭据变更都使用 CAS，覆盖并发请求和多个服务实例。 */
  private async save(
    key: string,
    previous: SecurityRecord | null,
    next: SecurityRecord,
    invalidateAuthentication = false,
  ): Promise<void> {
    next.revision = randomUUID();
    if (
      !(await this.repository.compareAndSet(
        key,
        previous?.revision ?? null,
        next,
        invalidateAuthentication,
      ))
    )
      throw fail();
  }

  private assertRevision(record: SecurityRecord | null, expectedRevision?: string | null): void {
    if (expectedRevision !== undefined && (record?.revision ?? null) !== expectedRevision)
      throw fail();
  }

  async rateLimit(subject: string): Promise<void> {
    if ((await this.stateStore.increment(`account-security:rate:${digest(subject)}`, 300)) > 15) {
      throw new SecurityInputError("尝试次数过多，请稍后再试");
    }
  }

  async verifyOtp(
    user: UserInfo,
    token: unknown,
    expectedRevision?: string | null,
  ): Promise<boolean> {
    return (await this.verifySecondFactor(user, token, expectedRevision)) !== false;
  }

  async verifySecondFactor(
    user: UserInfo,
    token: unknown,
    expectedRevision?: string | null,
  ): Promise<SecurityRecord | null | false> {
    const record = await this.record(user);
    const value = record.value;
    this.assertRevision(value, expectedRevision);
    if (!value?.totpSecret) return value;
    if (typeof token !== "string") return false;
    await this.rateLimit(`otp:${user.id}`);
    const codeHash = digest(token.trim().toLowerCase());
    if (value.recoveryCodeHashes?.includes(codeHash)) {
      const next = {
        ...value,
        recoveryCodeHashes: value.recoveryCodeHashes.filter((item) => item !== codeHash),
      };
      await this.save(record.key, value, next);
      return next;
    }
    const counter = this.otpCounter(value.totpSecret, token);
    if (counter === null || counter <= (value.totpLastCounter ?? -1)) return false;
    const next = { ...value, totpLastCounter: counter };
    await this.save(record.key, value, next);
    return next;
  }

  async assertCurrentRevision(user: UserInfo, revision: string | null): Promise<void> {
    this.assertRevision((await this.record(user)).value, revision);
  }

  private otpCounter(secret: string, token: string): number | null {
    if (!/^\d{6}$/.test(token)) return null;
    const totp = new TOTP({ issuer: "X OIDC", secret, digits: 6, period: 30, algorithm: "SHA1" });
    const timestamp = Date.now();
    const delta = totp.validate({ token, timestamp, window: 1 });
    return delta === null ? null : Math.floor(timestamp / 30000) + delta;
  }

  async summary(user: UserInfo) {
    const record = (await this.record(user)).value;
    return {
      local: user.authProvider === "local",
      otpEnabled: Boolean(record?.totpSecret),
      recoveryCodesRemaining: record?.recoveryCodeHashes?.length ?? 0,
      passkeys: (record?.passkeys ?? []).map(({ id, name, createdAt }) => ({
        id,
        name,
        createdAt,
      })),
    };
  }

  async beginOtp(user: UserInfo, binding: string, expectedRevision?: string | null) {
    const record = await this.record(user);
    this.assertRevision(record.value, expectedRevision);
    if (record.value?.totpSecret) throw new SecurityInputError("OTP 已启用，请先停用后再重新绑定");
    const totp = new TOTP({
      issuer: "X OIDC",
      label: user.username,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    });
    const id = randomBytes(32).toString("hex");
    await this.stateStore.set(
      `account-security:otp:${id}`,
      {
        ownerId: user.id,
        binding: digest(binding),
        secret: totp.secret.base32,
        revision: record.value?.revision ?? null,
      },
      TTL,
    );
    return { id, secret: totp.secret.base32, uri: totp.toString() };
  }

  async confirmOtp(user: UserInfo, binding: string, id: string, token: string) {
    const pending = await this.stateStore.take(`account-security:otp:${id}`);
    if (!pending || pending.ownerId !== user.id || pending.binding !== digest(binding))
      throw fail();
    const counter = this.otpCounter(pending.secret, token);
    const record = await this.record(user);
    if (
      counter === null ||
      (record.value?.revision ?? null) !== pending.revision ||
      record.value?.totpSecret
    )
      throw fail();
    const codes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex"));
    await this.save(
      record.key,
      record.value,
      {
        ...(record.value ?? newSecurityRecord(user.id, user.username)),
        totpSecret: pending.secret,
        totpLastCounter: counter,
        recoveryCodeHashes: codes.map(digest),
      },
      true,
    );
    return { recoveryCodes: codes };
  }

  async disableOtp(user: UserInfo, expectedRevision?: string | null): Promise<void> {
    const record = await this.record(user);
    this.assertRevision(record.value, expectedRevision);
    if (!record.value) throw fail();
    await this.save(
      record.key,
      record.value,
      {
        ...record.value,
        totpSecret: undefined,
        totpLastCounter: undefined,
        recoveryCodeHashes: undefined,
      },
      true,
    );
  }

  private assertPasskeyOrigin(): void {
    if (
      !this.origin.startsWith("https://") &&
      !["localhost", "127.0.0.1", "[::1]"].includes(this.rpID)
    ) {
      throw new SecurityInputError("Passkey 需要 HTTPS 或 localhost 安全上下文");
    }
  }

  async beginRegistration(user: UserInfo, binding: string, expectedRevision?: string | null) {
    this.assertPasskeyOrigin();
    const record = await this.record(user);
    this.assertRevision(record.value, expectedRevision);
    if ((record.value?.passkeys.length ?? 0) >= 10)
      throw new SecurityInputError("最多绑定 10 个 Passkey");
    const options = await generateRegistrationOptions({
      rpName: "X OIDC",
      rpID: this.rpID,
      userName: user.username,
      userID: new Uint8Array(createHash("sha256").update(user.id).digest()),
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: record.value?.passkeys.map(({ id, transports }) => ({ id, transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: [-7, -257],
    });
    const id = randomBytes(32).toString("hex");
    await this.stateStore.set(
      `account-security:register:${id}`,
      {
        ownerId: user.id,
        binding: digest(binding),
        challenge: options.challenge,
        revision: record.value?.revision ?? null,
      },
      TTL,
    );
    return { id, options };
  }

  async finishRegistration(
    user: UserInfo,
    binding: string,
    id: string,
    response: RegistrationResponseJSON,
    name: string,
  ): Promise<void> {
    const pending = await this.stateStore.take(`account-security:register:${id}`);
    if (!pending || pending.ownerId !== user.id || pending.binding !== digest(binding))
      throw fail();
    const record = await this.record(user);
    if ((record.value?.revision ?? null) !== pending.revision) throw fail();
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch {
      throw fail();
    }
    if (!verification.verified) throw fail();
    const credential = verification.registrationInfo.credential;
    const ownershipKey = `passkey:${digest(credential.id)}`;
    let owner = await this.repository.get(ownershipKey);
    if (!owner) {
      await this.repository.compareAndSet(
        ownershipKey,
        null,
        newSecurityRecord(user.id, user.username),
      );
      owner = await this.repository.get(ownershipKey);
    }
    if (owner?.ownerId !== user.id) throw fail();
    if (record.value?.passkeys.some((item) => item.id === credential.id)) throw fail();
    await this.save(
      record.key,
      record.value,
      {
        ...(record.value ?? newSecurityRecord(user.id, user.username)),
        passkeys: [
          ...(record.value?.passkeys ?? []),
          {
            id: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString("base64url"),
            counter: credential.counter,
            transports: credential.transports,
            name: name.trim().slice(0, 80) || "我的 Passkey",
            createdAt: new Date().toISOString(),
          },
        ],
      },
      true,
    );
  }

  async deletePasskey(user: UserInfo, id: string, expectedRevision?: string | null): Promise<void> {
    const record = await this.record(user);
    this.assertRevision(record.value, expectedRevision);
    if (!record.value || !record.value.passkeys.some((item) => item.id === id)) throw fail();
    await this.save(
      record.key,
      record.value,
      {
        ...record.value,
        passkeys: record.value.passkeys.filter((item) => item.id !== id),
      },
      true,
    );
  }

  async createLoginFlow(
    binding: string,
    interactionUid: string,
    generation?: string,
  ): Promise<string> {
    const id = randomBytes(32).toString("hex");
    await this.stateStore.set(
      `account-security:flow:${id}`,
      { binding: digest(binding), interactionUid, generation },
      600,
    );
    return id;
  }

  async readLoginFlow(
    id: string,
    binding: string,
    consume = false,
  ): Promise<{ interactionUid: string; generation?: string }> {
    const key = `account-security:flow:${id}`;
    const flow = consume ? await this.stateStore.take(key) : await this.stateStore.get(key);
    if (!flow || flow.binding !== digest(binding)) throw fail();
    return flow;
  }

  async beginAuthentication(binding: string, interactionUid: string, generation?: string) {
    this.assertPasskeyOrigin();
    const authenticationVersion = await this.captureAuthenticationVersion();
    // 使用可发现凭据，匿名挑战不查询账号，也不返回任何账号的 credential ID。
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: "required",
    });
    const id = randomBytes(32).toString("hex");
    await this.stateStore.set(
      `account-security:authenticate:${id}`,
      {
        binding: digest(binding),
        interactionUid,
        generation,
        challenge: options.challenge,
        authenticationVersion,
      },
      TTL,
    );
    return { id, options };
  }

  async finishAuthentication(
    binding: string,
    interactionUid: string,
    id: string,
    response: AuthenticationResponseJSON,
  ) {
    const pending = await this.stateStore.take(`account-security:authenticate:${id}`);
    if (
      !pending ||
      pending.binding !== digest(binding) ||
      pending.interactionUid !== interactionUid
    )
      throw fail();
    if (typeof response?.id !== "string") throw fail();
    const owner = await this.repository.get(`passkey:${digest(response.id)}`);
    const user = owner ? await this.users.findByRecordId(owner.ownerId) : null;
    if (!user || user.authProvider !== "local" || (user.status && user.status !== "active"))
      throw fail();
    const record = await this.record(user);
    if (!record.value || record.value.mustChangePassword) throw fail();
    // 挑战本身也绑定策略快照，删除凭据、启用 OTP 或改密后不能重用旧挑战。
    await this.assertAuthenticationVersion(pending.authenticationVersion, user.sub);
    const credential = record.value.passkeys.find((item) => item.id === response.id);
    if (!credential) throw fail();
    const expectedHandle = createHash("sha256").update(user.id).digest("base64url");
    if (response.response?.userHandle !== expectedHandle) throw fail();
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          ...credential,
          publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
        },
      });
    } catch {
      throw fail();
    }
    if (!verification.verified) throw fail();
    await this.save(record.key, record.value, {
      ...record.value,
      passkeys: record.value.passkeys.map((item) =>
        item.id === credential.id
          ? { ...item, counter: verification.authenticationInfo.newCounter }
          : item,
      ),
    });
    return { user, generation: pending.generation as string | undefined };
  }
}

export function validateNewPassword(password: string, config: LocalAuthConfig): void {
  const policy = config.passwordPolicy;
  const minLength = Math.max(12, policy?.minLength ?? 12);
  if (
    password.length < minLength ||
    Buffer.byteLength(password) > 72 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new SecurityInputError(
      `新密码至少 ${minLength} 位、最多 72 字节，须包含大小写字母、数字和特殊字符`,
    );
  }
}

export async function verifyManagedPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(password, passwordHash);
}
