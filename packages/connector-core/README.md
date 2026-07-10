# `@gitea-oidc/connector-core`

Express、Fastify 和 NestJS 连接器共用的框架无关 Web 适配核心。该包只负责固定路由语义、
Cookie、CSRF、`returnTo`、公开会话投影和错误映射，不实现 discovery、PKCE、Token 交换、
refresh 或 OIDC 校验；这些能力全部由 `@gitea-oidc/node` 提供。

包内同时提供轻量请求排空器，供 Fastify 和 NestJS adapter 在 `preClose` 阶段等待已接收响应，
避免 Session 已创建但 Cookie 尚未发送时关闭 socket。

## 当前状态

该包目前是 monorepo 内部包，版本为 `0.0.0` 且保持 `private: true`。应用代码应优先安装具体的
Express、Fastify 或 NestJS 连接器，不直接依赖本包。

## 固定 HTTP 合同

- `GET /oidc/login`
- `GET /oidc/callback`
- `POST /oidc/logout`

callback 只把原始 query 和短期 transaction Cookie 交给 `@gitea-oidc/node`。核心不会读取
`Host`、`X-Forwarded-Host` 或其他代理头来拼 callback URL；注册的 `redirectUri` 必须是绝对
`/oidc/callback` URL，且不能携带 query 或 fragment。

`returnTo` 只能是本站以 `/` 开头的相对路径，禁止绝对 URL、协议相对 URL、fragment、反斜杠和
编码后的 slash/control character。

## Cookie 合同

HTTPS 默认使用：

- `__Host-gitea_oidc_transaction_<origin-hash>`：`HttpOnly`、`SameSite=Lax`、`Secure`，Path 固定
  为 `/`，有效期来自登录事务。
- `__Host-gitea_oidc_session_<origin-hash>`：`HttpOnly`、`SameSite=Lax`、`Secure`，Path 固定为
  `/`，有效期来自公开会话视图。

loopback HTTP 开发环境使用无前缀、无 `Secure` 的名称。Cookie 不支持 `Domain`，重复的目标
Cookie、非 opaque 值和过大 Cookie header 会被拒绝或清理。

两个 HTTPS Cookie 都使用 `__Host-`，阻止同站兄弟子域通过 Domain cookie tossing 稳定阻断登录。
默认名称还包含注册 callback origin 的短哈希，避免同一 hostname 不同端口的开发服务互相覆盖。
自定义 HTTPS 名称也必须使用 `__Host-`；同一 origin 内挂载多个连接器时，调用方必须提供不同名称。
解析时继续拒绝同名重复 Cookie。

## 存储与所有权

生产环境不得隐式使用内存状态。调用方式必须二选一：

- 注入已经创建的 `NodeOidcClient`；连接器 `close()` 不关闭它，但会关闭当前连接器实例，后续请求
  返回 `CLIENT_CLOSED`。
- 注入完整 `NodeOidcClientOptions`；其中 transaction store、session store 和 refresh lock
  都是必填项。核心调用生产工厂 `createNodeOidcClient()`，不会调用
  `createInMemoryNodeOidcClient()`。

Node SDK 仍把注入的 store 和 lock 视为调用方资源；调用方需要在自己的进程生命周期中关闭这些
资源。

## 安全边界

- logout 必须使用 POST，并要求 `Origin` 精确等于注册 callback 的 origin。
- logout 适配器必须先调用核心校验 `Origin`，校验通过后才能清除 Session Cookie；来源拒绝时不得
  修改 Cookie。来源通过后，即使远端撤销或 OP logout 失败，也要保留本地 Cookie 清理响应。
- callback 适配器在成功和失败路径都清除一次性 transaction Cookie。
- logout 只暴露固定 `warnings` code，不透传 Token、Session ID 或上游异常文本。
- `onLogoutWarning` 可把固定 warning code 交给指标或日志；hook 抛错不会阻断本地退出和 Cookie 清理。
- 对外认证上下文会重新投影为 `AuthSessionView` 白名单；意外附带的 Token、Session ID 或内部字段
  不会进入框架 request。
- 已知错误映射成固定的脱敏 JSON；未知错误交回具体框架的错误链。

## 验证

```bash
pnpm --filter @gitea-oidc/connector-core typecheck
pnpm --filter @gitea-oidc/connector-core test
pnpm --filter @gitea-oidc/connector-core build
```
