/**
 * 飞书认证插件
 * 支持飞书 OAuth 2.0 登录
 */

import type { FastifyRequest, FastifyReply } from "fastify";
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
} from "../types/auth";
import { PluginPermission } from "../types/auth";
import { AuthErrors } from "../utils/authErrors";
import { Logger } from "../utils/Logger";

interface FeishuUserInfo {
  open_id: string;
  union_id?: string;
  name: string;
  en_name?: string;
  email?: string;
  mobile?: string;
  avatar_big?: string;
  avatar_middle?: string;
  avatar_thumb?: string;
  avatar_url?: string;
  employee_no?: string;
  enterprise_email?: string;
  tenant_key?: string;
  user_id?: string;
  fullInfo?: FullFeishuUserInfo;
}

interface FullFeishuUserInfo {
  avatar: {
    avatar_240: string;
    avatar_640: string;
    avatar_72: string;
    avatar_origin: string;
  };
  city: string;
  country: string;
  department_ids: string[];
  department_path: {
    department_id: string;
    department_name: {
      i18n_name: {
        en_us: string;
        ja_jp: string;
        zh_cn: string;
      };
      name: string;
    };
    department_path: {
      department_ids: string[];
      department_path_name: {
        i18n_name: {
          en_us: string;
          ja_jp: string;
          zh_cn: string;
        };
        name: string;
      };
    };
  }[];
  description: string;
  email: string;
  employee_no: string;
  employee_type: number;
  en_name: string;
  enterprise_email: string;
  gender: number;
  is_tenant_manager: boolean;
  job_title: string;
  join_time: number;
  leader_user_id: string;
  mobile: string;
  mobile_visible: boolean;
  name: string;
  open_id: string;
  orders: {
    department_id: string;
    department_order: number;
    is_primary_dept: boolean;
    user_order: number;
  }[];
  status: {
    is_activated: boolean;
    is_exited: boolean;
    is_frozen: boolean;
    is_resigned: boolean;
    is_unjoin: boolean;
  };
  union_id: string;
  user_id: string;
  work_station: string;
}

/**
 * 飞书 URL 验证请求
 */
interface FeishuUrlVerification {
  challenge: string;
  token: string;
  type: "url_verification";
}

/**
 * 飞书事件通知
 */
interface FeishuEvent {
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event?: any;
  type?: string;
}

/**
 * 飞书加密数据（可能是验证请求或事件通知）
 */
type FeishuEncryptedData = FeishuUrlVerification | FeishuEvent;

interface FeishuTokenResponse {
  code: number;
  msg: string;
  app_access_token?: string;
  expires_in?: number;
}

interface FeishuUserTokenResponse {
  code: number;
  msg: string;
  data?: {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    token_type: string;
  };
}

export class FeishuAuthProvider implements AuthProvider {
  readonly name = "feishu";
  readonly displayName = "飞书登录";

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
    return (
      context.authMethod === this.name || context.body.authMethod === this.name
    );
  }

  async renderLoginUI(context: AuthContext): Promise<LoginUIResult> {
    // 生成 OAuth state
    const state = await this.coordinator.generateOAuthState(
      context.interactionUid,
      this.name,
      {
        userAgent: context.request.headers["user-agent"],
        ip: context.request.ip,
      }
    );

    // 构建飞书授权 URL
    const authUrl = new URL(
      "https://open.feishu.cn/open-apis/authen/v1/authorize"
    );
    authUrl.searchParams.set("app_id", this.config.appId);
    authUrl.searchParams.set("redirect_uri", this.config.redirectUri);
    authUrl.searchParams.set("state", state);

    if (this.config.scope) {
      authUrl.searchParams.set("scope", this.config.scope);
    }

    return {
      type: "redirect",
      redirectUrl: authUrl.toString(),
      showInUnifiedPage: true,
      button: {
        text: this.displayName,
        icon: "/auth/feishu/icon.svg",
        style: "background: #00b96b; color: white; border: none;",
        order: 2,
      },
    };
  }

  async authenticate(context: AuthContext): Promise<AuthResult> {
    // 这个方法不会被直接调用，因为飞书使用 OAuth 回调
    return {
      success: false,
      error: AuthErrors.oauthCallbackFailed(
        "Feishu authentication requires OAuth callback"
      ),
    };
  }

  async handleCallback(context: AuthContext): Promise<AuthResult> {
    const { code, state } = context.query;

    if (!code || !state) {
      const missing = [];
      if (!code) missing.push("code");
      if (!state) missing.push("state");
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

      const email = this.mapEmail(feishuUser);

      // 创建或更新本地用户
      const user = await this.userRepository.findOrCreate(
        this.name,
        feishuUser.open_id,
        {
          username: this.mapUsername(feishuUser),
          name: this.mapName(feishuUser),
          email: email,
          emailVerified: !!email,
          groups: this.mapGroups(feishuUser),
          picture: feishuUser.avatar_url,
          phone: feishuUser.mobile,
          phoneVerified: !!feishuUser.mobile,
          metadata: feishuUser,
        }
      );

      return {
        success: true,
        userId: user.sub,
        userInfo: user,
        // 将 stateData 附加到结果中，避免重复验证
        metadata: {
          interactionUid: stateData.interactionUid,
        },
      };
    } catch (err) {
      Logger.error("[FeishuAuth] Callback error:", err);

      return {
        success: false,
        error: AuthErrors.oauthCallbackFailed("飞书登录失败", {
          cause: err instanceof Error ? err.message : String(err),
        }),
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
    // 回调处理函数（GET 和 POST 共用）
    const callbackHandler = async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      const body = request.body as any;

      // 打印请求详情用于调试
      Logger.debug("[FeishuAuth] Callback request:", {
        method: request.method,
        query: request.query,
        body: body,
        headers: {
          "content-type": request.headers["content-type"],
          "x-lark-signature": request.headers["x-lark-signature"],
        },
      });

      // 处理飞书加密的 URL 验证请求
      if (request.method === "POST" && body?.encrypt) {
        try {
          Logger.info("[FeishuAuth] Received encrypted verification request");
          const decrypted = this.decryptFeishuData(body.encrypt);
          Logger.debug("[FeishuAuth] Decrypted data:", decrypted);

          // 类型守卫：检查是否为 URL 验证请求
          if (
            "challenge" in decrypted &&
            decrypted.type === "url_verification"
          ) {
            Logger.info(
              "[FeishuAuth] Returning challenge:",
              decrypted.challenge
            );
            return reply.send({ challenge: decrypted.challenge });
          }

          // 如果是事件通知，这里可以处理
          if ("header" in decrypted) {
            Logger.info(
              "[FeishuAuth] Received event:",
              decrypted.header?.event_type
            );
            // 事件处理逻辑...
            return reply.send({ success: true });
          }
        } catch (err) {
          Logger.error(
            "[FeishuAuth] Failed to decrypt verification request:",
            err
          );
          return reply.code(400).send({ error: "Decryption failed" });
        }
      }

      // 处理未加密的 URL 验证请求
      if (request.method === "POST" && body?.challenge) {
        Logger.info(
          "[FeishuAuth] Received plain URL verification request, challenge:",
          body.challenge
        );
        return reply.send({ challenge: body.challenge });
      }

      // 创建认证上下文
      const context: AuthContext = {
        interactionUid: "", // 从 state 中恢复
        request,
        reply,
        authMethod: this.name,
        params: request.params as Record<string, any>,
        body: body || {},
        query: request.query as Record<string, any>,
      };

      const result = await this.handleCallback(context);

      if (result.success && result.userId) {
        // 从 result.metadata 中获取 interactionUid（已在 handleCallback 中验证过 state）
        const interactionUid = result.metadata?.interactionUid;

        if (interactionUid) {
          // 将用户信息存储到临时存储中，然后重定向回交互页面
          // 这样可以避免 cookie 丢失的问题
          await this.coordinator.storeAuthResult(interactionUid, result.userId);

          // 重定向回交互页面，让它完成 OIDC 交互
          return reply.redirect(`/interaction/${interactionUid}/complete`);
        } else {
          return reply.code(400).send({
            error: "Invalid or expired state",
          });
        }
      }

      // 认证失败
      const errorMessage =
        result.error?.userMessage || result.error?.message || "认证失败";
      return reply.code(400).send({ error: errorMessage });
    };

    return [
      {
        method: "GET",
        path: "/callback",
        handler: callbackHandler,
        options: {
          description: "飞书 OAuth 回调 (GET)",
        },
      },
      {
        method: "POST",
        path: "/callback",
        handler: callbackHandler,
        options: {
          description: "飞书 OAuth 回调 (POST)",
        },
      },
      {
        method: "GET",
        path: "/status",
        handler: async () => {
          return {
            provider: this.name,
            configured: !!this.config.appId,
            tokenValid: this.isTokenValid(),
          };
        },
        options: {
          description: "获取飞书插件状态",
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
        path: "/icon.svg",
        content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#00b96b">
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
</svg>`,
        contentType: "image/svg+xml",
      },
    ];
  }

  /**
   * 解密飞书加密数据
   * 参考: https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-verification-and-event-decryption
   *
   * 飞书加密算法：
   * 1. 密钥：encryptKey 的 SHA256 哈希值（32字节）
   * 2. IV：密钥的前16字节
   * 3. 算法：AES-256-CBC
   * 4. Padding：PKCS7
   *
   * @param encrypt Base64 编码的加密数据
   * @returns 解密后的数据（URL 验证请求或事件通知）
   */
  private decryptFeishuData(encrypt: string): FeishuEncryptedData {
    if (!this.config.encryptKey) {
      throw new Error("Encrypt key not configured");
    }

    try {
      const crypto = require("crypto");

      // 1. 对 encryptKey 进行 SHA256 哈希，得到32字节的密钥
      const keyHash = crypto
        .createHash("sha256")
        .update(this.config.encryptKey)
        .digest();

      // 2. 使用密钥的前16字节作为 IV
      const iv = keyHash.slice(0, 16);

      // 3. Base64 解码加密数据
      const encryptedData = Buffer.from(encrypt, "base64");

      // 4. AES-256-CBC 解密
      const decipher = crypto.createDecipheriv("aes-256-cbc", keyHash, iv);
      decipher.setAutoPadding(true); // 自动处理 PKCS7 padding

      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      // 5. 转换为字符串
      let decryptedStr = decrypted.toString("utf-8");
      Logger.debug("[FeishuAuth] Decrypted raw string:", decryptedStr);

      // 6. 提取 JSON 部分（移除前面的随机字节）
      // 飞书的加密数据格式：random(16 bytes) + msg_len(4 bytes) + msg + app_id
      // 我们需要找到 JSON 的起始位置
      const jsonStart = decryptedStr.indexOf("{");
      if (jsonStart > 0) {
        decryptedStr = decryptedStr.substring(jsonStart);
        Logger.debug("[FeishuAuth] Cleaned JSON string:", decryptedStr);
      }

      // 7. 找到 JSON 的结束位置
      const jsonEnd = decryptedStr.lastIndexOf("}");
      if (jsonEnd > 0) {
        decryptedStr = decryptedStr.substring(0, jsonEnd + 1);
      }

      return JSON.parse(decryptedStr);
    } catch (err) {
      Logger.error("[FeishuAuth] Failed to decrypt data:", err);
      Logger.error(
        "[FeishuAuth] Encrypt key length:",
        this.config.encryptKey?.length
      );
      throw err;
    }
  }

  /**
   * 验证飞书请求签名
   * 参考: https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-verification-and-event-decryption
   */
  private async verifyFeishuSignature(
    request: FastifyRequest
  ): Promise<boolean> {
    const signature = request.headers["x-lark-signature"] as string;
    const timestamp = request.headers["x-lark-request-timestamp"] as string;
    const nonce = request.headers["x-lark-request-nonce"] as string;

    if (!signature || !timestamp || !nonce) {
      Logger.warn("[FeishuAuth] Missing signature headers");
      return false;
    }

    // 如果没有配置 verificationToken，跳过验证（开发环境）
    if (!this.config.verificationToken) {
      Logger.warn(
        "[FeishuAuth] Verification token not configured, skipping signature verification"
      );
      return true;
    }

    try {
      // 飞书签名算法：SHA256(timestamp + nonce + encrypt_key + body)
      const crypto = await import("crypto");
      const body = JSON.stringify(request.body);
      const signContent = `${timestamp}${nonce}${this.config.verificationToken}${body}`;

      const hash = crypto.createHash("sha256");
      hash.update(signContent);
      const calculatedSignature = hash.digest("hex");

      const isValid = calculatedSignature === signature;
      if (!isValid) {
        Logger.error("[FeishuAuth] Signature verification failed");
      }

      return isValid;
    } catch (err) {
      Logger.error("[FeishuAuth] Error verifying signature:", err);
      return false;
    }
  }

  /**
   * 注册 Webhook
   */
  registerWebhooks(): PluginWebhook[] {
    return [
      {
        path: "/webhook",
        handler: async (request, reply) => {
          // 处理飞书事件回调
          const event = request.body as any;

          Logger.info("[FeishuAuth] Received webhook event:", event.type);

          // URL 验证请求
          if (event.type === "url_verification") {
            return {
              challenge: event.challenge,
            };
          }

          // 这里可以处理用户信息变更、部门变更等事件
          // 例如：同步用户信息、更新用户状态等
          switch (event.type) {
            case "user.created":
            case "user.updated":
            case "user.deleted":
              Logger.info("[FeishuAuth] User event:", event.type, event.event);
              break;
            default:
              Logger.info("[FeishuAuth] Unhandled event type:", event.type);
          }

          return { success: true };
        },
        verifySignature: async (request) => {
          return this.verifyFeishuSignature(request);
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
      version: "1.0.0",
      description: "飞书 OAuth 2.0 认证插件，支持企业内部应用和自建应用",
      author: "XGJ Team By Lyda",
      homepage: "https://github.com/Lydanne/gitea-oidc",
      icon: "https://p1-hera.feishucdn.com/tos-cn-i-jbbdkfciu3/84a9f036fe2b44f99b899fff4beeb963~tplv-jbbdkfciu3-image:0:0.image",
      permissions: [
        PluginPermission.READ_USER,
        PluginPermission.CREATE_USER,
        PluginPermission.ACCESS_STATE_STORE,
        PluginPermission.HTTP_REQUEST,
        PluginPermission.REGISTER_ROUTES,
        PluginPermission.REGISTER_STATIC,
        PluginPermission.REGISTER_WEBHOOK,
      ],
      features: [
        "OAuth 2.0 认证",
        "用户信息同步",
        "Webhook 事件处理",
        "自动创建用户",
      ],
      status: {
        initialized: !!this.config,
        healthy: this.isTokenValid(),
        message: this.isTokenValid() ? "运行正常" : "Token 已过期",
        stats: {
          appId: this.config?.appId
            ? `${this.config.appId.substring(0, 8)}...`
            : "N/A",
        },
      },
    };
  }

  /**
   * 刷新 app access token
   */
  private async refreshAppAccessToken(): Promise<void> {
    const url =
      "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = (await response.json()) as FeishuTokenResponse;

    if (data.code !== 0 || !data.app_access_token) {
      throw new Error(`Failed to get app access token: ${data.msg}`);
    }

    this.appAccessToken = data.app_access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 7200) * 1000;

    Logger.info("[FeishuAuth] App access token refreshed");
  }

  /**
   * 用 code 换取 user access token
   */
  private async exchangeCodeForToken(code: string): Promise<string> {
    // 确保 app access token 有效
    if (!this.isTokenValid()) {
      await this.refreshAppAccessToken();
    }

    const url = "https://open.feishu.cn/open-apis/authen/v1/access_token";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = (await response.json()) as FeishuUserTokenResponse;

    Logger.debug("[FeishuAuth] Token exchange response:", {
      code: data.code,
      msg: data.msg,
      hasData: !!data.data,
      hasAccessToken: !!data.data?.access_token,
      fullResponse: JSON.stringify(data),
    });

    if (data.code !== 0 || !data.data?.access_token) {
      throw new Error(
        `Failed to exchange code for token: ${data.msg} (code: ${data.code})`
      );
    }

    return data.data.access_token;
  }

  /**
   * 获取飞书用户信息
   */
  private async getFeishuUserInfo(
    userAccessToken: string
  ): Promise<FeishuUserInfo> {
    const url = "https://open.feishu.cn/open-apis/authen/v1/user_info";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });

    const data = (await response.json()) as {
      code: number;
      msg: string;
      data?: FeishuUserInfo;
    };

    if (data.code !== 0 || !data.data) {
      throw new Error(`Failed to get user info: ${data.msg}`);
    }

    const fullUserUrl = `https://open.feishu.cn/open-apis/contact/v3/users/${data.data.open_id}?department_id_type=open_department_id&user_id_type=open_id`;
    const fullUserResponse = await fetch(fullUserUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });
    const fullUserData = (await fullUserResponse.json()) as {
      code: number;
      msg: string;
      data?: { user: FullFeishuUserInfo };
    };
    if (fullUserData.code !== 0 || !fullUserData.data) {
      throw new Error(`Failed to get full user info: ${fullUserData.msg}`);
    }
    return { ...data.data, fullInfo: fullUserData.data.user };
  }

  /**
   * 检查 token 是否有效
   */
  private isTokenValid(): boolean {
    return (
      !!this.appAccessToken &&
      !!this.tokenExpiresAt &&
      Date.now() < this.tokenExpiresAt
    );
  }

  /**
   * 映射用户名
   */
  private mapUsername(feishuUser: FeishuUserInfo): string {
    const mapping = this.config.userMapping?.username;
    if (mapping && (feishuUser as any)[mapping]) {
      return (feishuUser as any)[mapping];
    }
    return feishuUser.user_id || feishuUser.open_id;
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

  private mapGroups(feishuUser: FeishuUserInfo): string[] {
    const mapping = this.config.groupMapping;
    if (mapping) {
      return Object.entries(mapping).reduce((acc, [key, value]) => {
        if (feishuUser.fullInfo?.department_path?.some((d) => d.department_name.name === key)) {
          acc.push(value);
        }
        return acc;
      }, ["Owners"] as string[]);
    }
    const groups = feishuUser.fullInfo?.department_path?.map((d) => d.department_name.name) ?? [];
    groups.push("Owners");
    return groups;
  }

  async destroy(): Promise<void> {
    this.appAccessToken = undefined;
    this.tokenExpiresAt = undefined;
  }
}
