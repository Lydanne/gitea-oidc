# Gitea OIDC Agent 指南

## 交流与范围

- 与用户沟通默认使用中文。
- 本仓库是单 package TypeScript 项目，最近的 `package.json` 位于仓库根目录。
  提交信息 scope 使用 `gitea-oidc`；如果未来出现嵌套 package，
  则以当前修改文件向上查找最近 `package.json` 的目录名作为 scope。
- 变更前先用 `rg` / `rg --files` 熟悉现有实现，优先沿用仓库已有模式。
- 不要回退用户已有改动；遇到无关脏文件时忽略，遇到相关改动时在其基础上继续。

## 项目概览

- 运行时：Node.js `>=22`，包管理器：`pnpm@10`。
- 入口：`src/server.ts`，负责 Fastify、`oidc-provider`、认证协调器、适配器和 JWKS 初始化。
- 配置：`src/config.ts` 加载并合并配置，`src/schemas/configSchema.ts` 用 Zod 校验。
- 认证核心：`src/core/`，尤其是 `AuthCoordinator` 和 `PermissionChecker`。
- 认证提供者：`src/providers/`，目前有本地密码和飞书 OAuth。
- 用户仓储：`src/repositories/`，支持 memory、SQLite、PostgreSQL。
- OIDC 持久化：`src/adapters/`，支持 SQLite、Redis、memory。
- State 存储：`src/stores/MemoryStateStore.ts`。
- 文档：`docs/` 和根目录 `README*.md`。

## 常用命令

- 安装依赖：`pnpm install`
- 开发启动：`pnpm dev`
- 构建：`pnpm build`
- 生产构建：`pnpm build:prod`
- 单元测试：`pnpm test`
- 覆盖率：`pnpm test:coverage`
- 代码检查：`pnpm lint`
- 自动修复：`pnpm lint:fix`
- Markdown 检查：`pnpm lint:md`
- 生成 JWKS：`pnpm generate-jwks`
- Docker 集成测试：`./docker-test.sh test`

## 本地 Skills

- 默认开发入口：`$gitea-oidc-engineering-quality`，用于新增功能、修 bug、重构维护、
  补测试和质量审查。
- 认证专项：`$gitea-oidc-auth-provider`，用于认证插件、OAuth 回调、权限和用户映射。
- 存储专项：`$gitea-oidc-oidc-storage`，用于 OIDC SQLite/Redis 适配器和 TTL 语义。
- 配置专项：`$gitea-oidc-config-safety`，用于配置加载、Zod schema、JWKS、代理和生产安全。
- 发布专项：`$gitea-oidc-release-quality`，用于构建、Docker、CI 和发布前验证。

## 代码风格

- TypeScript 使用 ESM、双引号、分号、2 空格缩进，遵循 `biome.json`。
- 保持现有中文注释风格；只在复杂流程前添加有帮助的短注释。
- 类型定义优先放在 `src/types/` 或靠近具体模块；公共配置变更要同步接口、Zod schema、示例配置和文档。
- 不引入新的运行时依赖，除非能明显降低复杂度并符合项目方向。
- 安全相关逻辑不要吞错；日志中避免输出密码、token、client secret、cookie key、私钥等敏感值。

## 测试策略

- 源文件旁已有 `__tests__` 时，新增或修改行为要补对应 Vitest 用例。
- 配置 schema、认证提供者、仓储、OIDC 适配器、state 和错误处理属于高风险区域。
  优先跑相关测试，再视影响范围跑 `pnpm test`。
- 修改构建、导出、依赖或运行入口后跑 `pnpm build`。
- 修改 Markdown 文档后跑 `pnpm lint:md`；修改代码后至少跑 `pnpm lint` 或更聚焦的检查。

## 认证与 OIDC 约定

- 新增认证方式应实现 `AuthProvider`，并通过 `AuthCoordinator.registerProvider` 注册。
- 插件路由统一挂在 `/auth/{providerName}` 下；OAuth 回调必须校验 state，并清理一次性状态。
- 插件能力需要声明权限元数据，由 `PermissionChecker` 约束路由、静态资源、Webhook 和中间件注册。
- OIDC 用户声明来自 `findAccount` 返回的 `UserInfo`，保持 `sub` 稳定，避免随邮箱、昵称等可变字段变化。
- 新增 OIDC 存储适配器时，实现 `oidc-provider` 的 Adapter 契约，并在工厂、
  schema、配置类型、示例配置和测试中同步。

## 配置与生产安全

- 配置文件支持 `gitea-oidc.config.js` 和 `gitea-oidc.config.json`，其中 JS 优先。
- 生产配置必须使用强 `cookieKeys`、持久化 JWKS、非 memory 的用户仓储和 OIDC 适配器。
- 反向代理后部署时要同步 `server.url`、`oidc.issuer`、客户端回调 URL，并按需开启 `trustProxy`。
- 不要把真实密钥、密码文件、JWKS 私钥、数据库连接串提交到仓库。

## 提交信息

- 使用 Conventional Commits：`type(scope): 中文主题描述`。
- 允许的 type：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`chore`、`build`、`ci`、`revert`。
- 主题用中文祈使语气，50 字以内，不加句号。
- 本仓库根级文件的 scope 使用 `gitea-oidc`，例如：`docs(gitea-oidc): 新增项目代理指南`。
