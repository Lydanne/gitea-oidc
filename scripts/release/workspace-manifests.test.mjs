import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { RELEASE_MANIFEST_PATH, WORKSPACE_MANIFEST_PATHS } from "./workspace-manifests.mjs";

const workspaceRoot = resolve(import.meta.dirname, "../..");

test("全部 X OIDC workspace 包保持同一版本", async () => {
  assert.equal(WORKSPACE_MANIFEST_PATHS.length, 16);
  assert.ok(WORKSPACE_MANIFEST_PATHS.includes(RELEASE_MANIFEST_PATH));

  const manifests = await Promise.all(
    WORKSPACE_MANIFEST_PATHS.map(async (path) => ({
      path,
      value: JSON.parse(await readFile(resolve(workspaceRoot, path), "utf8")),
    })),
  );
  const releaseVersion = manifests.find(({ path }) => path === RELEASE_MANIFEST_PATH)?.value
    .version;

  for (const { path, value } of manifests) {
    assert.match(value.name, /^@x-oidc\/[a-z0-9-]+$/u, `${path} 包名不属于 @x-oidc scope`);
    assert.equal(value.version, releaseVersion, `${path} 版本未与发布包同步`);
  }
});
