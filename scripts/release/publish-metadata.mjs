#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseVersion } from "./plan-version.mjs";

export function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  const coreDifference =
    left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (coreDifference !== 0) return coreDifference;
  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  const preidDifference = left.prerelease.preid.localeCompare(right.prerelease.preid, "en");
  return preidDifference || left.prerelease.number - right.prerelease.number;
}

export function createPublishMetadata(version, distTags = {}) {
  const parsed = parseVersion(version);
  const prerelease = parsed.prerelease !== null;
  const channel = parsed.prerelease?.preid ?? "latest";
  const currentChannelVersion = distTags[channel] ?? "";
  const advanceChannel =
    currentChannelVersion === "" || compareVersions(version, currentChannelVersion) >= 0;
  const publishDistTag = advanceChannel
    ? channel
    : `recovered-${version.toLowerCase().replaceAll(/[^0-9a-z-]+/gu, "-")}`;

  return {
    version,
    tag: `v${version}`,
    prerelease,
    currentChannelVersion,
    advanceChannel,
    publishDistTag,
    dockerChannel: channel,
  };
}

export function formatPublishMetadata(metadata, format = "json") {
  if (format === "json") return JSON.stringify(metadata, null, 2);
  if (format === "github") {
    return [
      `version=${metadata.version}`,
      `tag=${metadata.tag}`,
      `prerelease=${metadata.prerelease}`,
      `currentChannelVersion=${metadata.currentChannelVersion}`,
      `advanceChannel=${metadata.advanceChannel}`,
      `publishDistTag=${metadata.publishDistTag}`,
      `dockerChannel=${metadata.dockerChannel}`,
    ].join("\n");
  }
  throw new Error(`Unsupported format: ${format}`);
}

async function main() {
  const workspaceRoot = resolve(import.meta.dirname, "../..");
  const manifest = JSON.parse(
    await readFile(resolve(workspaceRoot, "packages/server-core/package.json"), "utf8"),
  );
  const formatArgument = process.argv.find((argument) => argument.startsWith("--format="));
  const format = formatArgument?.slice("--format=".length) ?? "json";
  const distTags = process.env.NPM_DIST_TAGS_JSON ? JSON.parse(process.env.NPM_DIST_TAGS_JSON) : {};
  process.stdout.write(
    `${formatPublishMetadata(createPublishMetadata(manifest.version, distTags), format)}\n`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
