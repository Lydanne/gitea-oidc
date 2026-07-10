FROM node:22

# 构建阶段需要安装 devDependencies
ENV CI=true

WORKDIR /app

COPY . .

# 启用 corepack 并准备 pnpm
RUN corepack enable && \
    corepack prepare pnpm@latest-10 --activate

# 安装所有依赖用于构建
RUN pnpm install --frozen-lockfile

# 构建应用
RUN pnpm run build:prod

# 重新编译原生依赖
RUN npm rebuild better-sqlite3

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server.js"]
