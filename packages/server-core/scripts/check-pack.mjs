import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
const packDir = await mkdtemp(join(tmpdir(), "gitea-oidc-pack-"));
const npmEnvironment = {
  ...process.env,
  HUSKY: "0",
  NPM_CONFIG_CACHE: join(packDir, ".npm-cache"),
};

try {
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: npmEnvironment,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) {
    throw new Error("npm pack 未返回 JSON 结果");
  }
  const [packResult] = JSON.parse(output.slice(jsonStart));
  const tarballPath = join(packDir, packResult.filename);
  const readPackedFile = (path) =>
    execFileSync("tar", ["-xOf", tarballPath, `package/${path}`], { encoding: "utf8" });
  const paths = packResult.files.map((file) => file.path);
  const packedManifest = JSON.parse(readPackedFile("package.json"));
  const workspaceReference = findWorkspaceReference(packedManifest);
  if (workspaceReference) {
    throw new Error(`npm tarball manifest 泄漏 workspace 协议: ${workspaceReference}`);
  }

  const requiredPaths = [
    packageJson.main,
    packageJson.types,
    ...Object.values(packageJson.exports).flatMap((entry) => Object.values(entry)),
    "package.json",
    "public/index.html",
    "public/error-session-expired.html",
    "public/admin/index.html",
    "public/portal/index.html",
  ].map((path) => path.replace(/^\.\//, ""));
  const missingPaths = requiredPaths.filter((path) => !paths.includes(path));
  if (missingPaths.length > 0) {
    throw new Error(`npm tarball 缺少运行文件: ${missingPaths.join(", ")}`);
  }

  const assertWebAssets = (surface, label) => {
    const references = new Set(
      Array.from(
        readPackedFile(`public/${surface}/index.html`).matchAll(/(?:src|href)="\.\/([^"]+)"/gu),
        (match) => `public/${surface}/${match[1]}`,
      ),
    );
    for (const path of paths.filter(
      (path) => path.startsWith(`public/${surface}/assets/`) && /\.(?:css|js)$/u.test(path),
    )) {
      const asset = readPackedFile(path);
      const relativeReferences = [
        ...Array.from(
          asset.matchAll(
            /["'](\.\/[^"']+\.(?:css|eot|gif|jpe?g|js|png|svg|ttf|webp|woff2?))["']/gu,
          ),
          (match) => match[1],
        ),
        ...Array.from(
          asset.matchAll(
            /url\((?:["']?)(\.\/[^)"']+\.(?:eot|gif|jpe?g|png|svg|ttf|webp|woff2?))(?:["']?)\)/gu,
          ),
          (match) => match[1],
        ),
      ];
      for (const reference of relativeReferences) {
        references.add(posix.normalize(posix.join(posix.dirname(path), reference)));
      }
    }
    const missingAssets = [...references].filter((path) => !paths.includes(path));
    if (missingAssets.length > 0) {
      throw new Error(`${label}入口引用了未打包资源: ${missingAssets.join(", ")}`);
    }
  };

  assertWebAssets("admin", "管理台");
  assertWebAssets("portal", "用户门户");

  const allowedRootFiles = new Set(["LICENSE", "README.md", "README.en.md", "package.json"]);
  const forbiddenPaths = paths.filter(
    (path) =>
      !allowedRootFiles.has(path) && !path.startsWith("dist/") && !path.startsWith("public/"),
  );
  if (forbiddenPaths.length > 0) {
    throw new Error(`npm tarball 包含未授权文件: ${forbiddenPaths.join(", ")}`);
  }

  for (const path of paths) {
    if (
      path.includes("/__tests__/") ||
      path.endsWith(".tsbuildinfo") ||
      path.endsWith(".db") ||
      path.endsWith(".db-shm") ||
      path.endsWith(".db-wal")
    ) {
      throw new Error(`npm tarball 包含测试或数据库文件: ${path}`);
    }
  }

  const declarationFiles = await listFiles(fileURLToPath(new URL("dist", packageRoot)), ".d.ts");
  for (const declarationFile of declarationFiles) {
    const declaration = await readFile(declarationFile, "utf8");
    if (declaration.includes('"@gitea-oidc/applications"')) {
      throw new Error(`公开声明泄漏私有 workspace 类型: ${declarationFile}`);
    }
    const relativeSpecifiers = Array.from(
      declaration.matchAll(/(?:from\s+|import\()["'](\.{1,2}\/[^"']+)["']/g),
      (match) => match[1],
    );
    const invalidSpecifier = relativeSpecifiers.find(
      (specifier) => !specifier.endsWith(".js") && !specifier.endsWith(".json"),
    );
    if (invalidSpecifier) {
      throw new Error(`声明文件包含 NodeNext 无法解析的路径: ${invalidSpecifier}`);
    }
  }

  const javascriptFiles = await listFiles(fileURLToPath(new URL("dist", packageRoot)), ".js");
  for (const javascriptFile of javascriptFiles) {
    const javascript = await readFile(javascriptFile, "utf8");
    if (
      /(?:from\s+|import\()["']@gitea-oidc\/(?:applications|contracts)(?:\/[^"']*)?["']/.test(
        javascript,
      )
    ) {
      throw new Error(`发布 JS 仍依赖 workspace 包: ${javascriptFile}`);
    }
  }

  const importScript = [
    "gitea-oidc",
    "gitea-oidc/server",
    "gitea-oidc/config",
    "gitea-oidc/client",
    "gitea-oidc/express",
    "gitea-oidc/nest",
    "gitea-oidc/vue",
  ]
    .map((specifier) => `await import(${JSON.stringify(specifier)});`)
    .join("\n");
  const consumerDir = join(packDir, "consumer");
  await mkdir(consumerDir);
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify({ name: "gitea-oidc-pack-consumer", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(packDir, packResult.filename)],
    {
      cwd: consumerDir,
      env: npmEnvironment,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  execFileSync(process.execPath, ["--input-type=module", "--eval", importScript], {
    cwd: consumerDir,
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "inherit",
  });

  const typeFixture = join(consumerDir, "consumer.ts");
  await writeFile(
    typeFixture,
    [
      'import { createIdentityServer, type IdentityServerOptions } from "gitea-oidc/server";',
      'import type { GiteaOidcConfig } from "gitea-oidc/config";',
      'import { GiteaOidcClient } from "gitea-oidc/client";',
      'const options: IdentityServerOptions = { publicDir: "public" };',
      "declare const config: GiteaOidcConfig;",
      'type LegacyServer = Omit<GiteaOidcConfig["server"], "corsOrigins" | "trustedProxyIps">;',
      'type LegacyConfig = Omit<GiteaOidcConfig, "server" | "audit" | "admin" | "providerApi" | "applications"> & { server: LegacyServer };',
      "declare const legacyConfig: LegacyConfig;",
      "const compatibleConfig: GiteaOidcConfig = legacyConfig;",
      "void createIdentityServer(config, options);",
      "void compatibleConfig;",
      "void GiteaOidcClient;",
      "",
    ].join("\n"),
    "utf8",
  );
  const tscPath = fileURLToPath(
    new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
  );
  const typeRoots = fileURLToPath(new URL("node_modules/@types", packageRoot));
  execFileSync(
    process.execPath,
    [
      tscPath,
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--skipLibCheck",
      "--typeRoots",
      typeRoots,
      typeFixture,
    ],
    { cwd: consumerDir, stdio: "inherit" },
  );

  console.log(
    `npm tarball 与 exports 检查通过，共 ${paths.length} 个文件，产物 ${packResult.filename}`,
  );
} finally {
  await rm(packDir, { force: true, recursive: true });
}

async function listFiles(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path, suffix) : [path];
    }),
  );
  return nestedFiles.flat().filter((path) => path.endsWith(suffix));
}

function findWorkspaceReference(value, path = "package.json") {
  if (typeof value === "string") {
    return value.startsWith("workspace:") ? `${path}=${value}` : undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findWorkspaceReference(item, `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const found = findWorkspaceReference(item, `${path}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}
