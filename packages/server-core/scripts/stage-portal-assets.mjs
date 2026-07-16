import { access, cp, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = fileURLToPath(new URL("../../../apps/portal-web/dist", import.meta.url));
const targetDir = fileURLToPath(new URL("../public/portal", import.meta.url));
const sourceIndex = resolve(sourceDir, "index.html");

try {
  await access(sourceIndex);
} catch {
  throw new Error("用户门户尚未构建，请先运行 pnpm build:portal");
}

await rm(targetDir, { force: true, recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

const indexHtml = await readFile(resolve(targetDir, "index.html"), "utf8");
const assetReferences = Array.from(
  indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g),
  (match) => match[1],
).filter((reference) => !reference.startsWith("http") && !reference.startsWith("data:"));

for (const reference of assetReferences) {
  const relativePath = reference.replace(/^\/portal\//, "").replace(/^\.\//, "");
  const assetPath = resolve(targetDir, relativePath);
  if (!assetPath.startsWith(`${resolve(targetDir)}/`)) {
    throw new Error(`用户门户产物包含越界资源路径: ${reference}`);
  }
  try {
    await access(assetPath);
  } catch {
    throw new Error(`用户门户产物引用了不存在的资源: ${reference}`);
  }
}

console.log(`用户门户产物已装配到 ${dirname(resolve(targetDir, "index.html"))}`);
