import { resolve } from "node:path";
import {
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  type ApplicationConnectionV1,
  type ApplicationCredentialV1,
  safeParseApplicationCredentialV1,
} from "@x-oidc/contracts";
import type { CliDependencies, CliFileSystem, SecureTextFile } from "./dependencies.js";
import { CliError, hasErrorCode } from "./errors.js";

const MAXIMUM_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAXIMUM_CREDENTIAL_FILE_BYTES = 16 * 1024;
const ENV_FILE_NAME = ".env.x-oidc";
const FRAMEWORK_CALLBACK_PATH = "/oidc/callback";

export type DetectedFramework = "nestjs" | "fastify" | "express" | "node";

export interface InitPlan {
  envPreview: string;
  framework: DetectedFramework;
  packageName: string;
  redirectUri: string;
  targetPath: string;
}

interface PackageManifest {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

const FRAMEWORK_PACKAGES: Record<DetectedFramework, string> = {
  nestjs: "@x-oidc/nestjs",
  fastify: "@x-oidc/fastify",
  express: "@x-oidc/express",
  node: "@x-oidc/node",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readDependencyNames = (manifest: PackageManifest): Set<string> => {
  const names = new Set<string>();
  for (const field of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ]) {
    if (isRecord(field)) {
      for (const name of Object.keys(field)) {
        names.add(name);
      }
    }
  }
  return names;
};

export const detectFramework = async (
  fileSystem: CliFileSystem,
  cwd: string,
): Promise<DetectedFramework> => {
  let content: string;
  try {
    content = await fileSystem.readTextFile(
      resolve(cwd, "package.json"),
      MAXIMUM_PACKAGE_JSON_BYTES,
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return "node";
    }
    throw new CliError("无法读取当前项目的 package.json", { cause: error });
  }

  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch (error) {
    throw new CliError("当前项目的 package.json 不是有效 JSON", { cause: error });
  }
  if (!isRecord(input)) {
    throw new CliError("当前项目的 package.json 必须是 JSON object");
  }

  const dependencies = readDependencyNames(input);
  if (dependencies.has("@nestjs/common")) {
    return "nestjs";
  }
  if (dependencies.has("fastify")) {
    return "fastify";
  }
  if (dependencies.has("express")) {
    return "express";
  }
  return "node";
};

const encodeEnvValue = (value: string): string => {
  if (/[\0\r\n]/u.test(value)) {
    throw new CliError("配置值包含 dotenv 不支持的换行或 NUL 字符");
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"') && !/[\\$`!]/u.test(value)) {
    return `"${value}"`;
  }
  throw new CliError("配置值无法在保持 dotenv 原值的前提下安全编码");
};

export const renderEnv = (
  connection: ApplicationConnectionV1,
  clientSecret?: string,
  redirectUri: string = connection.redirectUris[0],
): string => {
  const entries: Array<[string, string]> = [
    ["X_OIDC_ISSUER", connection.issuer],
    ["X_OIDC_CLIENT_ID", connection.clientId],
    ["X_OIDC_REDIRECT_URI", redirectUri],
    ["X_OIDC_SCOPES", connection.scopes.join(" ")],
  ];
  if (connection.clientType === "confidential") {
    entries.push(["X_OIDC_CLIENT_SECRET", clientSecret ?? "[REDACTED: 通过安全输入提供]"]);
  }
  return `# 仅供 dotenv 或 Node.js --env-file 读取；禁止使用 shell source\n${entries
    .map(([key, value]) => `${key}=${encodeEnvValue(value)}`)
    .join("\n")}\n`;
};

export const createInitPlan = async (
  connection: ApplicationConnectionV1,
  dependencies: Pick<CliDependencies, "cwd" | "fileSystem">,
): Promise<InitPlan> => {
  const framework = await detectFramework(dependencies.fileSystem, dependencies.cwd);
  const redirectUri =
    framework === "node"
      ? connection.redirectUris[0]
      : connection.redirectUris.find(
          (candidate) => new URL(candidate).pathname === FRAMEWORK_CALLBACK_PATH,
        );
  if (!redirectUri) {
    throw new CliError(
      `检测到 ${framework}，但 connection 未注册 ${FRAMEWORK_CALLBACK_PATH} 回调；` +
        "请在管理系统为应用添加该回调，或改用 @x-oidc/node 自行适配路由",
    );
  }
  return {
    envPreview: renderEnv(connection, undefined, redirectUri),
    framework,
    packageName: FRAMEWORK_PACKAGES[framework],
    redirectUri,
    targetPath: resolve(dependencies.cwd, ENV_FILE_NAME),
  };
};

const validateCredential = (
  input: unknown,
  connection: ApplicationConnectionV1,
  now: Date,
): Extract<ApplicationCredentialV1, { kind: "client_secret" }> => {
  const result = safeParseApplicationCredentialV1(input);
  if (!result.success || result.data.kind !== "client_secret") {
    throw new CliError("凭据格式无效，confidential Client 需要 client_secret credential");
  }
  if (
    result.data.applicationId !== connection.applicationId ||
    result.data.oidcClientId !== connection.oidcClientId ||
    result.data.issuer !== connection.issuer ||
    result.data.clientId !== connection.clientId
  ) {
    throw new CliError("credential 与当前 connection 不匹配，拒绝写入 Secret");
  }
  if (result.data.expiresAt && new Date(result.data.expiresAt).getTime() <= now.getTime()) {
    throw new CliError("凭据已经过期，未写入配置文件");
  }
  return result.data;
};

const readCredentialFile = async (
  filePath: string,
  connection: ApplicationConnectionV1,
  dependencies: Pick<CliDependencies, "fileSystem" | "now" | "uid">,
) => {
  let file: SecureTextFile;
  try {
    file = await dependencies.fileSystem.readSecureTextFile(
      filePath,
      MAXIMUM_CREDENTIAL_FILE_BYTES,
    );
  } catch (error) {
    throw new CliError("无法安全读取 credential 文件", { cause: error });
  }
  if (!file.isFile) {
    throw new CliError("credential 路径必须是普通文件");
  }
  if (
    !Number.isSafeInteger(file.mode) ||
    !Number.isSafeInteger(file.uid) ||
    !Number.isSafeInteger(dependencies.uid)
  ) {
    throw new CliError("当前平台无法可靠验证 credential 文件的所有者和权限；请改用隐藏输入");
  }
  if ((file.mode & 0o7177) !== 0) {
    throw new CliError("credential 文件权限过宽，请设置为 0600 或更严格");
  }
  if (file.uid !== dependencies.uid) {
    throw new CliError("credential 文件不属于当前用户");
  }

  let input: unknown;
  try {
    input = JSON.parse(file.content.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new CliError("credential 文件不是有效 JSON", { cause: error });
  }
  return validateCredential(input, connection, dependencies.now());
};

const promptCredential = async (
  connection: ApplicationConnectionV1,
  dependencies: Pick<CliDependencies, "now" | "terminal">,
) => {
  const clientSecret = await dependencies.terminal.promptHidden("请输入 client secret：");
  return validateCredential(
    {
      schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
      applicationId: connection.applicationId,
      oidcClientId: connection.oidcClientId,
      issuer: connection.issuer,
      clientId: connection.clientId,
      kind: "client_secret",
      clientSecret,
    },
    connection,
    dependencies.now(),
  );
};

export const writeInitFile = async (
  plan: InitPlan,
  connection: ApplicationConnectionV1,
  options: { credentialFile?: string },
  dependencies: Pick<
    CliDependencies,
    "cwd" | "fileSystem" | "gitIgnoreChecker" | "now" | "terminal" | "uid"
  >,
): Promise<"cancelled" | "written"> => {
  if (!dependencies.terminal.interactive) {
    throw new CliError("--write 只能在交互式 TTY 中使用");
  }
  if (connection.clientType === "public" && options.credentialFile) {
    throw new CliError("public Client 不接受 credential 文件");
  }
  if (
    connection.clientType === "confidential" &&
    !dependencies.fileSystem.supportsSecureSecretWrite
  ) {
    throw new CliError(
      "当前平台无法可靠限制 Secret 文件的访问权限；未读取或写入 Secret，请改用系统 Secret Manager",
    );
  }

  let isIgnored: boolean;
  try {
    isIgnored = await dependencies.gitIgnoreChecker.isIgnored(dependencies.cwd, plan.targetPath);
  } catch (error) {
    throw new CliError(
      "无法确认 .env.x-oidc 是否被 Git 忽略，未读取 Secret；请先检查 Git 仓库和 .gitignore",
      { cause: error },
    );
  }
  if (!isIgnored) {
    throw new CliError(
      "未读取 Secret：请先执行 printf '\\n.env.x-oidc\\n' >> .gitignore，然后重试 --write",
    );
  }

  const confirmation = await dependencies.terminal.prompt(
    `确认创建 ${ENV_FILE_NAME}？输入 yes 继续：`,
  );
  if (confirmation.trim().toLowerCase() !== "yes") {
    return "cancelled";
  }

  let credential: Extract<ApplicationCredentialV1, { kind: "client_secret" }> | undefined;
  if (connection.clientType === "confidential") {
    credential = options.credentialFile
      ? await readCredentialFile(options.credentialFile, connection, dependencies)
      : await promptCredential(connection, dependencies);
  }

  const content = renderEnv(connection, credential?.clientSecret, plan.redirectUri);
  try {
    await dependencies.fileSystem.writeTextFileExclusive(plan.targetPath, content, 0o600);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new CliError(`${ENV_FILE_NAME} 已存在，CLI 不会覆盖它`);
    }
    throw new CliError(`无法安全写入 ${ENV_FILE_NAME}`, { cause: error });
  }
  return "written";
};
