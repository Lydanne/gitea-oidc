import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const boundaries = new Map([
  ["apps/admin-web", new Set(["@gitea-oidc/contracts"])],
  ["apps/portal-web", new Set()],
  ["apps/idp-server", new Set(["gitea-oidc"])],
  ["packages/contracts", new Set()],
  ["packages/application-templates", new Set(["@gitea-oidc/contracts"])],
  [
    "packages/applications",
    new Set(["@gitea-oidc/application-templates", "@gitea-oidc/contracts"]),
  ],
  ["packages/cli", new Set(["@gitea-oidc/contracts"])],
  ["packages/connector-core", new Set(["@gitea-oidc/node"])],
  ["packages/connector-testkit", new Set(["@gitea-oidc/connector-core", "@gitea-oidc/node"])],
  [
    "packages/express",
    new Set(["@gitea-oidc/connector-core", "@gitea-oidc/connector-testkit", "@gitea-oidc/node"]),
  ],
  [
    "packages/fastify",
    new Set(["@gitea-oidc/connector-core", "@gitea-oidc/connector-testkit", "@gitea-oidc/node"]),
  ],
  ["packages/nestjs", new Set(["@gitea-oidc/connector-core", "@gitea-oidc/node"])],
  ["packages/oidc-client", new Set(["@gitea-oidc/contracts"])],
  ["packages/oidc-client-sqlite", new Set(["@gitea-oidc/node"])],
  [
    "packages/server-core",
    new Set([
      "@gitea-oidc/application-templates",
      "@gitea-oidc/applications",
      "@gitea-oidc/contracts",
    ]),
  ],
]);

const workspaceDirectories = [];
const workspacePackageNames = new Map();
for (const parent of ["apps", "packages"]) {
  const entries = await readdir(path.join(root, parent), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relativeDirectory = `${parent}/${entry.name}`;
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, relativeDirectory, "package.json"), "utf8"),
      );
      if (typeof manifest.name !== "string" || manifest.name.length === 0) {
        throw new Error(`${relativeDirectory}/package.json 缺少 name`);
      }
      workspaceDirectories.push(relativeDirectory);
      workspacePackageNames.set(relativeDirectory, manifest.name);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        // 没有 package.json 的辅助目录不属于 workspace package。
        continue;
      }
      throw error;
    }
  }
}

const missingBoundaries = workspaceDirectories.filter(
  (relativeDirectory) => !boundaries.has(relativeDirectory),
);
if (missingBoundaries.length > 0) {
  throw new Error(`workspace package 缺少依赖边界声明:\n${missingBoundaries.join("\n")}`);
}

const listSourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (["dist", "node_modules", ".cache", "coverage"].includes(entry.name)) return [];
        return listSourceFiles(target);
      }
      return /\.(?:ts|tsx|vue|mts|cts|mjs)$/u.test(entry.name) ? [target] : [];
    }),
  );
  return files.flat();
};

const violations = [];
for (const [relativeDirectory, allowed] of boundaries) {
  const directory = path.join(root, relativeDirectory);
  const ownPackageName = workspacePackageNames.get(relativeDirectory);
  for (const file of await listSourceFiles(directory)) {
    const source = await readFile(file, "utf8");
    const specifiers = source.matchAll(
      /(?:from\s+|import\s*\(|require\s*\()\s*["'](@gitea-oidc\/[^/"']+|gitea-oidc)(?:\/[^"']*)?["']/gu,
    );
    for (const match of specifiers) {
      const packageName = match[1];
      if (packageName !== ownPackageName && !allowed.has(packageName)) {
        violations.push(`${path.relative(root, file)} -> ${packageName}`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`workspace 依赖边界违规:\n${violations.join("\n")}`);
}

console.log(`workspace 依赖边界检查通过，共检查 ${boundaries.size} 个边界`);
