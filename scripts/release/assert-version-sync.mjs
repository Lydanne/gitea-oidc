import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const manifests = await Promise.all(
  ["packages/server-core/package.json", "apps/idp-server/package.json"].map(async (path) => ({
    path,
    value: JSON.parse(await readFile(resolve(workspaceRoot, path), "utf8")),
  })),
);

const expected = manifests[0].value.version;
const mismatched = manifests.filter(({ value }) => value.version !== expected);
if (mismatched.length > 0) {
  throw new Error(
    `发布版本不一致: ${manifests.map(({ path, value }) => `${path}=${value.version}`).join(", ")}`,
  );
}

console.log(`发布版本一致: ${expected}`);
