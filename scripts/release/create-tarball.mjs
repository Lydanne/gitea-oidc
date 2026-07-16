import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const packageRoot = resolve(workspaceRoot, "packages/server-core");
const outputDir = resolve(workspaceRoot, "artifacts/npm");
const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const npmCache = await mkdtemp(resolve(tmpdir(), "x-oidc-npm-cache-"));

try {
  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const output = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", outputDir],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, HUSKY: "0", NPM_CONFIG_CACHE: npmCache },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) throw new Error("npm pack 未返回 JSON 结果");
  const [result] = JSON.parse(output.slice(jsonStart));
  if (!result?.filename) throw new Error("npm pack 未返回 tarball 文件名");

  const files = (await readdir(outputDir)).filter((file) => file.endsWith(".tgz"));
  if (files.length !== 1 || files[0] !== result.filename) {
    throw new Error(`发布目录中的 tarball 数量或名称异常: ${files.join(", ") || "empty"}`);
  }

  const tarball = await readFile(resolve(outputDir, result.filename));
  const checksum = createHash("sha256").update(tarball).digest("hex");
  await writeFile(resolve(outputDir, "SHA256SUMS"), `${checksum}  ${result.filename}\n`, "utf8");

  if (result.version !== manifest.version) {
    throw new Error(`tarball 版本 ${result.version} 与 package.json ${manifest.version} 不一致`);
  }
  if (result.name !== manifest.name) {
    throw new Error(`tarball 包名 ${result.name} 与 package.json ${manifest.name} 不一致`);
  }

  console.log(`发布 tarball 已生成: ${result.filename}`);
} finally {
  await rm(npmCache, { force: true, recursive: true });
}
