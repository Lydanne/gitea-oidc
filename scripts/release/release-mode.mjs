#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function resolveReleaseMode({
  eventName,
  resumeTag = "",
  bootstrapConfirmation = "",
  packageName,
  version,
  tagExists,
  npmVersions,
}) {
  if (!eventName || !packageName || !version) {
    throw new Error("发布模式缺少 eventName、packageName 或 version");
  }

  const tag = `v${version}`;
  const versions = normalizeNpmVersions(npmVersions);
  const packageExists = versions.length > 0;
  const npmPublished = versions.includes(version);
  const bootstrapMode = bootstrapConfirmation !== "";
  const expectedConfirmation = `publish ${packageName}@${version}`;

  if (eventName === "workflow_dispatch") {
    if (bootstrapMode && resumeTag) {
      throw new Error("首次 npm 发布与 tag 恢复不能在同一次运行中同时启用");
    }

    if (bootstrapMode) {
      if (bootstrapConfirmation !== expectedConfirmation) {
        throw new Error(`首次 npm 发布确认值必须精确填写: ${expectedConfirmation}`);
      }
      if (tagExists) {
        throw new Error(`首次 npm 发布要求 ${tag} 尚未创建；已有 tag 必须使用 resume_tag 恢复`);
      }
      if (packageExists && !npmPublished) {
        throw new Error(
          `${packageName} 已存在，不能再使用首次发布 Token；请配置 Trusted Publisher 后重新运行正常发布`,
        );
      }
    } else {
      if (!resumeTag) {
        throw new Error("手动运行必须填写 resume_tag，或填写一次性 npm bootstrap 确认值");
      }
      if (resumeTag !== tag) {
        throw new Error(`恢复 tag ${resumeTag} 与包版本 ${tag} 不一致`);
      }
      if (!tagExists) {
        throw new Error(`恢复 tag ${tag} 不存在；只有首次 npm bootstrap 恢复可以在发布后补建 tag`);
      }
    }
  } else if (resumeTag || bootstrapMode) {
    throw new Error("push 事件不能携带手动发布输入");
  }

  if (!packageExists && tagExists) {
    throw new Error(`npm 包尚不存在，但不可变 tag ${tag} 已经存在；请人工核对后再发布`);
  }
  if (npmPublished && !tagExists && !bootstrapMode) {
    throw new Error(
      `npm 版本 ${packageName}@${version} 已发布但缺少 ${tag}；请从 main 手动运行一次性 bootstrap 恢复`,
    );
  }

  const bootstrapRequired = !packageExists && !bootstrapMode;
  const shouldRelease = !npmPublished || resumeTag !== "" || bootstrapMode;

  return {
    bootstrapMode,
    bootstrapRequired,
    packageExists,
    npmPublished,
    shouldRelease,
  };
}

export function resolveNpmRegistryState(npmVersions, version) {
  if (!version) {
    throw new Error("npm Registry 状态检查缺少 version");
  }

  const versions = normalizeNpmVersions(npmVersions);
  if (versions.includes(version)) return "version-exists";
  return versions.length > 0 ? "package-exists" : "package-missing";
}

function normalizeNpmVersions(npmVersions) {
  const versions = Array.isArray(npmVersions) ? npmVersions : [npmVersions].filter(Boolean);
  if (versions.some((value) => typeof value !== "string" || !value)) {
    throw new Error("npm Registry versions 响应必须是非空版本字符串或字符串数组");
  }
  return versions;
}

function parseBoolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} 必须是 true 或 false`);
}

function formatGithubOutput(state) {
  return Object.entries(state)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
}

function isMainModule() {
  return Boolean(
    process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
  );
}

if (isMainModule()) {
  try {
    const state = resolveReleaseMode({
      eventName: process.env.EVENT_NAME,
      resumeTag: process.env.RESUME_TAG,
      bootstrapConfirmation: process.env.BOOTSTRAP_CONFIRMATION,
      packageName: process.env.PACKAGE_NAME,
      version: process.env.RELEASE_VERSION,
      tagExists: parseBoolean(process.env.TAG_EXISTS, "TAG_EXISTS"),
      npmVersions: JSON.parse(process.env.NPM_VERSIONS_JSON ?? "[]"),
    });
    process.stdout.write(`${formatGithubOutput(state)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
