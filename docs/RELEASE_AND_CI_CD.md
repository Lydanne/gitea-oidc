# 发布流程与 CI/CD 指南

本指南说明本项目的发布流程（基于 `release-it`）以及 GitHub Actions 提供的 CI/CD 工作流。

## 一、发布流程（release-it）

项目使用 [release-it](https://github.com/release-it/release-it) 自动化发布，支持 **npm 包发布** 和 **Docker 镜像发布**。

### 1. 环境变量配置

发布前需要在本地环境或 CI 环境中配置以下变量：

- `NPM_TOKEN`: npm 发布令牌
- `GHUB_TOKEN`: GitHub 令牌（用于创建 release）
- `DOCKER_USERNAME`: Docker Hub 用户名
- `DOCKER_PASSWORD`: Docker Hub 密码

> 在 GitHub Actions 中，这些应配置为仓库的 Secrets，见下文「CI/CD → 所需环境变量」。

### 2. 发布命令

在本地或 CI 中，可以通过以下命令驱动 `release-it`：

```bash
# 发布补丁版本（patch）
pnpm run release

# 指定版本类型
pnpm run release -- patch
pnpm run release -- minor
pnpm run release -- major

# 预发布版本（如 beta）
pnpm run release -- prerelease --preReleaseId=beta
```

发布流程包含以下步骤：

1. 构建生产版本（`pnpm run build:prod`）
2. 递增 `package.json` 中的版本号
3. 提交 Git 变更并打标签
4. 推送代码与标签到 GitHub
5. 创建 GitHub Release
6. 发布到 npm
7. 触发 Docker 镜像构建与推送（由 GitHub Actions 完成）

---

## 二、CI/CD（GitHub Actions）

本项目使用 GitHub Actions 提供完整的 CI 与发布自动化流程，相关配置位于：

- `.github/workflows/ci-check.yml`
- `.github/workflows/release.yml`

### 1. CI-CHECK 工作流

文件：`.github/workflows/ci-check.yml`

触发条件：

- `pull_request` 到 `main` / `master`

主要 Job：

- `lint`
  - 检出代码
  - 使用 Node.js 22 和 pnpm 安装依赖
  - 对 `README.md` 运行 `markdownlint`
- `test`
  - 在 Node.js 22 下安装依赖
  - 运行 `pnpm test` 与 `pnpm test:coverage`
- `build`
  - 安装依赖
  - 运行 `pnpm run build:prod`
  - 构建测试用 Docker 镜像 `gitea-oidc:test`

### 2. Release 工作流

文件：`.github/workflows/release.yml`

触发条件：

- 推送到 `main` / `master`
- 手动触发 `workflow_dispatch`，并选择 `release_type`：
  - `patch` / `minor` / `major` / `prerelease`

工作流主要包含四个 Job：

1. `test`
   - 在 Node.js 22 下安装依赖
   - 重建 `better-sqlite3` 等原生模块
   - 运行单元测试
2. `build`（依赖 `test`）
   - 安装依赖并重建原生模块
   - 运行 `pnpm run build:prod`
   - 上传构建产物 `dist/` 作为 artifact
3. `release`（依赖 `build`）
   - 使用 `release-it` 完成版本号递增、Git 标签、GitHub Release 和 npm 发布
   - 输出新版本号（从 `package.json` 读取）
4. `docker`（依赖 `release`）
   - 使用 `docker/build-push-action` 构建并推送多平台镜像
   - Tag 格式：
     - `${DOCKER_USERNAME}/gitea-oidc:<version>`
     - `${DOCKER_USERNAME}/gitea-oidc:latest`

### 3. 所需 Secrets / 环境变量

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置：

- `NPM_TOKEN`: npm 发布令牌
- `GHUB_TOKEN`: GitHub 令牌（release-it 可以使用，也可直接复用 `GITHUB_TOKEN`）
- `DOCKER_USERNAME`: Docker Hub 用户名
- `DOCKER_PASSWORD`: Docker Hub 密码

> 工作流文件中还会自动使用 `GITHUB_TOKEN`（由 GitHub 提供）用于访问仓库与创建 Release。

### 4. 手动发布（通过 Actions）

1. 进入 GitHub 仓库的 **Actions** 页面
2. 选择 **"Release"** 工作流
3. 点击 **"Run workflow"** 按钮
4. 选择发布类型（`patch` / `minor` / `major` / `prerelease`）
5. 等待工作流完成

### 5. 自动发布

当推送到 `main` / `master` 且提交信息不包含 `chore: release` 时，`Release` 工作流会自动以 `patch` 的方式触发发布流程。

---

如需修改发布策略（例如禁用自动发布、调整版本策略、变更 Docker 镜像命名），可以直接编辑 `.github/workflows/release.yml` 或 `package.json` 中的 `release-it` 配置。
