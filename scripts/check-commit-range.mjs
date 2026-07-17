#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const POLICY_MARKER = ".commit-policy-version";

export function parseArguments(argumentsToParse) {
  const values = new Map();
  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index];
    if (!argument.startsWith("--")) throw new Error(`不支持的参数: ${argument}`);
    const separator = argument.indexOf("=");
    if (separator >= 0) {
      values.set(argument.slice(2, separator), argument.slice(separator + 1));
      continue;
    }
    const value = argumentsToParse[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`参数 ${argument} 缺少值`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  return values;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `退出码 ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} 执行失败: ${detail}`);
  }
  return result;
}

function git(args, options) {
  return run("git", args, options);
}

function markerExistsAt(revision) {
  return (
    git(["cat-file", "-e", `${revision}:${POLICY_MARKER}`], {
      allowFailure: true,
    }).status === 0
  );
}

export function resolveLintRange(fromRevision, toRevision) {
  const mergeBase = git(["merge-base", fromRevision, toRevision]).stdout.trim();
  if (!mergeBase) throw new Error("无法确定提交检查的 merge base");

  if (markerExistsAt(mergeBase)) return { from: mergeBase, to: toRevision, bootstrapped: false };
  if (!markerExistsAt(toRevision)) {
    throw new Error(`提交范围中缺少 ${POLICY_MARKER}，无法启用提交规范`);
  }

  const adoptionCommit = git([
    "log",
    "--reverse",
    "--format=%H",
    `${mergeBase}..${toRevision}`,
    "--",
    POLICY_MARKER,
  ])
    .stdout.trim()
    .split("\n")
    .find(Boolean);
  if (!adoptionCommit) throw new Error(`无法定位 ${POLICY_MARKER} 的启用提交`);

  const adoptionParent = git(["rev-parse", `${adoptionCommit}^`]).stdout.trim();
  return { from: adoptionParent, to: toRevision, bootstrapped: true };
}

export function main(argumentsToParse = process.argv.slice(2)) {
  const args = parseArguments(argumentsToParse);
  const fromRevision = args.get("from");
  const toRevision = args.get("to");
  if (!fromRevision || !toRevision) {
    throw new Error("用法: pnpm lint:commits --from <base-sha> --to <head-sha>");
  }

  const range = resolveLintRange(fromRevision, toRevision);
  if (range.bootstrapped) {
    console.log(`提交规范从 ${range.from} 之后开始生效，旧提交不做追溯检查`);
  }
  run("pnpm", ["exec", "commitlint", "--from", range.from, "--to", range.to, "--verbose"], {
    inherit: true,
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
