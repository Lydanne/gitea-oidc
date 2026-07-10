import { readdir, rm } from "node:fs/promises";

const workspaceRoot = new URL("../", import.meta.url);
const outputs = [new URL("dist", workspaceRoot)];

for (const directory of ["apps", "packages", "examples"]) {
  const root = new URL(`${directory}/`, workspaceRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    outputs.push(new URL(`${entry.name}/dist`, root), new URL(`${entry.name}/.cache`, root));
  }
}

await Promise.all(outputs.map((output) => rm(output, { force: true, recursive: true })));
