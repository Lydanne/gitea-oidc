# Monorepo 架构与包边界

本文说明当前 pnpm workspace 的职责、依赖方向和构建顺序。应用控制面、版本化模板、Node SDK、
框架连接器和本地 CLI 已按该边界实现为私有预览包；尚未实现的 setup code、多实例仓储和发布编排
仍以 `docs/spec/2026-07-10-monorepo-application-sdk-architecture.md` 为准。

## Workspace 布局

```text
apps/
  admin-web/       Vue 管理台源码和独立 Vite 构建
  idp-server/      生产部署进程入口
packages/
  contracts/               版本化 connection、credential 和管理 API contract
  application-templates/   版本化内置应用模板和不可变快照
  applications/            应用、OIDC Client、Secret、审计和仓储领域包
  oidc-client/             包名 @gitea-oidc/node，框架无关 OIDC relying-party 核心
  oidc-client-sqlite/      单机生产用加密 SQLite stores 和 refresh lock
  connector-core/          框架无关的固定路由、Cookie、错误和认证投影
  express/                 Express 4/5 连接器
  fastify/                 Fastify 5 连接器
  nestjs/                  NestJS 10/11 连接器
  cli/                     connection 校验、doctor 和安全项目初始化
  connector-testkit/       私有连接器一致性测试
  server-core/             npm 包 gitea-oidc、认证服务装配和兼容 SDK
```

根 `package.json` 是私有编排包，不包含运行时依赖，也不会发布。根脚本负责保持固定的工作目录，
因此配置文件、JWKS 和数据库的相对路径仍相对于项目启动目录解析。

## 服务生命周期

`packages/server-core/src/identityServer.ts` 暴露两个层级：

- `createIdentityServer(config?, options?)` 完成 Fastify、OIDC、仓储、Provider 和路由装配，
  但不监听端口、不注册进程信号。
- `start(config?, options?)` 保留现有公开契约，在装配完成后监听配置的地址并返回 Fastify 实例。

`packages/server-core/src/server.ts` 是兼容 facade。直接执行 `gitea-oidc/dist/server.js` 时，
它会注册 `SIGINT` 和 `SIGTERM` 清理；被普通模块导入时不会自动监听。

`apps/idp-server/src/main.ts` 是 Docker 和生产部署入口，只调用统一的进程启动函数。业务应用不应
依赖该 app，而应在需要嵌入服务时调用 `createIdentityServer()`。

当前 `OidcAdapterFactory` 仍是进程内单例，因此同一进程只允许一个尚未关闭的 Identity Server。
第二次创建会在接触共享 Adapter 前明确失败；第一个实例完成 `app.close()` 后才可创建新实例。
未来把 Adapter 工厂实例化后才能解除此限制。

## 静态资源装配

管理台的唯一原始构建产物是 `apps/admin-web/dist/`。服务包构建前，
`packages/server-core/scripts/stage-admin-assets.mjs` 会执行以下操作：

1. 确认管理台已经构建并存在 `index.html`。
2. 清理 `packages/server-core/public/admin/`，避免旧 hash chunk 残留。
3. 复制完整产物并验证 HTML 引用的本地资源都存在且没有越界路径。

服务核心使用基于 `import.meta.url` 的包内 `public` 默认路径，不依赖 `process.cwd()`。
调用方也可以通过 `IdentityServerOptions.publicDir` 显式覆盖资源目录。相对路径会基于启动时的
工作目录解析为绝对路径。后台 SPA 路由复用同一个 `publicDir`，不会再单独读取调用方工作目录。
管理台构建使用相对资源 URL；服务端会注入规范化后的 `admin.basePath`，并把该前缀下的
`assets/*` 安全映射到包内管理台产物，因此自定义后台路径不依赖额外暴露 `/admin/assets`。

## 依赖方向

依赖只能按以下方向流动：

```text
contracts --> application-templates --> applications --> server-core --> idp-server
contracts --> node --> node-sqlite
contracts --> node --> connector-core --> express / fastify / nestjs
contracts --> cli
connector-core + node --> connector-testkit --> express / fastify conformance tests
contracts --> admin-web --构建产物--> server-core
```

- `contracts` 只包含版本常量、TypeScript 类型、Zod schema 和解析函数，不依赖服务端实现。
- `application-templates` 只依赖 `contracts`，不访问数据库、Fastify 或管理台。
- `applications` 依赖 `contracts` 和模板目录，但不依赖 Fastify、OIDC Provider 或管理台。
- `node` 依赖公开 contract 和标准 OIDC client，不依赖服务端、数据库或 Web 框架。
- `node-sqlite` 只依赖 `node` 和 SQLite，提供加密持久化与同机跨进程 refresh lock。
- `node`、`node-sqlite`、连接器和 CLI 的最低 Node.js 版本已确定为 `>=20.19.0`；服务端继续要求
  Node.js `>=22.0.0`。
- `connector-core` 依赖 `node`，只描述 HTTP、Cookie 和认证投影；框架包只做边界适配。
- `cli` 只依赖公开 contract，不拥有管理 API 权限，也不直接修改认证服务配置或数据库。
- `admin-web` 只导入 `contracts`，不导入服务端源码；运行时只通过 HTTP API 通信。
- `idp-server` 依赖公开包 `gitea-oidc`，不跨目录导入其源码。
- `server-core` 通过私有 facade 装配 `applications`，公开声明不能泄漏私有 workspace 类型；
  它不依赖 `apps/*` 的运行时代码，装配脚本只在仓库构建阶段读取管理台产物。
- 旧 `gitea-oidc/client`、`express`、`nest` 和 `vue` 子路径暂时留在兼容包；新项目应以独立包为
  目标，兼容子路径要等独立包完成正式发布和迁移期后再移除。

## 构建与验证

根构建顺序固定为：

1. 清理所有 workspace 输出。
2. 构建 `contracts`、`application-templates`、`applications`、`node` 和 `node-sqlite`。
3. 构建 `connector-core`，再构建 Express、Fastify 和 NestJS 连接器。
4. 构建 CLI 和依赖 `contracts` 的 `admin-web`。
5. 装配管理台静态资源并构建依赖 `applications` 的 `server-core`。
6. 基于已生成的公开声明构建 `idp-server`。

根 `build:libs` 构建模板、应用域、Node SDK 和连接器核心，`build:connectors` 构建三个框架包，
`build:tooling` 构建 CLI。需要单独验证包时可运行：

```bash
pnpm build:contracts
pnpm build:templates
pnpm build:applications
pnpm build:node
pnpm build:node-sqlite
pnpm build:connectors
pnpm build:cli
pnpm build:admin
```

常用门禁：

```bash
pnpm audit:all
pnpm audit:prod
pnpm typecheck
pnpm lint
pnpm test
pnpm build:prod
pnpm test:pack
```

`audit:all` 是 CI 使用的完整依赖安全门禁，`audit:prod` 可单独核对运行时依赖。根
`pnpm.overrides` 只用于固定上游尚未放宽范围的兼容安全修复，升级或移除 override 前必须重跑
完整测试、生产构建和 tarball 消费测试。

发布候选包必须额外执行实际 tarball 的离线 import 和类型消费测试。tarball 必须包含声明文件、
运行时代码、README 和许可证；服务包还必须包含完整静态页面和所有 exports。任何 tarball 都不
得包含源码测试、数据库、Agent 文件或 workspace 配置。当前独立 SDK、连接器和 CLI 仍保持
`private: true`，通过这些门禁后再进入统一版本与发布编排。

根 workspace 的开发与发布工具固定使用 Node.js 22.13.x，因此 CI 先在 Node.js 22.13 下冻结安装并
构建包，再切换到
Node.js 20.19 重建 `better-sqlite3`，直接运行 tarball 消费脚本。Node.js 20 阶段不能从根调用
pnpm 脚本，否则 `engine-strict` 会在真正的最低版本消费测试前终止任务。

## 发布兼容

公开包名和版本仍由 `packages/server-core/package.json` 管理，现有六个 exports 保持不变。
根 `release` 脚本会把执行目录切换到该 package，避免私有根包被错误递增或发布。

Release 工作流只允许手动触发，不再在每次主分支推送时自动发布 patch。Docker 从
`apps/idp-server/dist/main.js` 启动，同时继续通过 workspace 中的 `gitea-oidc` 包加载服务核心。

## P2 应用控制面边界

`applications.enabled` 和 `applications.clientSource` 采用成对配置：兼容模式是
`false/config`，数据库模式是 `true/database`。数据库模式会把静态 `clients[]` 幂等导入应用库，
随后 Provider 只通过 Client Adapter 查询数据库，不做 hybrid 查询或双写。

当前 `ApplicationRepository` 的生产实现是 SQLite，OIDC Adapter 也必须使用 SQLite，因此 P2
只支持单实例。应用数据库、OIDC 数据库、用户数据库和 JWKS 应放入持久化 volume；部署和备份
要求见[应用管理接入指南](../APPLICATION_MANAGEMENT.md)。共享仓储落地前不得把该模式扩展到多实例。

## 拆包约束

`@gitea-oidc/node`、Express、Fastify、NestJS 和 CLI 必须继续复用共享 connection、credential
和错误 contract。框架包只能适配请求、响应、Cookie 和生命周期，不得各自重新实现 discovery、
PKCE、state、nonce、callback 或 token refresh。

Fastify 系 adapter 的关闭必须分成两个阶段：`preClose` 封口并等待已接收响应完成，随后才在
`onClose` 或 Nest `onApplicationShutdown` 中关闭共享核心，确保认证 callback 的 Session Cookie
不会因 socket 提前回收而丢失。

公开包只有在 JS、声明文件和 tarball 消费测试都不引用私有 workspace 包时才能发布。长期产品品牌
和 npm scope 尚未确认前，不应把现有兼容包改成依赖未发布 scope 包。
