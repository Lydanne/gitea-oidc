# syntax=docker/dockerfile:1.7

FROM node:22.22.0-bookworm AS pnpm-base

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable \
    && corepack prepare pnpm@10.0.0 --activate \
    && test "$(pnpm --version)" = "10.0.0"

FROM pnpm-base AS build

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm run build:prod

# pnpm 10 的新 deploy 模式要求 workspace 启用 inject-workspace-packages。
# 这里保留仓库现有链接策略，在隔离目录中按锁文件安装最小生产依赖。
FROM build AS production-dependencies

RUN mkdir -p /runtime/apps/idp-server /runtime/packages/server-core \
    && cp /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml /runtime/ \
    && cp /workspace/apps/idp-server/package.json /runtime/apps/idp-server/package.json \
    && cp /workspace/packages/server-core/package.json /runtime/packages/server-core/package.json

RUN pnpm --dir /runtime --filter @x-oidc/idp-server... install \
      --prod \
      --offline \
      --frozen-lockfile \
      --ignore-scripts \
      --store-dir=/pnpm/store \
    && pnpm --dir /runtime --filter @x-oidc/idp-server... rebuild bcrypt better-sqlite3 \
    && ! find /runtime/node_modules/.pnpm -maxdepth 1 -type d \( \
      -name 'vitest@*' -o -name 'rolldown@*' -o -name 'tsx@*' -o \
      -name 'husky@*' -o -name 'release-it@*' -o -name '@biomejs+biome@*' \
    \) -print -quit | grep -q .

FROM node:22.22.0-bookworm-slim AS runtime

ARG VERSION=dev
ARG REVISION=unknown
ARG SOURCE=https://github.com/Lydanne/gitea-oidc

LABEL org.opencontainers.image.title="X OIDC" \
      org.opencontainers.image.description="X OIDC identity provider" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOME=/tmp

WORKDIR /app

RUN groupadd --gid 10001 x-oidc \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin x-oidc \
    && chown x-oidc:x-oidc /app

COPY --from=production-dependencies --chown=x-oidc:x-oidc \
    /runtime/node_modules ./node_modules
COPY --from=production-dependencies --chown=x-oidc:x-oidc \
    /runtime/apps/idp-server/node_modules ./apps/idp-server/node_modules
COPY --from=production-dependencies --chown=x-oidc:x-oidc \
    /runtime/packages/server-core/node_modules ./packages/server-core/node_modules
COPY --from=production-dependencies --chown=x-oidc:x-oidc \
    /runtime/apps/idp-server/package.json ./apps/idp-server/package.json
COPY --from=production-dependencies --chown=x-oidc:x-oidc \
    /runtime/packages/server-core/package.json ./packages/server-core/package.json
COPY --from=build --chown=x-oidc:x-oidc \
    /workspace/apps/idp-server/dist ./apps/idp-server/dist
COPY --from=build --chown=x-oidc:x-oidc \
    /workspace/packages/server-core/dist ./packages/server-core/dist
COPY --from=build --chown=x-oidc:x-oidc \
    /workspace/packages/server-core/public ./packages/server-core/public

USER 10001:10001

EXPOSE 3000
STOPSIGNAL SIGTERM

CMD ["node", "apps/idp-server/dist/main.js"]
