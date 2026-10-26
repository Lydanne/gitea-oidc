import {
  APPLICATION_CONNECTION_SCHEMA_VERSION,
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  type ApplicationConnectionV1,
} from "@x-oidc/contracts";
import { vi } from "vitest";
import type {
  CliDependencies,
  CliFileSystem,
  CliTerminal,
  HttpClient,
  SecureTextFile,
} from "../dependencies.js";

export const connection: ApplicationConnectionV1 = {
  schemaVersion: APPLICATION_CONNECTION_SCHEMA_VERSION,
  applicationId: "app-1",
  oidcClientId: "oidc-client-1",
  issuer: "https://id.example.com",
  clientId: "client-1",
  clientType: "confidential",
  clientAuthMethod: "client_secret_basic",
  redirectUris: ["https://app.example.com/oidc/callback"],
  postLogoutRedirectUris: ["https://app.example.com/logout/callback"],
  scopes: ["openid", "profile", "email"],
  resources: [],
  flow: "authorization_code",
  pkce: { policy: "required", methods: ["S256"] },
  capabilities: {
    refreshToken: false,
    providerApi: false,
    resourceServer: false,
  },
  recommendedConnector: {
    packageName: "@x-oidc/node",
    minimumVersion: "0.1.0",
  },
};

export const credential = {
  schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  applicationId: connection.applicationId,
  oidcClientId: connection.oidcClientId,
  issuer: connection.issuer,
  clientId: connection.clientId,
  kind: "client_secret" as const,
  clientSecret: "safe-secret-value-123",
};

export interface FakeDependencies extends CliDependencies {
  fileSystem: CliFileSystem & {
    readSecureTextFile: ReturnType<typeof vi.fn>;
    readTextFile: ReturnType<typeof vi.fn>;
    writeTextFileExclusive: ReturnType<typeof vi.fn>;
  };
  httpClient: HttpClient & { fetch: ReturnType<typeof vi.fn> };
  dnsResolver: CliDependencies["dnsResolver"] & { resolve: ReturnType<typeof vi.fn> };
  gitIgnoreChecker: CliDependencies["gitIgnoreChecker"] & {
    isIgnored: ReturnType<typeof vi.fn>;
  };
  stderrText: string[];
  stdoutText: string[];
  terminal: CliTerminal & {
    prompt: ReturnType<typeof vi.fn>;
    promptHidden: ReturnType<typeof vi.fn>;
  };
}

export const createDependencies = (
  options: {
    dnsAddresses?: string[];
    gitIgnored?: boolean;
    interactive?: boolean;
    packageJson?: unknown;
    secureFile?: SecureTextFile;
    supportsSecureSecretWrite?: boolean;
  } = {},
): FakeDependencies => {
  const stdoutText: string[] = [];
  const stderrText: string[] = [];
  const packageJson = options.packageJson ?? { dependencies: { express: "^5.0.0" } };
  const readTextFile = vi.fn(async (filePath: string) => {
    if (filePath.endsWith("package.json")) {
      return JSON.stringify(packageJson);
    }
    if (filePath === "/connection.json") {
      return JSON.stringify(connection);
    }
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  const secureFile = options.secureFile ?? {
    content: JSON.stringify(credential),
    isFile: true,
    mode: 0o600,
    uid: 501,
  };

  return {
    cwd: "/workspace",
    dnsResolver: {
      resolve: vi.fn(async () => options.dnsAddresses ?? ["93.184.216.34"]),
    },
    fileSystem: {
      supportsSecureSecretWrite: options.supportsSecureSecretWrite ?? true,
      readTextFile,
      readSecureTextFile: vi.fn(async () => secureFile),
      writeTextFileExclusive: vi.fn(async () => undefined),
    },
    gitIgnoreChecker: {
      isIgnored: vi.fn(async () => options.gitIgnored ?? true),
    },
    httpClient: {
      fetch: vi.fn(),
    },
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    stderr: { write: (text) => stderrText.push(text) },
    stderrText,
    stdout: { write: (text) => stdoutText.push(text) },
    stdoutText,
    terminal: {
      interactive: options.interactive ?? true,
      prompt: vi.fn(async () => "yes"),
      promptHidden: vi.fn(async () => "safe-secret-value-123"),
    },
    uid: 501,
  };
};

export const createDiscoveryResponse = (
  metadata: Record<string, unknown>,
  options: { contentType?: string; status?: number; url?: string } = {},
) => {
  const body = JSON.stringify(metadata);
  const headers = new Map<string, string>([
    ["content-type", options.contentType ?? "application/json; charset=utf-8"],
    ["content-length", String(Buffer.byteLength(body))],
  ]);
  const status = options.status ?? 200;
  return {
    cancel: vi.fn(async () => undefined),
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    ok: status >= 200 && status < 300,
    status,
    readText: vi.fn(async (maximumBytes: number) => {
      if (Buffer.byteLength(body) > maximumBytes) {
        throw Object.assign(new Error("too large"), { code: "EFBIG" });
      }
      return body;
    }),
    url: options.url,
  };
};

export const validDiscovery = {
  issuer: connection.issuer,
  authorization_endpoint: "https://id.example.com/oidc/auth",
  token_endpoint: "https://id.example.com/oidc/token",
  jwks_uri: "https://id.example.com/oidc/jwks",
};
