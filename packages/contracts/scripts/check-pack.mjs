import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "x-oidc-contracts-pack-"));
const tarballPath = path.join(temporaryRoot, "contracts.tgz");
const consumerRoot = path.join(temporaryRoot, "consumer");

const run = (command, args, cwd, capture = false) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} 执行失败${details ? `\n${details}` : ""}`);
  }
  return result.stdout ?? "";
};

const runPnpm = (args, cwd, capture = false) => {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli) {
    return run(process.execPath, [pnpmCli, ...args], cwd, capture);
  }
  return run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, cwd, capture);
};

try {
  const packOutput = runPnpm(["pack", "--json", "--out", tarballPath], packageRoot, true);
  const packResult = JSON.parse(packOutput);
  const filePaths = packResult.files.map((file) => file.path);
  const allowedRootFiles = new Set(["LICENSE", "README.md", "package.json"]);
  const unexpectedFiles = filePaths.filter(
    (filePath) => !allowedRootFiles.has(filePath) && !filePath.startsWith("dist/"),
  );
  if (unexpectedFiles.length > 0) {
    throw new Error(`tarball 包含白名单外文件: ${unexpectedFiles.join(", ")}`);
  }

  const forbiddenPatterns = [
    /(^|\/)src\//u,
    /(^|\/)__tests__\//u,
    /(^|\/)\.agents\//u,
    /(^|\/)scripts\//u,
    /\.db$/u,
    /\.htpasswd$/u,
    /\.tsbuildinfo$/u,
  ];
  const forbiddenFiles = filePaths.filter((filePath) =>
    forbiddenPatterns.some((pattern) => pattern.test(filePath)),
  );
  if (forbiddenFiles.length > 0) {
    throw new Error(`tarball 包含禁止发布的文件: ${forbiddenFiles.join(", ")}`);
  }

  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    path.join(temporaryRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  await writeFile(path.join(temporaryRoot, "pnpm-workspace.yaml"), "packages:\n  - consumer\n");
  await writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "contracts-pack-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@x-oidc/contracts": `file:${tarballPath}`,
        },
        devDependencies: {
          typescript: "^5.9.3",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(consumerRoot, "esm.mjs"),
    'import { APPLICATION_CONTRACT_VERSION } from "@x-oidc/contracts";\n' +
      'if (APPLICATION_CONTRACT_VERSION !== 1) throw new Error("ESM contract version mismatch");\n',
  );
  await writeFile(
    path.join(consumerRoot, "cjs.cjs"),
    'const { APPLICATION_CONTRACT_VERSION } = require("@x-oidc/contracts");\n' +
      'if (APPLICATION_CONTRACT_VERSION !== 1) throw new Error("CJS contract version mismatch");\n',
  );
  await writeFile(
    path.join(consumerRoot, "consumer.ts"),
    'import { APPLICATION_CONNECTION_SCHEMA_VERSION, type ApplicationConnectionV1 } from "@x-oidc/contracts";\n' +
      'const version: ApplicationConnectionV1["schemaVersion"] = APPLICATION_CONNECTION_SCHEMA_VERSION;\n' +
      "void version;\n",
  );
  await writeFile(
    path.join(consumerRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );

  // 临时 consumer 没有预生成锁文件；优先复用 store，缺少兼容版本时允许从 registry 下载。
  runPnpm(["install", "--prefer-offline", "--ignore-scripts"], temporaryRoot);
  run(process.execPath, ["esm.mjs"], consumerRoot);
  run(process.execPath, ["cjs.cjs"], consumerRoot);
  runPnpm(["exec", "tsc", "-p", "tsconfig.json"], consumerRoot);

  const installedManifest = JSON.parse(
    await readFile(
      path.join(consumerRoot, "node_modules", "@x-oidc", "contracts", "package.json"),
      "utf8",
    ),
  );
  if (installedManifest.name !== "@x-oidc/contracts") {
    throw new Error("临时消费者安装了错误的 package");
  }

  console.log(`contracts tarball 消费测试通过，共验证 ${filePaths.length} 个文件`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
