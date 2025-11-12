/**
 * 本地密码认证插件
 * 支持 htpasswd 格式的密码文件
 */

import { readFile } from 'fs/promises';
import { compare } from 'bcrypt';
import { createHash } from 'crypto';
import type {
  AuthProvider,
  AuthContext,
  AuthResult,
  LoginUIResult,
  UserInfo,
  UserRepository,
  AuthProviderConfig,
  LocalAuthConfig,
  PluginMetadata,
} from '../types/auth';
import { PluginPermission } from '../types/auth';
import { Logger } from '../utils/Logger';
import { AuthErrors } from '../utils/authErrors';

export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local';
  readonly displayName = '本地密码';

  private config!: LocalAuthConfig;
  private userRepository!: UserRepository;
  private passwordMap = new Map<string, string>(); // username -> hashedPassword

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config.config as LocalAuthConfig;

    // 加载密码文件
    await this.loadPasswordFile();
  }

  /**
   * 加载 htpasswd 格式的密码文件
   */
  private async loadPasswordFile(): Promise<void> {
    try {
      const content = await readFile(this.config.passwordFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));

      for (const line of lines) {
        const [username, hash] = line.split(':', 2);
        if (username && hash) {
          this.passwordMap.set(username.trim(), hash.trim());
        }
      }

      Logger.info(`[LocalAuth] Loaded ${this.passwordMap.size} users from ${this.config.passwordFile}`);
    } catch (err) {
      Logger.error('[LocalAuth] Failed to load password file:', err);
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
      type: 'html',
      html: `
        <form class="login-form" method="POST" action="/interaction/${context.interactionUid}/login">
          <input type="hidden" name="authMethod" value="local" />
          
          ${error ? `<div class="error">${this.escapeHtml(error)}</div>` : ''}
          
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
      if (!username) missing.push('username');
      if (!password) missing.push('password');
      return {
        success: false,
        error: AuthErrors.missingParameter(missing),
      };
    }

    // 检查用户是否存在
    const hashedPassword = this.passwordMap.get(username);
    if (!hashedPassword) {
      return {
        success: false,
        error: AuthErrors.invalidCredentials({ username }),
      };
    }

    // 验证密码
    const isValid = await this.verifyPassword(password, hashedPassword);
    if (!isValid) {
      return {
        success: false,
        error: AuthErrors.passwordIncorrect(username),
      };
    }

    // 查找或创建用户
    const user = await this.userRepository.findOrCreate(
      {
        provider: this.name,
        externalId: username,
      },
      {
        username,
        name: username,
        email: `${username}@local`,
        authProvider: this.name,
        email_verified: false,
        metadata: {
          externalId: username,
        },
      }
    );

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
      case 'bcrypt':
        return this.verifyBcrypt(password, hash);
      
      case 'md5':
        return this.verifyMD5(password, hash);
      
      case 'sha':
        return this.verifySHA(password, hash);
      
      case 'plain':
        return password === hash;
      
      default:
        Logger.error('[LocalAuth] Unknown password format:', hash);
        return false;
    }
  }

  /**
   * 检测密码格式
   */
  private detectPasswordFormat(hash: string): 'bcrypt' | 'md5' | 'sha' | 'plain' | 'unknown' {
    if (hash.startsWith('$2y$') || hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
      return 'bcrypt';
    }
    
    if (hash.startsWith('$apr1$')) {
      return 'md5';
    }
    
    if (hash.startsWith('{SHA}')) {
      return 'sha';
    }
    
    // 如果配置指定了格式
    if (this.config.passwordFormat && this.config.passwordFormat !== 'auto') {
      return this.config.passwordFormat;
    }
    
    // 默认当作明文
    return 'plain';
  }

  /**
   * 验证 bcrypt 密码
   */
  private async verifyBcrypt(password: string, hash: string): Promise<boolean> {
    try {
      return await compare(password, hash);
    } catch (err) {
      Logger.error('[LocalAuth] Bcrypt verification error:', err);
      return false;
    }
  }

  /**
   * 验证 MD5 密码（Apache APR1）
   */
  private verifyMD5(password: string, hash: string): boolean {
    // APR1 格式: $apr1$salt$hash
    const parts = hash.split('$');
    if (parts.length !== 4 || parts[1] !== 'apr1') {
      return false;
    }

    const salt = parts[2];
    const expectedHash = parts[3];

    // 简化的 APR1 实现（生产环境建议使用专门的库）
    const computed = this.apr1Crypt(password, salt);
    return computed === expectedHash;
  }

  /**
   * 验证 SHA 密码
   */
  private verifySHA(password: string, hash: string): boolean {
    // {SHA}base64hash
    const expectedHash = hash.substring(5); // 去掉 {SHA} 前缀
    const computed = createHash('sha1').update(password).digest('base64');
    return computed === expectedHash;
  }

  /**
   * APR1 MD5 加密（简化版）
   */
  private apr1Crypt(password: string, salt: string): string {
    // 这是一个简化实现，生产环境建议使用 apache-md5 或 apache-crypt 库
    const md5 = (data: string | Buffer) => createHash('md5').update(data).digest();
    
    let ctx = md5(password + '$apr1$' + salt);
    let final = md5(password + salt + password);
    
    for (let i = password.length; i > 0; i -= 16) {
      ctx = md5(Buffer.concat([ctx, final.slice(0, Math.min(i, 16))]));
    }
    
    return ctx.toString('base64').substring(0, 22);
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  getMetadata(): PluginMetadata {
    return {
      name: this.name,
      displayName: this.displayName,
      version: '1.0.0',
      description: '本地密码认证，支持 htpasswd 文件',
      author: 'Gitea OIDC Team',
      permissions: [
        PluginPermission.READ_USER,
        PluginPermission.CREATE_USER,
      ],
    };
  }

  async destroy(): Promise<void> {
    this.passwordMap.clear();
  }
}
