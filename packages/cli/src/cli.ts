import { readConnectionFile, redactConnection } from "./connectionFile.js";
import type { CliDependencies } from "./dependencies.js";
import { runDoctor } from "./doctor.js";
import { CliError, CliUsageError } from "./errors.js";
import { createInitPlan, writeInitFile } from "./init.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MINIMUM_TIMEOUT_MS = 100;
const MAXIMUM_TIMEOUT_MS = 120_000;

const HELP = `用法：gitea-oidc <命令> [选项]

命令：
  config validate <connection.json>
  config print <connection.json> --redact
  doctor <connection.json> [--timeout <毫秒>] [--allow-private-network]
  init <connection.json> [--write] [--credential-file <credential.json>]

安全说明：
  CLI 不接受命令行 Secret。init 默认为 dry-run，--write 必须经过 TTY 确认。
  doctor 默认拒绝私有、loopback 和保留地址；可信内网需显式允许。
`;

type Command =
  | { kind: "help" }
  | { kind: "config-validate"; connectionFile: string }
  | { kind: "config-print"; connectionFile: string }
  | {
      kind: "doctor";
      allowPrivateNetwork: boolean;
      connectionFile: string;
      timeoutMs: number;
    }
  | {
      kind: "init";
      connectionFile: string;
      credentialFile?: string;
      write: boolean;
    };

const requireConnectionFile = (value: string | undefined): string => {
  if (!value || value.startsWith("-")) {
    throw new CliUsageError("缺少 connection.json 路径");
  }
  return value;
};

const describeArgument = (value: string | undefined): string => {
  if (!value) {
    return "[空参数]";
  }
  if (value.startsWith("--")) {
    return value.split("=", 1)[0];
  }
  if (value.startsWith("-")) {
    return value.slice(0, 2);
  }
  return "[已隐藏的位置参数]";
};

const ensureNoExtraArguments = (values: string[]) => {
  if (values.length > 0) {
    throw new CliUsageError(`不支持的参数：${describeArgument(values[0])}`);
  }
};

const parseTimeout = (value: string | undefined): number => {
  if (!value || !/^\d+$/u.test(value)) {
    throw new CliUsageError("--timeout 必须提供整数毫秒值");
  }
  const timeoutMs = Number(value);
  if (timeoutMs < MINIMUM_TIMEOUT_MS || timeoutMs > MAXIMUM_TIMEOUT_MS) {
    throw new CliUsageError(
      `--timeout 必须在 ${MINIMUM_TIMEOUT_MS} 到 ${MAXIMUM_TIMEOUT_MS} 毫秒之间`,
    );
  }
  return timeoutMs;
};

const parseDoctor = (args: string[]): Command => {
  const connectionFile = requireConnectionFile(args.shift());
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let hasTimeout = false;
  let allowPrivateNetwork = false;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--allow-private-network" && !allowPrivateNetwork) {
      allowPrivateNetwork = true;
      continue;
    }
    if (flag === "--timeout" && !hasTimeout) {
      timeoutMs = parseTimeout(args.shift());
      hasTimeout = true;
      continue;
    }
    throw new CliUsageError(`不支持或重复的 doctor 参数：${describeArgument(flag)}`);
  }
  return { kind: "doctor", allowPrivateNetwork, connectionFile, timeoutMs };
};

const parseInit = (args: string[]): Command => {
  const connectionFile = requireConnectionFile(args.shift());
  let credentialFile: string | undefined;
  let write = false;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--write" && !write) {
      write = true;
      continue;
    }
    if (flag === "--credential-file" && !credentialFile) {
      credentialFile = args.shift();
      if (!credentialFile || credentialFile.startsWith("-")) {
        throw new CliUsageError("--credential-file 缺少文件路径");
      }
      continue;
    }
    throw new CliUsageError(`不支持或重复的 init 参数：${describeArgument(flag)}`);
  }
  if (credentialFile && !write) {
    throw new CliUsageError("--credential-file 只能与 --write 一起使用");
  }
  return { kind: "init", connectionFile, credentialFile, write };
};

export const parseCommand = (argv: string[]): Command => {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === "--help" || command === "-h" || command === "help") {
    ensureNoExtraArguments(args);
    return { kind: "help" };
  }
  if (command === "doctor") {
    return parseDoctor(args);
  }
  if (command === "init") {
    return parseInit(args);
  }
  if (command !== "config") {
    throw new CliUsageError("未知命令");
  }

  const subcommand = args.shift();
  const connectionFile = requireConnectionFile(args.shift());
  if (subcommand === "validate") {
    ensureNoExtraArguments(args);
    return { kind: "config-validate", connectionFile };
  }
  if (subcommand === "print") {
    if (args.length !== 1 || args[0] !== "--redact") {
      throw new CliUsageError("config print 必须显式使用 --redact，CLI 不提供明文打印模式");
    }
    return { kind: "config-print", connectionFile };
  }
  throw new CliUsageError("未知 config 子命令");
};

const formatFramework = (framework: string) =>
  ({ nestjs: "NestJS", fastify: "Fastify", express: "Express", node: "Node.js" })[framework] ??
  framework;

const executeCommand = async (command: Command, dependencies: CliDependencies): Promise<void> => {
  if (command.kind === "help") {
    dependencies.stdout.write(HELP);
    return;
  }

  const connection = await readConnectionFile(dependencies.fileSystem, command.connectionFile);
  if (command.kind === "config-validate") {
    dependencies.stdout.write("连接配置有效\n");
    return;
  }
  if (command.kind === "config-print") {
    dependencies.stdout.write(`${JSON.stringify(redactConnection(connection), null, 2)}\n`);
    return;
  }
  if (command.kind === "doctor") {
    await runDoctor(
      connection,
      { dnsResolver: dependencies.dnsResolver, httpClient: dependencies.httpClient },
      {
        allowPrivateNetwork: command.allowPrivateNetwork,
        timeoutMs: command.timeoutMs,
      },
    );
    dependencies.stdout.write(
      "doctor 检查通过：discovery 可访问，issuer 精确匹配，必要 endpoint 使用安全同源 URL\n",
    );
    return;
  }

  const plan = await createInitPlan(connection, dependencies);
  dependencies.stdout.write(
    `检测到框架：${formatFramework(plan.framework)}\n推荐包：${plan.packageName}\n\n.env 配置预览：\n${plan.envPreview}`,
  );
  if (!command.write) {
    dependencies.stdout.write("\ndry-run：未写入文件。确认后可添加 --write。\n");
    return;
  }

  const result = await writeInitFile(
    plan,
    connection,
    { credentialFile: command.credentialFile },
    dependencies,
  );
  dependencies.stdout.write(
    result === "written"
      ? connection.clientType === "confidential"
        ? "已安全创建 .env.gitea-oidc（权限 0600）\n"
        : "已创建 .env.gitea-oidc（不含 client secret）\n"
      : "已取消，未写入文件\n",
  );
};

export const runCli = async (argv: string[], dependencies: CliDependencies): Promise<number> => {
  try {
    await executeCommand(parseCommand(argv), dependencies);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      dependencies.stderr.write(`错误：${error.message}\n`);
      if (error.exitCode === 2) {
        dependencies.stderr.write("使用 --help 查看命令格式\n");
      }
      return error.exitCode;
    }
    dependencies.stderr.write("错误：命令执行失败，未输出底层异常以避免泄漏敏感信息\n");
    return 1;
  }
};

export { HELP };
