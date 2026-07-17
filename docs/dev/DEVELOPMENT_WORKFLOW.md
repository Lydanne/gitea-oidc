# 开发、验证与自动提交规范

本文面向维护者和自动化 Agent，规定写入型任务从实现到本地提交的强制交付边界。

## 默认自动提交

任何经用户授权并实际修改仓库文件的任务，在实现完成并通过适当验证后，必须自动创建本地提交，不再等待
第二次“请提交”指令。以下情况不创建提交：

- 用户明确要求不暂存或不提交。
- 请求只包含审查、诊断、解释或方案，没有修改文件。
- 实现仍未完成、验证发现已知错误，或相关脏文件无法安全隔离。

自动提交只表示形成可审查、可回滚的本地 Git commit，不包含 push、创建 tag、发布或创建 PR。

## 安全暂存

提交前依次执行：

```bash
git status --short
git diff
git diff --cached
```

只使用显式文件路径或交互式 hunk 暂存本任务改动，禁止使用 `git add .` 和 `git add -A`。不得把用户已有的
无关 staged、unstaged 或 untracked 文件带入提交。同一文件混有无关改动时应拆分 hunk；无法安全拆分时
停止提交并说明原因。

暂存后必须检查完整 staged diff，并执行：

```bash
git diff --cached --check
```

发布、配置或部署相关变更还要执行 `pnpm release:secrets`，避免密钥、token、私钥和本地配置进入历史。

## 提交信息

提交信息使用以下格式：

```text
type(scope): 中文祈使主题
```

- `type` 只能使用 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、
  `chore`、`revert`。
- scope 必填。单包变更使用最近 `package.json` 所在目录名；根级或不可拆分的跨包变更使用 `x-oidc`。
- 完整标题不超过 50 字，主题必须包含中文，结尾不使用标点。
- 破坏公开合同的提交使用 `type(scope)!:`，并添加 `BREAKING CHANGE:` footer。
- 正文只补充标题无法承载的关键信息，每行不超过 72 字。

可独立审查和回滚的多包变更应拆分提交；必须同时落地才能保持构建或运行正确的跨包变更使用一个
`x-oidc` scope 原子提交。

## 自动校验

- `.husky/pre-commit` 运行 lint-staged。
- `.husky/commit-msg` 运行 commitlint，禁止使用 `--no-verify` 绕过。
- `CI-CHECK` 校验 PR 的全部新提交和 PR 标题；普通 GitHub merge commit 使用 commitlint 的默认忽略规则。
- 当前规范通过 `.commit-policy-version` 建立一次性启用基线，不追溯本规范落地前的旧提交。合并后，新 PR
  会从 merge base 开始检查全部提交。

仓库设置中应把 `CI-CHECK` 的 lint job 设为 required check，并只允许 squash 或 rebase merge。Squash
时最终提交信息来自 PR 标题，因此 PR 标题也必须遵守同一格式。

本地检查某个范围：

```bash
pnpm lint:commits --from <base-sha> --to <head-sha>
```

## 提交后核对

提交完成后运行 `git status --short`，确认本任务没有遗漏，并记录 commit hash。剩余未提交文件必须明确
属于用户已有改动或另一个尚未完成的任务。
