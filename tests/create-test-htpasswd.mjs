import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("用法: node tests/create-test-htpasswd.mjs <output-path>");
}

const workspaceRoot = resolve(import.meta.dirname, "..");
const requireFromServerCore = createRequire(
  resolve(workspaceRoot, "packages/server-core/package.json"),
);
const bcrypt = requireFromServerCore("bcrypt");
const passwordHash = await bcrypt.hash("docker-test-password", 10);

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(resolve(outputPath), `admin:${passwordHash}\n`, "utf8");
await chmod(resolve(outputPath), 0o644);

console.log(`Docker 测试密码文件已生成: ${resolve(outputPath)}`);
