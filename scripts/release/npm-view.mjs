#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NPM_REGISTRY = "https://registry.npmjs.org/";

export function isExplicitNpmE404(output) {
  return /(?:^|\s)code\s+E404(?:\s|$)/iu.test(output);
}

export function viewNpmPackage(packageName, field, missingValue, spawn = spawnSync) {
  if (!packageName || !field || missingValue === undefined) {
    throw new Error(
      "用法: node scripts/release/npm-view.mjs <package-name> <field> <missing-json>",
    );
  }

  const result = spawn(
    "npm",
    ["view", packageName, field, "--json", `--registry=${NPM_REGISTRY}`],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    },
  );

  if (result.error) throw result.error;

  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  if (result.status === 0) {
    if (!stdout) throw new Error(`npm view ${packageName} ${field} 未返回 JSON`);
    return stdout;
  }

  const failureOutput = [stdout, stderr].filter(Boolean).join("\n");
  if (isExplicitNpmE404(failureOutput)) return missingValue;

  throw new Error(
    failureOutput || `npm view ${packageName} ${field} 失败，退出码 ${result.status}`,
  );
}

function isMainModule() {
  return Boolean(
    process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
  );
}

if (isMainModule()) {
  try {
    process.stdout.write(`${viewNpmPackage(...process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
