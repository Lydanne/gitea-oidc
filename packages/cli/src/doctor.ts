import type { ApplicationConnectionV1 } from "@x-oidc/contracts";
import type { DnsResolver, HttpClient, HttpResponse } from "./dependencies.js";
import { CliError } from "./errors.js";
import { isPublicIpAddress } from "./networkPolicy.js";

const MAXIMUM_DISCOVERY_BYTES = 1024 * 1024;
const ENDPOINT_FIELDS = ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const;

type EndpointField = (typeof ENDPOINT_FIELDS)[number];

export interface DoctorResult {
  checks: readonly ["discovery", "issuer", "endpoints"];
  discoveryUrl: string;
}

export interface DoctorOptions {
  allowPrivateNetwork: boolean;
  timeoutMs: number;
}

export interface DoctorDependencies {
  dnsResolver: DnsResolver;
  httpClient: HttpClient;
}

const createDiscoveryUrl = (issuer: string) =>
  `${issuer.replace(/\/$/u, "")}/.well-known/openid-configuration`;

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) <= 255)
  );
};

const readDiscoveryBody = async (response: HttpResponse): Promise<Record<string, unknown>> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    throw new CliError("discovery 响应的 Content-Type 不是 JSON");
  }

  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > MAXIMUM_DISCOVERY_BYTES
  ) {
    throw new CliError("discovery 响应超过 1 MiB 安全上限");
  }

  let body: string;
  try {
    body = await response.readText(MAXIMUM_DISCOVERY_BYTES);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EFBIG") {
      throw new CliError("discovery 响应超过 1 MiB 安全上限");
    }
    throw new CliError("无法安全读取 discovery 响应", { cause: error });
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(body);
  } catch (error) {
    throw new CliError("discovery 响应不是有效的 JSON", { cause: error });
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new CliError("discovery 响应必须是 JSON object");
  }
  return metadata as Record<string, unknown>;
};

const timeoutError = (timeoutMs: number) => new CliError(`discovery 检查在 ${timeoutMs}ms 后超时`);

const assertDeadline = (signal: AbortSignal, deadline: number, timeoutMs: number) => {
  if (signal.aborted || Date.now() >= deadline) {
    throw timeoutError(timeoutMs);
  }
};

const assertPublicResolution = async (
  hostname: string,
  dnsResolver: DnsResolver,
  signal: AbortSignal,
  deadline: number,
  timeoutMs: number,
): Promise<readonly string[]> => {
  assertDeadline(signal, deadline, timeoutMs);
  let addresses: readonly string[];
  try {
    addresses = await dnsResolver.resolve(hostname);
  } catch (error) {
    if (signal.aborted || Date.now() >= deadline) {
      throw timeoutError(timeoutMs);
    }
    throw new CliError("无法解析 issuer 主机地址", { cause: error });
  }
  assertDeadline(signal, deadline, timeoutMs);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new CliError(
      "issuer 解析到私有、loopback 或保留地址；仅在可信内网开发环境中使用 --allow-private-network",
    );
  }
  return addresses;
};

const validateEndpoint = (
  metadata: Record<string, unknown>,
  field: EndpointField,
  issuerUrl: URL,
) => {
  const value = metadata[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(`discovery 缺少 ${field}`);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch (error) {
    throw new CliError(`${field} 不是有效的绝对 URL`, { cause: error });
  }

  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new CliError(`${field} 包含不安全的 URL 组件`);
  }
  if (endpoint.origin !== issuerUrl.origin) {
    throw new CliError(`${field} 必须与 issuer 同源`);
  }
  if (endpoint.protocol !== "https:") {
    const isSafeDevelopmentHttp =
      issuerUrl.protocol === "http:" && isLoopbackHostname(issuerUrl.hostname);
    if (!isSafeDevelopmentHttp) {
      throw new CliError(`${field} 必须使用 HTTPS`);
    }
  }
};

export const runDoctor = async (
  connection: ApplicationConnectionV1,
  dependencies: DoctorDependencies,
  options: DoctorOptions,
): Promise<DoctorResult> => {
  const { allowPrivateNetwork, timeoutMs } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError("doctor timeout 必须是正整数");
  }

  const discoveryUrl = createDiscoveryUrl(connection.issuer);
  const issuerUrl = new URL(connection.issuer);
  const issuerHostname = issuerUrl.hostname.replace(/^\[|\]$/gu, "");
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let response: HttpResponse | undefined;
  let cancellationStarted = false;
  const cancelResponse = () => {
    if (response && !cancellationStarted) {
      cancellationStarted = true;
      void response.cancel().catch(() => undefined);
    }
  };
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      cancelResponse();
      reject(timeoutError(timeoutMs));
    }, timeoutMs);
  });

  const operation = (async (): Promise<DoctorResult> => {
    let pinnedAddresses: readonly string[] | undefined;
    if (!allowPrivateNetwork) {
      pinnedAddresses = await assertPublicResolution(
        issuerHostname,
        dependencies.dnsResolver,
        controller.signal,
        deadline,
        timeoutMs,
      );
    }
    assertDeadline(controller.signal, deadline, timeoutMs);
    try {
      response = await dependencies.httpClient.fetch(discoveryUrl, {
        headers: { accept: "application/json" },
        ...(pinnedAddresses === undefined ? {} : { pinnedAddresses }),
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || Date.now() >= deadline) {
        throw timeoutError(timeoutMs);
      }
      throw new CliError("无法连接 issuer discovery endpoint", { cause: error });
    }
    assertDeadline(controller.signal, deadline, timeoutMs);

    if (!response.ok) {
      throw new CliError(`issuer discovery 请求失败（HTTP ${response.status}）`);
    }
    if (response.url && response.url !== discoveryUrl) {
      throw new CliError("issuer discovery 不允许重定向");
    }

    const metadata = await readDiscoveryBody(response);
    assertDeadline(controller.signal, deadline, timeoutMs);
    if (!allowPrivateNetwork) {
      await assertPublicResolution(
        issuerHostname,
        dependencies.dnsResolver,
        controller.signal,
        deadline,
        timeoutMs,
      );
    }
    if (metadata.issuer !== connection.issuer) {
      throw new CliError("discovery issuer 与连接配置不精确匹配");
    }

    for (const field of ENDPOINT_FIELDS) {
      validateEndpoint(metadata, field, issuerUrl);
    }
    assertDeadline(controller.signal, deadline, timeoutMs);

    return {
      checks: ["discovery", "issuer", "endpoints"],
      discoveryUrl,
    };
  })().catch((error) => {
    if (controller.signal.aborted || Date.now() >= deadline) {
      throw timeoutError(timeoutMs);
    }
    throw error;
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    controller.abort();
    cancelResponse();
  }
};
