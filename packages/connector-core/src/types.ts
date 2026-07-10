import type {
  AuthSessionView,
  LogoutWarning,
  NodeOidcClient,
  NodeOidcClientOptions,
} from "@gitea-oidc/node";

export const OIDC_LOGIN_PATH = "/oidc/login" as const;
export const OIDC_CALLBACK_PATH = "/oidc/callback" as const;
export const OIDC_LOGOUT_PATH = "/oidc/logout" as const;

export interface ConnectorCookieNames {
  readonly transaction?: string;
  readonly session?: string;
}

export type ConnectorNodeClientSource =
  | {
      readonly client: NodeOidcClient;
      readonly clientOptions?: never;
    }
  | {
      readonly client?: never;
      /** 必须显式提供 transaction/session store 和 refresh lock；不会启用内存默认值。 */
      readonly clientOptions: NodeOidcClientOptions;
    };

export type WebConnectorCoreOptions = ConnectorNodeClientSource & {
  /** 必须是已注册的绝对 `/oidc/callback` URL。 */
  readonly redirectUri: string;
  readonly postLogoutRedirectUri?: string;
  readonly cookieNames?: ConnectorCookieNames;
  /** 只接收固定脱敏代码；hook 抛错不会阻断本地退出和 Cookie 清理。 */
  readonly onLogoutWarning?: (warning: LogoutWarning) => void;
  readonly clock?: () => number;
};

export interface ConnectorCookieConfiguration {
  readonly secure: boolean;
  readonly transaction: {
    readonly name: string;
    readonly path: "/";
  };
  readonly session: {
    readonly name: string;
    readonly path: "/";
  };
}

export interface BeginConnectorLoginResult {
  readonly redirectUrl: string;
  readonly transactionCookie: string;
}

export interface CompleteConnectorCallbackResult {
  readonly redirectTo: string;
  readonly session: AuthSessionView;
  readonly sessionCookie: string;
}

export interface ResolveConnectorSessionResult {
  readonly session: AuthSessionView | null;
  readonly clearSessionCookie?: string;
}

export interface CompleteConnectorLogoutResult {
  readonly redirectUrl?: string;
  readonly warnings: readonly LogoutWarning[];
}

export interface WebConnectorCore {
  readonly expectedOrigin: string;
  readonly cookies: ConnectorCookieConfiguration;
  beginLogin(requestUrl: string): Promise<BeginConnectorLoginResult>;
  completeCallback(
    requestUrl: string,
    cookieHeader: string | undefined,
  ): Promise<CompleteConnectorCallbackResult>;
  resolveSession(cookieHeader: string | undefined): Promise<ResolveConnectorSessionResult>;
  validateLogoutOrigin(originHeader: string | readonly string[] | undefined): void;
  logout(
    cookieHeader: string | undefined,
    originHeader: string | readonly string[] | undefined,
  ): Promise<CompleteConnectorLogoutResult>;
  clearTransactionCookie(): string;
  clearSessionCookie(): string;
  close(): Promise<void>;
}
