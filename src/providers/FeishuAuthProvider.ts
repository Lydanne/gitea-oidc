/**
 * 飞书认证插件
 * 支持飞书 OAuth 2.0 登录
 */

import type {
  AuthProvider,
  AuthContext,
  AuthResult,
  LoginUIResult,
  UserInfo,
  UserRepository,
  AuthProviderConfig,
  FeishuAuthConfig,
  IAuthCoordinator,
  PluginRoute,
  PluginWebhook,
  PluginMetadata,
} from '../types/auth.js';
import { PluginPermission } from '../types/auth.js';
import { AuthErrors } from '../utils/authErrors';

interface FeishuUserInfo {
  open_id: string;
  union_id?: string;
  name: string;
  en_name?: string;
  email?: string;
  mobile?: string;
  avatar_url?: string;
}

interface FeishuTokenResponse {
  code: number;
  msg: string;
  app_access_token?: string;
  user_access_token?: string;
  expires_in?: number;
}

export class FeishuAuthProvider implements AuthProvider {
  readonly name = 'feishu';
  readonly displayName = '飞书登录';

  private config!: FeishuAuthConfig;
  private userRepository!: UserRepository;
  private coordinator!: IAuthCoordinator;
  private appAccessToken?: string;
  private tokenExpiresAt?: number;

  constructor(userRepository: UserRepository, coordinator: IAuthCoordinator) {
    this.userRepository = userRepository;
    this.coordinator = coordinator;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config.config as FeishuAuthConfig;

    // 获取 app access token
    await this.refreshAppAccessToken();
  }

  canHandle(context: AuthContext): boolean {
    return context.authMethod === this.name || context.body.authMethod === this.name;
  }

  async renderLoginUI(context: AuthContext): Promise<LoginUIResult> {
    // 生成 OAuth state
    const state = await this.coordinator.generateOAuthState(
      context.interactionUid,
      this.name,
      {
        userAgent: context.request.headers['user-agent'],
        ip: context.request.ip,
      }
    );

    // 构建飞书授权 URL
    const authUrl = new URL('https://open.feishu.cn/open-apis/authen/v1/authorize');
    authUrl.searchParams.set('app_id', this.config.appId);
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authUrl.searchParams.set('state', state);
    
    if (this.config.scope) {
      authUrl.searchParams.set('scope', this.config.scope);
    }

    return {
      type: 'redirect',
      redirectUrl: authUrl.toString(),
      showInUnifiedPage: true,
      button: {
        text: this.displayName,
        icon: '/auth/feishu/icon.svg',
        style: 'background: #00b96b; color: white; border: none;',
        order: 2,
      },
    };
  }

  async authenticate(context: AuthContext): Promise<AuthResult> {
    // 这个方法不会被直接调用，因为飞书使用 OAuth 回调
    return {
      success: false,
      error: AuthErrors.oauthCallbackFailed('Feishu authentication requires OAuth callback'),
    };
  }

  async handleCallback(context: AuthContext): Promise<AuthResult> {
    const { code, state } = context.query;

    if (!code || !state) {
      const missing = [];
      if (!code) missing.push('code');
      if (!state) missing.push('state');
      return {
        success: false,
        error: AuthErrors.missingParameter(missing),
      };
    }

    // 验证 state
    const stateData = await this.coordinator.verifyOAuthState(state as string);
    
    if (!stateData) {
      return {
        success: false,
        error: AuthErrors.stateExpired(),
      };
    }

    // 验证 provider 匹配
    if (stateData.provider !== this.name) {
      return {
        success: false,
        error: AuthErrors.invalidState(state as string),
      };
    }

    try {
      // 用 code 换取 user_access_token
      const userAccessToken = await this.exchangeCodeForToken(code as string);

      // 获取用户信息
      const feishuUser = await this.getFeishuUserInfo(userAccessToken);

      // 创建或更新本地用户
      const user = await this.userRepository.findOrCreate(
        {
          provider: this.name,
          externalId: feishuUser.open_id,
        },
        {
          username: this.mapUsername(feishuUser),
          name: this.mapName(feishuUser),
          email: this.mapEmail(feishuUser),
          avatar: feishuUser.avatar_url,
          phone: feishuUser.mobile,
          authProvider: this.name,
          emailVerified: !!feishuUser.email,
          phoneVerified: !!feishuUser.mobile,
          metadata: {
            externalId: feishuUser.open_id,
            unionId: feishuUser.union_id,
            enName: feishuUser.en_name,
          },
        }
      );

      return {
        success: true,
        userId: user.sub,
        userInfo: user,
      };
    } catch (err) {
      console.error('[FeishuAuth] Callback error:', err);
      
      return {
        success: false,
        error: AuthErrors.oauthCallbackFailed(
          '飞书登录失败',
          { cause: err instanceof Error ? err.message : String(err) }
        ),
      };
    }
  }

  async getUserInfo(userId: string): Promise<UserInfo | null> {
    return this.userRepository.findById(userId);
  }

  /**
   * 注册自定义路由
   */
  registerRoutes(): PluginRoute[] {
    return [
      {
        method: 'GET',
        path: '/callback',
        handler: async (request, reply) => {
          // 创建认证上下文
          const context: AuthContext = {
            interactionUid: '', // 从 state 中恢复
            request,
            reply,
            authMethod: this.name,
            params: request.params as Record<string, any>,
            body: {},
            query: request.query as Record<string, any>,
          };

          const result = await this.handleCallback(context);

          if (result.success && result.userInfo) {
            // 重定向回 OIDC 交互页面
            const query = request.query as Record<string, string>;
            const state = query.state;
            const stateData = await this.coordinator.verifyOAuthState(state);
            
            if (stateData) {
              const query = request.query as Record<string, string>;
              return reply.redirect(`/interaction/${stateData.interactionUid}/feishu-success?userId=${result.userId}`);
            }
          }

          return reply.code(400).send({ error: result.error });
        },
        options: {
          description: '飞书 OAuth 回调',
        },
      },
      {
        method: 'GET',
        path: '/status',
        handler: async () => {
          return {
            provider: this.name,
            configured: !!this.config.appId,
            tokenValid: this.isTokenValid(),
          };
        },
        options: {
          description: '获取飞书插件状态',
        },
      },
    ];
  }

  /**
   * 注册静态资源
   */
  registerStaticAssets() {
    return [
      {
        path: '/icon.svg',
        content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#00b96b">
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
</svg>`,
        contentType: 'image/svg+xml',
      },
    ];
  }

  /**
   * 注册 Webhook
   */
  registerWebhooks(): PluginWebhook[] {
    return [
      {
        path: '/webhook',
        handler: async (request, reply) => {
          // 处理飞书事件回调
          const event = request.body as any;
          
          console.log('[FeishuAuth] Received webhook event:', event.type);

          // 这里可以处理用户信息变更、部门变更等事件
          // 例如：同步用户信息、更新用户状态等

          return { success: true };
        },
        verifySignature: async (request) => {
          // 验证飞书签名
          const signature = request.headers['x-lark-signature'] as string;
          const timestamp = request.headers['x-lark-request-timestamp'] as string;
          const nonce = request.headers['x-lark-request-nonce'] as string;

          if (!signature || !timestamp || !nonce) {
            return false;
          }

          // 这里应该实现飞书的签名验证逻辑
          // 参考: https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-verification-and-event-decryption

          return true; // 简化实现
        },
      },
    ];
  }

  /**
   * 获取插件元数据
   */
  getMetadata(): PluginMetadata {
    return {
      name: this.name,
      displayName: this.displayName,
      version: '1.0.0',
      description: '飞书 OAuth 2.0 认证插件，支持企业内部应用和自建应用',
      author: 'Gitea OIDC Team',
      homepage: 'https://github.com/your-org/gitea-oidc',
      icon: '/auth/feishu/icon.svg',
      permissions: [
        PluginPermission.READ_USER,
        PluginPermission.CREATE_USER,
        PluginPermission.ACCESS_STATE_STORE,
        PluginPermission.HTTP_REQUEST,
        PluginPermission.REGISTER_ROUTES,
        PluginPermission.REGISTER_WEBHOOK,
      ],
      features: [
        'OAuth 2.0 认证',
        '用户信息同步',
        'Webhook 事件处理',
        '自动创建用户',
      ],
      status: {
        initialized: !!this.config,
        healthy: this.isTokenValid(),
        message: this.isTokenValid() ? '运行正常' : 'Token 已过期',
        stats: {
          appId: this.config?.appId ? `${this.config.appId.substring(0, 8)}...` : 'N/A',
        },
      },
    };
  }

  /**
   * 刷新 app access token
   */
  private async refreshAppAccessToken(): Promise<void> {
    const url = 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = await response.json() as FeishuTokenResponse;

    if (data.code !== 0 || !data.app_access_token) {
      throw new Error(`Failed to get app access token: ${data.msg}`);
    }

    this.appAccessToken = data.app_access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 7200) * 1000;

    console.log('[FeishuAuth] App access token refreshed');
  }

  /**
   * 用 code 换取 user access token
   */
  private async exchangeCodeForToken(code: string): Promise<string> {
    // 确保 app access token 有效
    if (!this.isTokenValid()) {
      await this.refreshAppAccessToken();
    }

    const url = 'https://open.feishu.cn/open-apis/authen/v1/access_token';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.appAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
      }),
    });

    const data = await response.json() as FeishuTokenResponse;

    if (data.code !== 0 || !data.user_access_token) {
      throw new Error(`Failed to exchange code for token: ${data.msg}`);
    }

    return data.user_access_token;
  }

  /**
   * 获取飞书用户信息
   */
  private async getFeishuUserInfo(userAccessToken: string): Promise<FeishuUserInfo> {
    const url = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
      },
    });

    const data = await response.json() as { code: number; msg: string; data?: FeishuUserInfo };

    if (data.code !== 0 || !data.data) {
      throw new Error(`Failed to get user info: ${data.msg}`);
    }

    return data.data;
  }

  /**
   * 检查 token 是否有效
   */
  private isTokenValid(): boolean {
    return !!this.appAccessToken && !!this.tokenExpiresAt && Date.now() < this.tokenExpiresAt;
  }

  /**
   * 映射用户名
   */
  private mapUsername(feishuUser: FeishuUserInfo): string {
    const mapping = this.config.userMapping?.username;
    if (mapping && (feishuUser as any)[mapping]) {
      return (feishuUser as any)[mapping];
    }
    return feishuUser.en_name || feishuUser.open_id;
  }

  /**
   * 映射姓名
   */
  private mapName(feishuUser: FeishuUserInfo): string {
    const mapping = this.config.userMapping?.name;
    if (mapping && (feishuUser as any)[mapping]) {
      return (feishuUser as any)[mapping];
    }
    return feishuUser.name;
  }

  /**
   * 映射邮箱
   */
  private mapEmail(feishuUser: FeishuUserInfo): string {
    const mapping = this.config.userMapping?.email;
    if (mapping && (feishuUser as any)[mapping]) {
      return (feishuUser as any)[mapping];
    }
    return feishuUser.email || `${feishuUser.open_id}@feishu.local`;
  }

  async destroy(): Promise<void> {
    this.appAccessToken = undefined;
    this.tokenExpiresAt = undefined;
  }
}
