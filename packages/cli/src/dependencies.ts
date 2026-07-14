export interface SecureTextFile {
  content: string;
  isFile: boolean;
  mode: number;
  uid?: number;
}

export interface CliFileSystem {
  readonly supportsSecureSecretWrite: boolean;
  readTextFile(filePath: string, maximumBytes: number): Promise<string>;
  readSecureTextFile(filePath: string, maximumBytes: number): Promise<SecureTextFile>;
  writeTextFileExclusive(filePath: string, content: string, mode: number): Promise<void>;
}

export interface GitIgnoreChecker {
  isIgnored(cwd: string, filePath: string): Promise<boolean>;
}

export interface DnsResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

export interface HttpHeaders {
  get(name: string): string | null;
}

export interface HttpResponse {
  cancel(): Promise<void>;
  headers: HttpHeaders;
  ok: boolean;
  readText(maximumBytes: number): Promise<string>;
  status: number;
  url?: string;
}

export interface HttpClient {
  fetch(
    url: string,
    init: {
      headers: Record<string, string>;
      /** 仅允许这些已解析 IP 作为实际连接目标；省略时使用系统 DNS。 */
      pinnedAddresses?: readonly string[];
      redirect: "manual";
      signal: AbortSignal;
    },
  ): Promise<HttpResponse>;
}

export interface CliTerminal {
  readonly interactive: boolean;
  prompt(message: string): Promise<string>;
  promptHidden(message: string): Promise<string>;
}

export interface TextOutput {
  write(text: string): void;
}

export interface CliDependencies {
  cwd: string;
  dnsResolver: DnsResolver;
  fileSystem: CliFileSystem;
  gitIgnoreChecker: GitIgnoreChecker;
  httpClient: HttpClient;
  now(): Date;
  stderr: TextOutput;
  stdout: TextOutput;
  terminal: CliTerminal;
  uid?: number;
}
