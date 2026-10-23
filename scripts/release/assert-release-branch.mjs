#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertReleaseBranchState({
  expectedBaseSha,
  recordedBaseSha,
  mergeBaseSha,
  aheadCount,
}) {
  if (!recordedBaseSha) {
    throw new Error("发布分支缺少 Release-Plan-Base trailer，不能确认它的规划基线");
  }
  if (recordedBaseSha !== expectedBaseSha || mergeBaseSha !== expectedBaseSha) {
    throw new Error(
      `发布分支已经过期：规划基线 ${recordedBaseSha}，当前 main ${expectedBaseSha}，merge-base ${mergeBaseSha}`,
    );
  }
  if (aheadCount !== 1) {
    throw new Error(`发布分支必须只包含一个自动生成提交，当前包含 ${aheadCount} 个提交`);
  }
}

export function assertReleaseBranch(baseRef, branchRef, runGit = defaultRunGit) {
  const expectedBaseSha = runGit(["rev-parse", `${baseRef}^{commit}`]);
  const recordedBaseSha = runGit([
    "show",
    "--no-patch",
    "--format=%(trailers:key=Release-Plan-Base,valueonly)",
    branchRef,
  ]);
  const mergeBaseSha = runGit(["merge-base", baseRef, branchRef]);
  const aheadCount = Number(runGit(["rev-list", "--count", `${baseRef}..${branchRef}`]));

  assertReleaseBranchState({
    expectedBaseSha,
    recordedBaseSha,
    mergeBaseSha,
    aheadCount,
  });
}

function defaultRunGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isMainModule() {
  return Boolean(
    process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
  );
}

if (isMainModule()) {
  try {
    const baseRef = readArgument("--base");
    const branchRef = readArgument("--branch");
    if (!baseRef || !branchRef) {
      throw new Error("用法: assert-release-branch.mjs --base <main-ref> --branch <release-ref>");
    }
    assertReleaseBranch(baseRef, branchRef);
    process.stdout.write(`发布分支 ${branchRef} 仍基于当前 ${baseRef}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("请关闭旧发布 PR、删除旧发布分支，然后重新运行 Prepare Release。\n");
    process.exitCode = 1;
  }
}
