#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const imageRef = process.argv[2];

if (!imageRef || imageRef === "--help" || imageRef === "-h") {
  console.log("用法: node scripts/check-docker-image.mjs <image-ref>");
  process.exit(imageRef ? 0 : 1);
}

const failures = [];

function runDocker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `退出码 ${result.status}`;
    throw new Error(detail);
  }

  return result.stdout.trim();
}

function check(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    return;
  }

  console.error(`❌ ${message}`);
  failures.push(message);
}

let config;
try {
  config = JSON.parse(runDocker(["image", "inspect", imageRef, "--format", "{{json .Config}}"]));
} catch (error) {
  console.error(`❌ 无法检查镜像 ${imageRef}: ${error.message}`);
  process.exit(1);
}

const configuredUser = config.User?.trim() ?? "";
const userNameOrId = configuredUser.split(":", 1)[0];
check(
  configuredUser.length > 0 && userNameOrId !== "0" && userNameOrId !== "root",
  "镜像默认使用非 root 用户",
);

check(config.WorkingDir === "/app", "镜像工作目录为 /app");
check(
  JSON.stringify(config.Cmd) === JSON.stringify(["node", "apps/idp-server/dist/main.js"]),
  "镜像启动入口指向 idp-server 生产构建",
);
check(
  Array.isArray(config.Env) && config.Env.includes("NODE_ENV=production"),
  "镜像设置 NODE_ENV=production",
);

for (const label of [
  "org.opencontainers.image.version",
  "org.opencontainers.image.revision",
  "org.opencontainers.image.source",
]) {
  check(Boolean(config.Labels?.[label]), `镜像包含 ${label} 标签`);
}

const filesystemCheck = String.raw`
set -eu

for required_path in \
  /app/apps/idp-server/dist/main.js \
  /app/packages/server-core/dist/server.js \
  /app/packages/server-core/public/admin/index.html \
  /app/packages/server-core/public/portal/index.html \
  /app/node_modules
do
  test -e "$required_path"
done

test -w /app

for forbidden_path in \
  /app/.git \
  /app/.npmrc \
  /app/.htpasswd \
  /app/docs \
  /app/gitea-server \
  /app/scripts \
  /app/tests \
  /app/pnpm-lock.yaml \
  /app/pnpm-workspace.yaml \
  /app/apps/idp-server/src \
  /app/packages/server-core/src \
  /pnpm \
  /root/.cache \
  /root/.npm \
  /home/node/.cache \
  /home/node/.npm \
  /app/.pnpm-store \
  /app/node_modules/.cache
do
  test ! -e "$forbidden_path"
done

if find /app -path /app/node_modules -prune -o -type f \( \
  -name '.env' -o -name '.env.*' -o -name '.npmrc' -o \
  -name '.htpasswd' -o -name '*.htpasswd' -o -name '*jwks*.json' -o \
  -name '*.pem' -o -name '*.key' -o -name '*.rsa' -o \
  -name '*.p12' -o -name '*.pfx' -o -name '*.db' -o \
  -name '*.db-*' -o -name '*.sqlite' -o -name '*.sqlite-*' -o \
  -name '*.sqlite3' -o -name '*.sqlite3-*' -o -name '*-journal' \
\) -print -quit | grep -q .
then
  exit 1
fi

if find /app/node_modules/.pnpm -maxdepth 1 -type d \( \
  -name 'vitest@*' -o -name 'rolldown@*' -o -name 'tsx@*' -o \
  -name 'husky@*' -o -name 'release-it@*' -o -name '@biomejs+biome@*' \
\) -print -quit | grep -q .
then
  exit 1
fi

cd /app/apps/idp-server
node --input-type=module --eval 'await import("gitea-oidc/server")'
`;

try {
  runDocker(["run", "--rm", "--entrypoint", "sh", imageRef, "-c", filesystemCheck]);
  check(true, "镜像仅包含生产入口、运行依赖和静态资源");
  check(true, "镜像不包含敏感文件、项目源码或包管理缓存");
} catch (error) {
  console.error(`❌ 镜像文件系统检查失败: ${error.message}`);
  failures.push("镜像文件系统不符合发布边界");
}

if (failures.length > 0) {
  console.error(`\n镜像检查失败，共 ${failures.length} 项。`);
  process.exit(1);
}

console.log(`\n镜像 ${imageRef} 检查通过。`);
