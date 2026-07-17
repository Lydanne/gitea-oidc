import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RELEASE_MANIFEST_PATH, WORKSPACE_MANIFEST_PATHS } from "./workspace-manifests.mjs";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const manifests = await Promise.all(
  WORKSPACE_MANIFEST_PATHS.map(async (path) => ({
    path,
    value: JSON.parse(await readFile(resolve(workspaceRoot, path), "utf8")),
  })),
);

const expected = manifests.find(({ path }) => path === RELEASE_MANIFEST_PATH)?.value.version;
if (typeof expected !== "string") {
  throw new Error(`发布包 ${RELEASE_MANIFEST_PATH} 缺少 version`);
}
const mismatched = manifests.filter(({ value }) => value.version !== expected);
if (mismatched.length > 0) {
  throw new Error(
    `发布版本不一致: ${manifests.map(({ path, value }) => `${path}=${value.version}`).join(", ")}`,
  );
}

console.log(`发布版本一致: ${expected}`);
