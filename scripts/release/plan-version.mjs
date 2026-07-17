#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+)\.(0|[1-9]\d*))?$/u;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const VERSION_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+)\.(0|[1-9]\d*))?$/u;
const VALID_BUMPS = new Set(["auto", "patch", "minor", "major", "prerelease", "stable"]);
const VALID_FORMATS = new Set(["text", "json", "github"]);
const BUMP_RANK = { none: 0, patch: 1, minor: 2, major: 3 };

export function parseStableVersion(version) {
  const match = STABLE_VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`Invalid stable semantic version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  const preid = match[4] ? validatePreid(match[4]) : null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: preid
      ? {
          preid,
          number: Number(match[5]),
        }
      : null,
  };
}

export function versionFromTag(tag) {
  const match = VERSION_TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error(`Invalid release tag: ${tag}`);
  }

  return tag.slice(1);
}

export function assertCurrentVersionMatchesBaseTag(currentVersion, baseTag) {
  const baseVersion = versionFromTag(baseTag);
  parseVersion(currentVersion);
  if (currentVersion !== baseVersion) {
    throw new Error(`Package version ${currentVersion} does not match base tag ${baseTag}`);
  }
}

export function getCommitBump(message) {
  const normalizedMessage = message.replaceAll("\r\n", "\n");
  const [subject = "", ...bodyLines] = normalizedMessage.split("\n");
  const header = /^(?<type>[A-Za-z][A-Za-z0-9-]*)(?:\([^)\r\n]+\))?(?<breaking>!)?:\s+.+$/u.exec(
    subject,
  );
  const hasBreakingMarker = /^BREAKING(?:[ -]CHANGE)?:\s*\S.*$/imu.test(
    [subject, ...bodyLines].join("\n"),
  );

  if (header?.groups?.breaking === "!" || hasBreakingMarker) {
    return "major";
  }

  const type = header?.groups?.type.toLowerCase();
  if (type === "feat") {
    return "minor";
  }
  if (type === "fix" || type === "perf" || type === "revert") {
    return "patch";
  }

  return "none";
}

export function determineAutomaticBump(commitMessages) {
  let selectedBump = "none";

  for (const message of commitMessages) {
    const commitBump = getCommitBump(message);
    if (BUMP_RANK[commitBump] > BUMP_RANK[selectedBump]) {
      selectedBump = commitBump;
    }
  }

  return selectedBump;
}

export function validatePreid(preid) {
  if (!/^(?!v?\d)[A-Za-z][0-9A-Za-z-]*$/u.test(preid) || preid.toLowerCase() === "latest") {
    throw new Error(`Invalid prerelease identifier: ${preid}`);
  }
  return preid;
}

export function incrementVersion(version, bump, preid) {
  const parsed = parseVersion(version);
  const coreVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`;

  if (bump === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  if (bump === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
  if (bump === "prerelease") {
    const targetPreid = validatePreid(preid ?? parsed.prerelease?.preid ?? "rc");
    if (parsed.prerelease) {
      const nextNumber = targetPreid === parsed.prerelease.preid ? parsed.prerelease.number + 1 : 0;
      return `${coreVersion}-${targetPreid}.${nextNumber}`;
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${targetPreid}.0`;
  }
  if (bump === "stable") {
    if (!parsed.prerelease) {
      throw new Error("Stable bump requires a prerelease current version");
    }
    return coreVersion;
  }
  if (bump === "none") {
    return version;
  }

  throw new Error(`Unsupported bump: ${bump}`);
}

export function createVersionPlan({
  currentVersion,
  baseTag,
  requestedBump = "auto",
  preid,
  commitMessages = [],
}) {
  if (!VALID_BUMPS.has(requestedBump)) {
    throw new Error(`Unsupported bump: ${requestedBump}`);
  }

  assertCurrentVersionMatchesBaseTag(currentVersion, baseTag);
  const current = parseVersion(currentVersion);
  const automaticBump = determineAutomaticBump(commitMessages);
  const bump =
    requestedBump === "auto"
      ? current.prerelease && automaticBump !== "none"
        ? "prerelease"
        : automaticBump
      : requestedBump;
  const releaseNeeded = bump !== "none";
  const nextVersion = releaseNeeded
    ? incrementVersion(currentVersion, bump, preid)
    : currentVersion;

  return {
    currentVersion,
    baseTag,
    bump,
    nextVersion,
    releaseNeeded,
    commitCount: commitMessages.length,
  };
}

function readOptionValue(argumentsList, index, optionName) {
  const argument = argumentsList[index];
  const inlinePrefix = `${optionName}=`;
  if (argument.startsWith(inlinePrefix)) {
    const value = argument.slice(inlinePrefix.length);
    if (!value) {
      throw new Error(`${optionName} requires a value`);
    }
    return { value, consumed: 0 };
  }

  if (argument === optionName) {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${optionName} requires a value`);
    }
    return { value, consumed: 1 };
  }

  return null;
}

export function parseArguments(argumentsList) {
  const options = {
    bump: "auto",
    preid: undefined,
    format: "text",
    help: false,
  };
  let preidWasProvided = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    const bumpOption = readOptionValue(argumentsList, index, "--bump");
    if (bumpOption) {
      options.bump = bumpOption.value;
      index += bumpOption.consumed;
      continue;
    }

    const preidOption = readOptionValue(argumentsList, index, "--preid");
    if (preidOption) {
      options.preid = preidOption.value;
      preidWasProvided = true;
      index += preidOption.consumed;
      continue;
    }

    const formatOption = readOptionValue(argumentsList, index, "--format");
    if (formatOption) {
      options.format = formatOption.value;
      index += formatOption.consumed;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!VALID_BUMPS.has(options.bump)) {
    throw new Error(`Unsupported bump: ${options.bump}`);
  }
  if (!VALID_FORMATS.has(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }
  if (preidWasProvided && options.bump !== "prerelease") {
    throw new Error("--preid can only be used with --bump prerelease");
  }
  if (options.preid !== undefined) {
    validatePreid(options.preid);
  }

  return options;
}

export function formatPlan(plan, format) {
  if (format === "json") {
    return JSON.stringify(plan, null, 2);
  }

  if (format === "github") {
    return [
      `currentVersion=${plan.currentVersion}`,
      `baseTag=${plan.baseTag}`,
      `bump=${plan.bump}`,
      `nextVersion=${plan.nextVersion}`,
      `releaseNeeded=${plan.releaseNeeded}`,
      `commitCount=${plan.commitCount}`,
    ].join("\n");
  }

  if (format === "text") {
    return [
      `Current version: ${plan.currentVersion}`,
      `Base tag: ${plan.baseTag}`,
      `Bump: ${plan.bump}`,
      `Next version: ${plan.nextVersion}`,
      `Release needed: ${plan.releaseNeeded}`,
      `Commit count: ${plan.commitCount}`,
    ].join("\n");
  }

  throw new Error(`Unsupported format: ${format}`);
}

function runGit(repositoryRoot, argumentsList) {
  return execFileSync("git", argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function selectBaseTag(currentVersion, candidates) {
  parseVersion(currentVersion);
  const exactTag = `v${currentVersion}`;
  if (candidates.some((candidate) => candidate.tag === exactTag)) {
    return exactTag;
  }
  throw new Error(`No reachable tag matches package version ${currentVersion}`);
}

export function findBaseTag(repositoryRoot, currentVersion) {
  const tags = runGit(repositoryRoot, ["tag", "--merged", "HEAD", "--list", "v*"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => VERSION_TAG_PATTERN.test(tag));

  if (tags.length === 0) {
    throw new Error("No reachable vX.Y.Z or vX.Y.Z-preid.N tag found");
  }

  const candidates = tags.map((tag) => ({
    tag,
    distance: Number(runGit(repositoryRoot, ["rev-list", "--count", `${tag}..HEAD`])),
  }));
  return selectBaseTag(currentVersion, candidates);
}

export function readCommitMessages(repositoryRoot, baseTag) {
  const output = execFileSync("git", ["log", "--format=%B%x00", `${baseTag}..HEAD`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return output
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
}

export function runVersionPlanner({ repositoryRoot, bump, preid }) {
  const packagePath = resolve(repositoryRoot, "packages/server-core/package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof packageJson.version !== "string") {
    throw new Error(`${packagePath} does not contain a string version`);
  }

  const baseTag = findBaseTag(repositoryRoot, packageJson.version);
  const commitMessages = readCommitMessages(repositoryRoot, baseTag);
  return createVersionPlan({
    currentVersion: packageJson.version,
    baseTag,
    requestedBump: bump,
    preid,
    commitMessages,
  });
}

export const USAGE = `Usage: node scripts/release/plan-version.mjs [options]

Options:
  --bump <auto|patch|minor|major|prerelease|stable>
                                               Version bump (default: auto)
  --preid <identifier>                         Prerelease id (current id or rc by default)
  --format <text|json|github>                Output format (default: text)
  --help                                     Show this help`;

function isMainModule() {
  return Boolean(
    process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
  );
}

if (isMainModule()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
    } else {
      const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
      const plan = runVersionPlanner({
        repositoryRoot,
        bump: options.bump,
        preid: options.preid,
      });
      process.stdout.write(`${formatPlan(plan, options.format)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Version planning failed: ${message}\n`);
    process.exitCode = 1;
  }
}
