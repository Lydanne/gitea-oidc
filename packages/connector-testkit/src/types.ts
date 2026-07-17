import type { NodeOidcClient, NodeOidcClientOptions } from "@x-oidc/node";

export type ConnectorConformanceMethod = "GET" | "HEAD" | "POST" | "TRACE";

export interface ConnectorConformanceRequest {
  readonly method: ConnectorConformanceMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ConnectorConformanceResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly setCookies: readonly string[];
  header(name: string): string | null;
  json<T = unknown>(): T;
}

export interface ConnectorConformanceConfiguration {
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
  readonly clock: () => number;
}

export interface ConnectorConformanceFixture {
  request(input: ConnectorConformanceRequest): Promise<ConnectorConformanceResponse>;
  close(): Promise<void>;
}

export interface OwnedConnectorConformanceFixture extends ConnectorConformanceFixture {
  /** 在 framework 已关闭后直接探测 connector，预期得到 CLIENT_CLOSED。 */
  probeAfterClose(): Promise<ConnectorConformanceResponse>;
}

export interface ConnectorConformanceHarness {
  readonly name: string;
  createInjected(input: {
    readonly client: NodeOidcClient;
    readonly configuration: ConnectorConformanceConfiguration;
  }): Promise<ConnectorConformanceFixture>;
  createOwned(input: {
    readonly clientOptions: NodeOidcClientOptions;
    readonly configuration: ConnectorConformanceConfiguration;
  }): Promise<OwnedConnectorConformanceFixture>;
}
