/**
 * 本地密码认证插件
 * 支持 htpasswd 格式的密码文件
 */

import { compare } from "bcrypt";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import type {
  AuthContext,
  AuthProvider,
  AuthProviderConfig,
  AuthResult,
  LocalAuthConfig,
  LoginUIResult,
  PluginMetadata,
  StateStore,
  UserInfo,
  UserRepository,
} from "../types/auth.js";
import { PluginPermission } from "../types/auth.js";
import { AuthErrors } from "../utils/authErrors.js";
import { Logger } from "../utils/Logger.js";
import { sanitizeForLog } from "../utils/logSanitizer.js";
import {
  mergeUserGroups,
  userGroupsFromValues,
  withoutUserGroupValues,
} from "../utils/userGroups.js";

export class LocalAuthProvider implements AuthProvider {
  readonly name = "local";
  readonly displayName = "本地密码";

  private config!: LocalAuthConfig;
  private userRepository!: UserRepository;
  private passwordMap = new Map<string, string>(); // username -> hashedPassword
  private loginFailures = new Map<string, { attempts: number; expiresAt: number }>();

  constructor(
    userRepository: UserRepository,
    private readonly stateStore?: StateStore,
  ) {
    this.userRepository = userRepository;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = { ...(config.config as LocalAuthConfig) };

    // 加载密码文件
    await this.loadPasswordFile();
  }

  /**
   * 加载 htpasswd 格式的密码文件
   */
  private async loadPasswordFile(): Promise<void> {
    try {
      const content = await readFile(this.config.passwordFile, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim() && !line.startsWith("#"));

      for (const line of lines) {
        const [username, hash] = line.split(":", 2);
        if (username && hash) {
          const normalizedHash = hash.trim();
          if (!this.isConfiguredFormat(normalizedHash)) {
            throw new Error("password file contains a hash incompatible with passwordFormat");
          }
          this.passwordMap.set(username.trim(), normalizedHash);
        }
      }

      Logger.debug(
        `[LocalAuth] Loaded ${this.passwordMap.size} users from ${this.config.passwordFile}`,
      );
    } catch (err) {
      Logger.error("[LocalAuth] Failed to load password file:", sanitizeForLog(err));
      throw new Error(`Failed to load password file: ${this.config.passwordFile}`);
    }
  }

  canHandle(context: AuthContext): boolean {
    // 检查是否是本地认证请求
    return context.authMethod === this.name || context.body.authMethod === this.name;
  }

  async renderLoginUI(context: AuthContext): Promise<LoginUIResult> {
    const error = context.query.error as string | undefined;

    return {
      type: "html",
      html: `
        <form class="login-form" method="POST" action="/interaction/${this.escapeHtml(encodeURIComponent(context.interactionUid))}/login">
          <input type="hidden" name="authMethod" value="local" />
          
          ${error ? `<div class="error">${this.escapeHtml(error)}</div>` : ""}
          
          <div class="form-group">
            <label for="username">用户名</label>
            <input 
              type="text" 
              id="username" 
              name="username" 
              required 
              autofocus 
              autocomplete="username"
              placeholder="请输入用户名"
            />
          </div>
          
          <div class="form-group">
            <label for="password">密码</label>
            <input 
              type="password" 
              id="password" 
              name="password" 
              required 
              autocomplete="current-password"
              placeholder="请输入密码"
            />
          </div>
          
          <button type="submit" class="submit-button">登录</button>
        </form>
      `,
      showInUnifiedPage: true,
    };
  }

  async authenticate(context: AuthContext): Promise<AuthResult> {
    const { username, password } = context.body;

    if (!username || !password) {
      const missing = [];
      if (!username) missing.push("username");
      if (!password) missing.push("password");
      return {
        success: false,
        error: AuthErrors.missingParameter(missing),
      };
    }

    const lockoutPolicy = this.getLockoutPolicy();
    if (await this.isLocked(username, lockoutPolicy)) {
      // 锁定账号仍执行一次 bcrypt，避免攻击者通过锁定后的响应时间枚举真实用户名。
      await this.verifyBcrypt(password, DUMMY_BCRYPT_HASH);
      return { success: false, error: AuthErrors.invalidCredentials() };
    }

    // 不存在的用户名也执行一次 bcrypt，避免从响应时间推断账户是否存在。
    const hashedPassword = this.passwordMap.get(username);
    if (!hashedPassword) {
      await this.verifyBcrypt(password, DUMMY_BCRYPT_HASH);
      return {
        success: false,
        error: AuthErrors.invalidCredentials(),
      };
    }

    // 验证密码
    const isValid = await this.verifyPassword(password, hashedPassword);
    if (!isValid) {
      await this.recordFailedAttempt(username, lockoutPolicy);
      return {
        success: false,
        error: AuthErrors.invalidCredentials(),
      };
    }

    await this.clearFailedAttempts(username);

    // 查找或创建用户
    const existingUser = this.userRepository.findByProviderAndExternalId
      ? await this.userRepository.findByProviderAndExternalId(this.name, username)
      : null;
    let groups = mergeUserGroups([
      ...withoutUserGroupValues(existingUser?.groups, [ADMIN_GROUP]),
      ...userGroupsFromValues(this.config.defaultGroups ?? []),
    ]);
    if ((this.config.adminUsers ?? []).includes(username)) {
      groups = mergeUserGroups([...groups, ...userGroupsFromValues([ADMIN_GROUP])]);
    }

    const user = await this.userRepository.findOrCreate(this.name, username, {
      username,
      name: username,
      email: `${username}@local`,
      emailVerified: false,
      ...(existingUser ||
      this.config.defaultGroups !== undefined ||
      this.config.adminUsers !== undefined
        ? { groups }
        : {}),
    });

    if (user.status && user.status !== "active") {
      return { success: false, error: AuthErrors.invalidCredentials() };
    }

    return {
      success: true,
      userId: user.sub,
      userInfo: user,
    };
  }

  async getUserInfo(userId: string): Promise<UserInfo | null> {
    return this.userRepository.findById(userId);
  }

  /**
   * 验证密码
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    const format = this.detectPasswordFormat(hash);

    switch (format) {
      case "bcrypt":
        return this.verifyBcrypt(password, hash);

      case "md5":
        return this.verifyMD5(password, hash);

      case "sha":
        return this.verifySHA(password, hash);

      case "plain":
        return password === hash;

      default:
        Logger.error("[LocalAuth] Unknown password format");
        return false;
    }
  }

  /**
   * 检测密码格式
   */
  private detectPasswordFormat(hash: string): "bcrypt" | "md5" | "sha" | "plain" | "unknown" {
    // 显式格式是安全边界，不能因 hash 前缀而被更弱的格式覆盖。
    if (this.config.passwordFormat && this.config.passwordFormat !== "auto") {
      return this.config.passwordFormat;
    }

    if (hash.startsWith("$2y$") || hash.startsWith("$2a$") || hash.startsWith("$2b$")) {
      return "bcrypt";
    }

    if (hash.startsWith("$apr1$")) {
      return "md5";
    }

    if (hash.startsWith("{SHA}")) {
      return "sha";
    }

    // 默认当作明文
    return "plain";
  }

  /**
   * 验证 bcrypt 密码
   */
  private async verifyBcrypt(password: string, hash: string): Promise<boolean> {
    try {
      return await compare(password, hash);
    } catch (err) {
      Logger.error("[LocalAuth] Bcrypt verification error:", sanitizeForLog(err));
      return false;
    }
  }

  /**
   * 验证 MD5 密码（Apache APR1）
   */
  private verifyMD5(password: string, hash: string): boolean {
    // APR1 格式: $apr1$salt$hash
    const parts = hash.split("$");
    if (parts.length !== 4 || parts[1] !== "apr1") {
      return false;
    }

    const salt = parts[2];
    const expectedHash = parts[3];

    // 简化的 APR1 实现（生产环境建议使用专门的库）
    const computed = this.apr1Crypt(password, salt);
    return computed === `$apr1$${salt}$${expectedHash}`;
  }

  /**
   * 验证 SHA 密码
   */
  private verifySHA(password: string, hash: string): boolean {
    // {SHA}base64hash
    const expectedHash = hash.substring(5); // 去掉 {SHA} 前缀
    const computed = createHash("sha1").update(password).digest("base64");
    return computed === expectedHash;
  }

  /**
   * Apache APR1 MD5 校验。实现遵循 htpasswd 的 1000 轮混合与 crypt base64 编码，
   * 仅用于兼容开发环境的历史密码文件；生产环境校验器只允许 bcrypt。
   */
  private apr1Crypt(password: string, salt: string): string {
    const normalizedSalt = salt.split("$")[0].slice(0, 8);
    const passwordBytes = Buffer.from(password);
    const saltBytes = Buffer.from(normalizedSalt);
    const md5 = (chunks: Buffer[]) => createHash("md5").update(Buffer.concat(chunks)).digest();

    let digest = md5([passwordBytes, saltBytes, passwordBytes]);
    const initial: Buffer[] = [passwordBytes, Buffer.from("$apr1$"), saltBytes];
    for (let remaining = passwordBytes.length; remaining > 0; remaining -= 16) {
      initial.push(digest.subarray(0, Math.min(remaining, 16)));
    }
    for (let bits = passwordBytes.length; bits > 0; bits >>= 1) {
      initial.push(bits & 1 ? Buffer.from([0]) : passwordBytes.subarray(0, 1));
    }
    digest = md5(initial);

    for (let round = 0; round < 1000; round++) {
      const chunks: Buffer[] = [];
      chunks.push(round & 1 ? passwordBytes : digest);
      if (round % 3 !== 0) chunks.push(saltBytes);
      if (round % 7 !== 0) chunks.push(passwordBytes);
      chunks.push(round & 1 ? digest : passwordBytes);
      digest = md5(chunks);
    }

    const encoded = [
      encodeApr1Chunk(digest[0], digest[6], digest[12], 4),
      encodeApr1Chunk(digest[1], digest[7], digest[13], 4),
      encodeApr1Chunk(digest[2], digest[8], digest[14], 4),
      encodeApr1Chunk(digest[3], digest[9], digest[15], 4),
      encodeApr1Chunk(digest[4], digest[10], digest[5], 4),
      encodeApr1Chunk(0, 0, digest[11], 2),
    ].join("");
    return `$apr1$${normalizedSalt}$${encoded}`;
  }

  private isConfiguredFormat(hash: string): boolean {
    switch (this.config.passwordFormat) {
      case "bcrypt":
        return /^\$2[aby]\$\d{2}\$/.test(hash);
      case "md5":
        return hash.startsWith("$apr1$");
      case "sha":
        return hash.startsWith("{SHA}");
      case "auto":
        return true;
    }
  }

  private getLockoutPolicy(): Required<NonNullable<LocalAuthConfig["lockoutPolicy"]>> {
    const policy = this.config.lockoutPolicy;
    return {
      enabled: policy?.enabled ?? true,
      maxAttempts: Math.max(1, policy?.maxAttempts ?? 5),
      lockoutDuration: Math.max(1, policy?.lockoutDuration ?? 900),
    };
  }

  private async isLocked(
    username: string,
    policy: Required<NonNullable<LocalAuthConfig["lockoutPolicy"]>>,
  ): Promise<boolean> {
    if (!policy.enabled) return false;
    if (this.stateStore) {
      const attempts = await this.stateStore.get(this.getLockoutKey(username));
      return typeof attempts === "number" && attempts >= policy.maxAttempts;
    }

    const failure = this.loginFailures.get(username);
    if (!failure) return false;
    if (failure.expiresAt <= Date.now()) {
      this.loginFailures.delete(username);
      return false;
    }
    return failure.attempts >= policy.maxAttempts;
  }

  private async recordFailedAttempt(
    username: string,
    policy: Required<NonNullable<LocalAuthConfig["lockoutPolicy"]>>,
  ): Promise<void> {
    if (!policy.enabled) return;
    if (this.stateStore) {
      await this.stateStore.increment(this.getLockoutKey(username), policy.lockoutDuration);
      return;
    }

    const failure = this.loginFailures.get(username);
    this.loginFailures.set(username, {
      attempts: (failure?.attempts ?? 0) + 1,
      expiresAt: Date.now() + policy.lockoutDuration * 1000,
    });
  }

  private async clearFailedAttempts(username: string): Promise<void> {
    if (this.stateStore) {
      await this.stateStore.delete(this.getLockoutKey(username));
      return;
    }
    this.loginFailures.delete(username);
  }

  private getLockoutKey(username: string): string {
    const usernameHash = createHash("sha256").update(username).digest("hex");
    return `local-login-failures:${usernameHash}`;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  getMetadata(): PluginMetadata {
    return {
      name: this.name,
      displayName: this.displayName,
      version: "1.0.0",
      description: "本地密码认证，支持 htpasswd 文件",
      author: "Gitea OIDC Team",
      permissions: [PluginPermission.READ_USER, PluginPermission.CREATE_USER],
    };
  }

  async destroy(): Promise<void> {
    this.passwordMap.clear();
    this.loginFailures.clear();
  }
}

const ADMIN_GROUP = "gitea-oidc-admins";
const DUMMY_BCRYPT_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const APR1_ALPHABET = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function encodeApr1Chunk(a: number, b: number, c: number, length: number): string {
  let value = (a << 16) | (b << 8) | c;
  let encoded = "";
  for (let index = 0; index < length; index++) {
    encoded += APR1_ALPHABET[value & 0x3f];
    value >>>= 6;
  }
  return encoded;
}
