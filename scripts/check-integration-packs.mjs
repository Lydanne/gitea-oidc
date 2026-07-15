import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "gitea-oidc-integration-packs-"));
const consumerRoot = path.join(temporaryRoot, "consumer");
const packageDefinitions = [
  ["@gitea-oidc/contracts", "packages/contracts"],
  ["@gitea-oidc/node", "packages/oidc-client"],
  ["@gitea-oidc/node-sqlite", "packages/oidc-client-sqlite"],
  ["@gitea-oidc/connector-core", "packages/connector-core"],
  ["@gitea-oidc/express", "packages/express"],
  ["@gitea-oidc/fastify", "packages/fastify"],
  ["@gitea-oidc/nestjs", "packages/nestjs"],
  ["@gitea-oidc/cli", "packages/cli"],
];

const run = (command, args, cwd, capture = false) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HUSKY: "0" },
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
  return pnpmCli
    ? run(process.execPath, [pnpmCli, ...args], cwd, capture)
    : run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, cwd, capture);
};

const findWorkspaceReference = (value, location = "package.json") => {
  if (typeof value === "string") {
    return value.startsWith("workspace:") ? `${location}=${value}` : undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findWorkspaceReference(item, `${location}[${index}]`);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const found = findWorkspaceReference(item, `${location}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
};

try {
  const localTarballs = {};
  for (const [packageName, packageDirectory] of packageDefinitions) {
    const packageRoot = path.join(workspaceRoot, packageDirectory);
    const tarballPath = path.join(
      temporaryRoot,
      `${packageName.replace(/^@/u, "").replaceAll("/", "-")}.tgz`,
    );
    const result = JSON.parse(runPnpm(["pack", "--json", "--out", tarballPath], packageRoot, true));
    const paths = result.files.map((file) => file.path);
    const unexpected = paths.filter(
      (filePath) =>
        !["LICENSE", "README.md", "package.json"].includes(filePath) &&
        !filePath.startsWith("dist/"),
    );
    if (unexpected.length > 0) {
      throw new Error(`${packageName} tarball 包含白名单外文件: ${unexpected.join(", ")}`);
    }
    if (
      paths.some(
        (filePath) =>
          filePath.includes("/__tests__/") ||
          filePath.endsWith(".tsbuildinfo") ||
          filePath.endsWith(".db") ||
          filePath.endsWith(".db-wal") ||
          filePath.endsWith(".db-shm"),
      )
    ) {
      throw new Error(`${packageName} tarball 包含测试、缓存或数据库文件`);
    }
    for (const required of ["LICENSE", "README.md", "package.json"]) {
      if (!paths.includes(required)) throw new Error(`${packageName} tarball 缺少 ${required}`);
    }
    const packedManifest = JSON.parse(
      run("tar", ["-xOf", tarballPath, "package/package.json"], workspaceRoot, true),
    );
    const workspaceReference = findWorkspaceReference(packedManifest);
    if (workspaceReference) {
      throw new Error(`${packageName} tarball 泄漏 workspace 协议: ${workspaceReference}`);
    }
    localTarballs[packageName] = `file:${tarballPath}`;
  }

  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    path.join(temporaryRoot, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        pnpm: {
          // 让 tarball 之间的传递依赖也解析到本轮刚生成的真实包，而不是访问注册表。
          overrides: localTarballs,
          // pnpm 10 默认阻止依赖脚本，只放行原生 SQLite 绑定的受控构建。
          onlyBuiltDependencies: ["better-sqlite3"],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(temporaryRoot, "pnpm-workspace.yaml"), "packages:\n  - consumer\n");
  await copyFile(
    path.join(workspaceRoot, "pnpm-lock.yaml"),
    path.join(temporaryRoot, "pnpm-lock.yaml"),
  );
  await writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "gitea-oidc-integration-pack-consumer",
        private: true,
        dependencies: {
          ...localTarballs,
          // 使用锁文件已有的精确版本，避免消费检查随 registry 最新版本漂移。
          "@nestjs/common": "11.1.28",
          "@nestjs/core": "11.1.28",
          "@nestjs/platform-express": "11.1.28",
          "@nestjs/platform-fastify": "11.1.28",
          "better-sqlite3": "12.4.1",
          express: "5.2.1",
          fastify: "5.10.0",
          "openid-client": "6.8.4",
          "reflect-metadata": "0.2.2",
          rxjs: "7.8.2",
          zod: "4.1.12",
        },
        devDependencies: {
          "@types/express": "5.0.5",
          "@types/node": "22.19.1",
          typescript: "5.9.3",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(consumerRoot, "esm.mjs"),
    [
      'import { parseApplicationConnectionV1 } from "@gitea-oidc/contracts";',
      'import { createInMemoryNodeOidcClient } from "@gitea-oidc/node";',
      'import { createSqliteOidcStores } from "@gitea-oidc/node-sqlite";',
      'import { createWebConnectorCore } from "@gitea-oidc/connector-core";',
      'import { createExpressOidc } from "@gitea-oidc/express";',
      'import { createFastifyOidc } from "@gitea-oidc/fastify";',
      'import { NestOidcModule } from "@gitea-oidc/nestjs";',
      'import { runCli } from "@gitea-oidc/cli";',
      "for (const value of [parseApplicationConnectionV1, createInMemoryNodeOidcClient, createSqliteOidcStores, createWebConnectorCore, createExpressOidc, createFastifyOidc, NestOidcModule, runCli]) {",
      '  if (typeof value !== "function") throw new Error("ESM export missing");',
      "}",
      "const sqliteStores = createSqliteOidcStores({",
      '  dbPath: ":memory:",',
      "  encryptionKey: new Uint8Array(32).fill(7),",
      "});",
      "await sqliteStores.close();",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(consumerRoot, "cjs.cjs"),
    [
      'const modules = [require("@gitea-oidc/contracts"), require("@gitea-oidc/node"), require("@gitea-oidc/node-sqlite"), require("@gitea-oidc/connector-core"), require("@gitea-oidc/express"), require("@gitea-oidc/fastify"), require("@gitea-oidc/nestjs"), require("@gitea-oidc/cli")];',
      'if (modules.some((value) => !value || typeof value !== "object")) throw new Error("CJS export missing");',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(consumerRoot, "consumer.ts"),
    [
      'import type { ApplicationConnectionV1 } from "@gitea-oidc/contracts";',
      'import { createNodeOidcClient, type AuthSessionView } from "@gitea-oidc/node";',
      'import { createSqliteOidcStores } from "@gitea-oidc/node-sqlite";',
      'import type { WebConnectorCoreOptions } from "@gitea-oidc/connector-core";',
      'import { createExpressOidc } from "@gitea-oidc/express";',
      'import { createFastifyOidc } from "@gitea-oidc/fastify";',
      'import { NestOidcModule } from "@gitea-oidc/nestjs";',
      'import { runCli } from "@gitea-oidc/cli";',
      "declare const connection: ApplicationConnectionV1;",
      "declare const options: WebConnectorCoreOptions;",
      "declare const session: AuthSessionView;",
      "void [connection, options, session, createNodeOidcClient, createSqliteOidcStores, createExpressOidc, createFastifyOidc, NestOidcModule, runCli];",
      "",
    ].join("\n"),
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

  // node-sqlite 的消费验收必须执行 better-sqlite3 安装脚本，才能验证当前 Node ABI。
  // 临时 consumer 不在仓库锁文件的 importer 中；优先复用缓存，缺元数据时允许从 registry 补齐。
  runPnpm(["install", "--prefer-offline", "--no-frozen-lockfile"], temporaryRoot);
  run(process.execPath, ["esm.mjs"], consumerRoot);
  run(process.execPath, ["cjs.cjs"], consumerRoot);
  runPnpm(["exec", "tsc", "-p", "tsconfig.json"], consumerRoot);
  const cliBin = path.join(consumerRoot, "node_modules", ".bin", "gitea-oidc");
  const help = run(cliBin, ["--help"], consumerRoot, true);
  if (!help.includes("gitea-oidc")) throw new Error("CLI tarball bin 未输出帮助");

  console.log(`SDK 与连接器 tarball 消费检查通过，共 ${packageDefinitions.length} 个包`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
