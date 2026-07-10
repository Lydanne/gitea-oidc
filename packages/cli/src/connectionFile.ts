import {
  type ApplicationConnectionV1,
  safeParseApplicationConnectionV1,
} from "@gitea-oidc/contracts";
import type { CliFileSystem } from "./dependencies.js";
import { CliError } from "./errors.js";

const MAXIMUM_CONNECTION_FILE_BYTES = 1024 * 1024;

export const readConnectionFile = async (
  fileSystem: CliFileSystem,
  filePath: string,
): Promise<ApplicationConnectionV1> => {
  let content: string;
  try {
    content = await fileSystem.readTextFile(filePath, MAXIMUM_CONNECTION_FILE_BYTES);
  } catch (error) {
    throw new CliError("无法读取连接配置文件", { cause: error });
  }

  let input: unknown;
  try {
    input = JSON.parse(content.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new CliError("连接配置不是有效的 JSON", { cause: error });
  }

  const result = safeParseApplicationConnectionV1(input);
  if (!result.success) {
    throw new CliError("连接配置校验失败：字段结构或字段值不符合 ApplicationConnectionV1");
  }

  return result.data;
};

const redactUrlQuery = (value: string): string => {
  const url = new URL(value);
  if (!url.search) {
    return value;
  }
  return `${url.origin}${url.pathname}?[REDACTED]`;
};

export const redactConnection = (connection: ApplicationConnectionV1) => ({
  ...connection,
  applicationId: "[REDACTED]",
  oidcClientId: "[REDACTED]",
  clientId: "[REDACTED]",
  redirectUris: connection.redirectUris.map(redactUrlQuery),
  postLogoutRedirectUris: connection.postLogoutRedirectUris.map(redactUrlQuery),
});
