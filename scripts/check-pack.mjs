import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  env: { ...process.env, HUSKY: "0" },
  stdio: ["ignore", "pipe", "inherit"],
});
const jsonStart = output.indexOf("[");
if (jsonStart < 0) {
  throw new Error("npm pack 未返回 JSON 结果");
}
const [packResult] = JSON.parse(output.slice(jsonStart));
const paths = packResult.files.map((file) => file.path);

const requiredPaths = [
  packageJson.main,
  packageJson.types,
  ...Object.values(packageJson.exports).flatMap((entry) => Object.values(entry)),
  "package.json",
  "public/admin/index.html",
].map((path) => path.replace(/^\.\//, ""));
const missingPaths = requiredPaths.filter((path) => !paths.includes(path));
if (missingPaths.length > 0) {
  throw new Error(`npm tarball 缺少运行文件: ${missingPaths.join(", ")}`);
}

const allowedRootFiles = new Set(["LICENSE", "README.md", "README.en.md", "package.json"]);
const forbiddenPaths = paths.filter(
  (path) =>
    !allowedRootFiles.has(path) && !path.startsWith("dist/") && !path.startsWith("public/admin/"),
);
if (forbiddenPaths.length > 0) {
  throw new Error(`npm tarball 包含未授权文件: ${forbiddenPaths.join(", ")}`);
}

for (const path of paths) {
  if (
    path.includes("/__tests__/") ||
    path.endsWith(".db") ||
    path.endsWith(".db-shm") ||
    path.endsWith(".db-wal")
  ) {
    throw new Error(`npm tarball 包含测试或数据库文件: ${path}`);
  }
}

console.log(`npm tarball 检查通过，共 ${paths.length} 个文件`);
