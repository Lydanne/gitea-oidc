import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RELEASE_MANIFEST_PATH, WORKSPACE_MANIFEST_PATHS } from "./workspace-manifests.mjs";

const version = process.argv[2];
if (!version || !isSemver(version)) {
  throw new Error("用法: node scripts/release/sync-version.mjs <semver>");
}

const workspaceRoot = resolve(import.meta.dirname, "../..");
const targets = WORKSPACE_MANIFEST_PATHS.filter((path) => path !== RELEASE_MANIFEST_PATH).map(
  (path) => resolve(workspaceRoot, path),
);

for (const target of targets) {
  const manifest = JSON.parse(await readFile(target, "utf8"));
  if (manifest.version === version) continue;
  manifest.version = version;
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(`已同步全部 workspace 包版本为 ${version}`);

function isSemver(value) {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
    value,
  );
}
