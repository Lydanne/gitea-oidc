# 发布流程与 CI/CD 指南

本指南面向仓库维护者，说明两阶段发布流程、首次迁移配置、标签策略和失败恢复方式。

发布不再由本地命令直接推送 tag 或上传 npm 包。维护者先通过 `Prepare Release` 工作流创建版本 PR，
PR 合并到 `main` 后，再由 `Release` 工作流发布 npm、GHCR、可选的 Docker Hub 镜像和 GitHub
Release。

## 流程概览

发布分为两个相互隔离的阶段：

1. `Prepare Release` 只计算版本、更新版本文件和 `CHANGELOG.md`，然后创建发布 PR；同版本分支已存在时
   复用分支、补建缺失 PR 并重新触发 CI。
2. 发布 PR 通过 CI 并合并到 `main` 后，`Release` 校验该提交，创建 Git tag，发布 npm 和 Docker，
   最后创建 GitHub Release。

准备阶段不持有 npm 或 Docker 发布凭据，也不会创建 tag 或外部发布物。发布阶段只消费已经合并的版本，
不会再次递增版本或修改源码。这样可以在真正发布前通过 PR 审查版本号和变更日志。

相关工作流：

- `.github/workflows/ci-check.yml`：普通 PR、发布 PR 和 `main` 的质量检查。
- `.github/workflows/prepare-release.yml`：手动创建发布 PR，并幂等复用已存在的同版本分支。
- `.github/workflows/release.yml`：发布 `main` 上已经合并的版本，并支持按 tag 恢复失败发布。

## 首次配置

### GitHub Environment

在仓库的 **Settings → Environments** 中创建名为 `release` 的 Environment。名称必须与工作流中的
`environment: release` 完全一致。

建议为该 Environment 配置：

- 只允许 `main` 和受保护的 release tag 部署。
- 至少一名 Required reviewer。
- 禁止发起人自行审批，并禁止绕过保护规则。
- 将 Docker Hub Token 保存为 Environment secret，而不是写入仓库或工作流。

发布工作流使用串行 concurrency，不取消正在进行的发布。维护者应等待当前发布结束后再启动下一次发布，
避免 GitHub 对尚未开始的重复等待任务进行替换。

在仓库 **Settings → Actions → General → Workflow permissions** 中允许 GitHub Actions 创建 Pull Request。
准备工作流使用仓库自带的 `GITHUB_TOKEN` 推送 `release/v<version>` 分支、创建 PR，并显式触发该分支的
`CI-CHECK`，不需要额外配置 PAT。

### npm Trusted Publisher

npm 使用 GitHub Actions OIDC Trusted Publishing，不使用长期 `NPM_TOKEN`。

在 npm 的 `@x-oidc/server-core` 包设置中新增 GitHub Actions Trusted Publisher，并填写：

| 配置项 | 值 |
| --- | --- |
| GitHub owner | `Lydanne` |
| Repository | `gitea-oidc` |
| Workflow filename | `release.yml` |
| Environment | `release` |
| Allowed actions | `npm publish` |

注意：

- `release.yml` 只填写文件名，不填写 `.github/workflows/` 前缀。
- owner、仓库名、工作流文件名和 Environment 名称必须与 GitHub 完全一致。
- npm 发布 job 需要 `id-token: write`，工作流会使用满足 Trusted Publishing 要求的 Node.js 和 npm CLI。
- `packages/server-core/package.json` 中的 `repository` 必须准确指向本 GitHub 仓库。
- 工作流不应配置 `NODE_AUTH_TOKEN`、`NPM_TOKEN` 或执行 `npm config set ..._authToken`。

首次 OIDC 发布成功并确认 npm provenance 后，删除 GitHub 中遗留的 `NPM_TOKEN`，并在 npm 撤销旧的
Automation/Granular Access Token，避免长期凭据继续有效。

### Docker 镜像仓库

GHCR 镜像 `ghcr.io/lydanne/x-oidc` 始终发布，使用当前仓库的 `GITHUB_TOKEN` 鉴权，不需要额外
Secret。Docker Hub 是可选镜像源；未配置用户名时，工作流只发布 GHCR。

在 Docker Hub 为发布账号创建具有目标仓库读写权限的 Access Token。不要使用账号密码。

在 GitHub `release` Environment 中配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Variable | `DOCKERHUB_USERNAME` | Docker Hub 用户名和镜像命名空间；留空即关闭镜像同步 |
| Secret | `DOCKERHUB_TOKEN` | 仅用于发布的 Docker Hub Access Token |

目标镜像为 `${DOCKERHUB_USERNAME}/x-oidc`。Token 应使用最小权限并定期轮换，日志和 Issue 中不得输出
Token 值。

## 创建 Prepare Release PR

### 操作步骤

1. 确认计划发布的功能和修复已经合并到 `main`，且 `CI-CHECK` 通过。
2. 进入 GitHub 仓库的 **Actions → Prepare Release → Run workflow**。
3. 运行工作流并选择 `bump`；工作流始终从远端 `main` 规划，需要切换预发布通道时再填写 `preid`。
4. 审查工作流创建的发布 PR；若同版本分支已存在，工作流会补建缺失 PR 并重新触发 CI，但不会覆盖分支。
5. 等待发布 PR 的必需检查通过，再将其合并到 `main`。

发布 PR 应只包含本次发布需要的版本和变更日志调整。重点确认：

- 全部 workspace `package.json` 与 `packages/server-core/package.json` 版本一致。
- `CHANGELOG.md` 内容和目标版本正确。
- PR 的 base branch 是 `main`，没有混入功能代码或生成的私密文件。

合并发布 PR 即表示批准对外发布。不要在合并前手工创建 tag、执行 `npm publish` 或推送 Docker tag。

### 自动 bump 规则

稳定版本上的 `auto` 会读取与当前版本相同的可达 tag 到 `main` 之间的 Conventional Commits，并选择
最高级别：

| Commit | bump |
| --- | --- |
| 标题含 `!`，或正文含 `BREAKING CHANGE:` / `BREAKING-CHANGE:` | `major` |
| `feat` | `minor` |
| `fix`、`perf`、`revert` | `patch` |
| `docs`、`test`、`refactor`、`style`、`build`、`ci`、`chore` 等 | 不发布 |

例如，同时存在 `fix` 和 `feat` 时选择 `minor`；任一提交声明 breaking change 时选择 `major`。如果
`auto` 没有找到需要发布的提交，工作流正常结束且不创建发布 PR。

维护者可以显式选择 `patch`、`minor` 或 `major` 覆盖自动结果，但必须在 PR 中说明原因。预发布还支持：

- 稳定版 `2.3.0` 选择 `prerelease`：生成 `2.3.1-rc.0`；可用 `preid` 改为 `alpha` 或 `beta`。
- `2.3.1-rc.0` 再选 `prerelease`：生成 `2.3.1-rc.1`。
- `2.3.1-rc.1` 选择 `prerelease` 且把 `preid` 改为 `beta`：生成 `2.3.1-beta.0`。
- 当前版本为预发布时，`auto` 发现新的 `feat`、`fix`、`perf` 或 breaking change，只推进当前预发布序号；
  没有触发发布的提交则不创建 PR。
- 当前版本为预发布时选择 `stable`：移除预发布后缀，将同一目标版本转为稳定版，例如
  `2.3.1-rc.1` → `2.3.1`。

`preid` 只与 `prerelease` 一起使用；未填写时沿用当前预发布通道，首次预发布则默认为 `rc`。它必须以
字母开头，不能是 `latest` 或可被当作版本号的值，避免覆盖稳定 npm/Docker 渠道。

版本规划要求当前包版本存在完全一致且可达的 Git tag。新版本合并后必须先完成或恢复该版本发布，才能准备
下一版本；缺少精确 tag 时会停止，而不是跳过未完成版本、猜测基线或覆盖已有发布。

## 合并后的发布流程

发布 PR 合并到 `main` 后，`Release` 工作流按以下顺序执行：

1. 检测 `main` 上待发布的版本和提交 SHA，并拒绝非 `main` 或版本不一致的输入。
2. 运行敏感文件检查、版本同步检查、发布脚本测试、依赖审计、lint、typecheck、单元测试、生产构建和
   tarball 验证。
3. 在当前 `main` 提交上创建不可变的 `v<version>` Git tag。
4. 从同一提交构建一次 npm tarball，并记录 SHA-256 校验值。
5. 通过 npm Trusted Publisher 的 OIDC 身份发布该 tarball。
6. 构建并推送多架构 GHCR 镜像以及可选的 Docker Hub 镜像，写入 source、revision、version 和
   created OCI labels。
7. 确认 npm 与 Docker 发布物后，最后创建 GitHub Release。

GitHub Release 放在最后创建，避免“Release 已显示成功，但 npm 或 Docker 尚未发布”的假完成状态。
发布工作流不会修改版本文件，也不会推送新的发布提交。

## 稳定版和预发布标签

所有精确版本 tag 都视为不可变。若远端已经存在相同名称但指向不同提交或不同产物，工作流必须失败，
不得强制覆盖。

| 渠道 | Git tag | npm dist-tag | Docker tag | GitHub Release |
| --- | --- | --- | --- | --- |
| 稳定版 `2.3.0` | `v2.3.0` | `latest` | `2.3.0`、`2.3`、`2`、`latest` | 正式版，可标记 latest |
| 预发布 `2.3.1-rc.0` | `v2.3.1-rc.0` | `rc` | `2.3.1-rc.0`、`rc` | Prerelease，不标记 latest |
| 预发布 `2.3.1-beta.0` | `v2.3.1-beta.0` | `beta` | `2.3.1-beta.0`、`beta` | Prerelease，不标记 latest |

预发布不得更新 npm `latest`，也不得更新 Docker `latest`、major 或 minor 浮动 tag。稳定版发布成功后才更新
这些稳定渠道 tag。Docker 浮动 tag 必须指向本次已验证的精确版本镜像 digest。

恢复低于当前渠道版本的历史 tag 时，只补精确 Git/Docker tag 和 GitHub Release，不回滚任何 Docker 或
GitHub `latest`。如果该 npm 版本此前尚未发布，工作流使用唯一的 `recovered-<version>` dist-tag，避免移动
现有 `latest`、`rc` 或 `beta`。

## 失败恢复

优先在原 GitHub Actions 运行中使用 **Re-run failed jobs**。原运行保留相同的提交 SHA 和发布上下文，
是风险最低的恢复方式。

如果原运行无法继续，必须从同一个 tag ref 手动运行 `Release`，并把 `resume_tag` 设置为该完整 tag。
Checkout 输入不足以改变 npm provenance 使用的 GitHub 事件 SHA，因此“运行工作流的 ref”和
`resume_tag` 必须同时指向同一 tag：

```bash
gh workflow run release.yml --ref v2.3.0 --field resume_tag=v2.3.0
```

也可以在 Actions 页面先把 **Use workflow from** 选为 `v2.3.0`，再填写相同的 `resume_tag`。恢复流程
会校验事件 SHA、tag、包版本和源码提交完全一致，不接受独立版本号或任意分支作为发布来源。
手动工作流只负责协调已经存在的 tag，不能留空输入从当前 `main` 发布，也不能用同名 branch 代替 tag。
如果失败发生在 tag 创建前，只能重跑原自动发布运行，避免把版本审批后的新提交带入旧版本。

| 失败位置 | 恢复方式 |
| --- | --- |
| Prepare Release PR 创建前 | 修复原因后重新运行准备工作流；此时没有外部发布物 |
| 发布 PR 未合并 | 修正或关闭发布 PR；不要运行 Release |
| 合并后、Git tag 创建前 | 重跑失败 job；工作流仍使用该发布提交 |
| Git tag 已创建、npm 尚未发布 | 重跑或以 `resume_tag` 恢复；校验 tag 指向后继续发布 npm |
| npm 已发布、Docker 失败 | 以相同 tag 恢复；确认 npm 版本和 tarball 后跳过 npm，继续 Docker |
| Docker 精确 tag 已存在 | 分别校验各镜像仓库的 OCI revision；一致时复用，不一致时停止 |
| npm 和 Docker 成功、GitHub Release 失败 | 以相同 tag 恢复，只补建 GitHub Release |

恢复时必须遵循以下规则：

- 不强制移动 Git tag。
- 不删除或覆盖已经发布的 npm 版本；npm 版本本身不可变。
- 不覆盖指向不同 revision/digest 的 Docker 精确版本 tag。
- 不基于失败后的新 `main` HEAD 重算旧发布版本。
- 发现远端状态冲突时立即停止，由维护者核对；需要修正内容时发布新的 patch 版本。

## 首次发布

X OIDC 所有 workspace 包从 `2.0.0` 开始并保持同步版本。首次发布按以下顺序操作：

1. 在合并前运行 `pnpm release:version-check`，确认全部 workspace 包版本均为 `2.0.0`。
2. 创建并保护 GitHub `release` Environment。
3. 在 npm 配置 Trusted Publisher，精确填写 `release.yml` 和 `release`。
4. 如需同步 Docker Hub，在 `release` Environment 配置 Variable `DOCKERHUB_USERNAME` 和 Secret
   `DOCKERHUB_TOKEN`；否则只使用默认 GHCR。
5. 合并包含工作流、发布脚本、包元数据和 `2.0.0` 版本的首次发布 PR；该次 `main` 推送会直接触发
   `Release`，不要为 `2.0.0` 额外运行 `Prepare Release`。
6. 观察首次 OIDC 发布；核对 npm provenance、Docker tags 和 GitHub Release。
7. 首次成功后撤销遗留的 npm Token，并删除旧的 `DOCKER_USERNAME`、`DOCKER_PASSWORD` 等无效 secrets。

迁移前可执行：

```bash
git fetch --tags origin
git checkout main
git pull --ff-only
node -p "require('./packages/server-core/package.json').version"
pnpm release:version-check
```

首次 `2.0.0` 由当前代码直接发布；后续版本统一通过 `Prepare Release` 生成版本 PR。

## 本地验证

本地使用 Node.js 22 和 pnpm 10。只读规划和完整发布校验命令如下：

```bash
pnpm install --frozen-lockfile
pnpm release:version-check
pnpm test:release
pnpm release:plan --bump auto --format json
pnpm release:plan --bump prerelease --preid rc --format json
pnpm release:secrets
pnpm release:verify
pnpm release:pack
```

命令说明：

- `pnpm release:plan` 只输出计划，不修改文件；参数直接跟在脚本名后，不要额外插入 `--`。
- `pnpm release:verify` 会执行发布前完整质量门禁，耗时明显长于普通 lint。
- `pnpm release:pack` 将唯一 npm tarball 和 `SHA256SUMS` 写入 `artifacts/npm/`，不会发布到 npm。
- `pnpm release:prepare` 只修改版本和变更日志，不自行提交；准备工作流会在校验变更范围后创建提交。
  该命令不属于只读验证命令。

本地不得使用 `npm publish`、`docker push` 或手工 `git tag` 代替 GitHub Actions 发布。

## CI-CHECK

`.github/workflows/ci-check.yml` 在普通 PR、发布 PR 和 `main` 推送上执行代码质量、测试、构建、npm pack
与 Docker 构建检查。发布 PR 必须通过与普通功能 PR 相同的分支保护和必需检查。

Release 工作流仍会在创建 tag 前重复发布级验证。CI-CHECK 通过不代表可以跳过发布工作流中的版本、敏感文件、
tarball 和远端状态校验。

## 常见问题

### `auto` 没有创建发布 PR

如果最近 tag 后只有 `docs`、`test`、`chore` 等不触发发布的提交，这是预期行为。需要有 `feat`、`fix`、
`perf` 或 breaking change，或由维护者显式选择 bump。

### npm OIDC 鉴权失败

依次核对 npm Trusted Publisher 的 owner、仓库、`release.yml` 和 `release` Environment 是否完全匹配，
以及发布 job 是否具有 `id-token: write`。不要临时恢复长期 `NPM_TOKEN` 绕过配置错误。

### Docker Hub 登录或推送失败

确认 `DOCKERHUB_USERNAME` 是镜像命名空间，`DOCKERHUB_TOKEN` 是仍有效且具有目标仓库写权限的
Access Token。不要改用账号密码。

如果不需要 Docker Hub 镜像，删除或留空 `DOCKERHUB_USERNAME` Variable。GHCR 发布不受影响。

### 预发布后 `latest` 没有变化

这是预期行为。npm `latest` 和 Docker `latest` 只由稳定版更新；使用对应的 `rc`、`beta` 或精确版本
tag 验证预发布。

## 参考资料

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)
- [GitHub Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Docker Hub Access Tokens](https://docs.docker.com/security/for-developers/access-tokens/)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
