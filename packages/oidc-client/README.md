# `@x-oidc/node`

面向 Node.js 的框架无关 OIDC Relying Party 核心。它负责 Authorization Code + PKCE、
state/nonce 校验、一次性登录事务、服务端会话、Refresh Token 轮换和 RP-Initiated Logout；
Express、Fastify、Nest 等连接器只需要适配请求、响应和 Cookie，不应复制协议逻辑。

## 当前状态

该包目前是 monorepo 内部预发布包，从 `2.0.0` 起与全部 workspace 包同步版本并保持 `private: true`。运行时要求
Node.js `>=20.19.0`。包只构建一份 ESM 事实源，同时声明 `import`、`require` 和 `default` 条件；
CommonJS 通过该 Node 版本的 `require(esm)` 加载。OIDC 协议实现基于 `openid-client` v6。

## 配置来源

管理系统创建应用后会提供可重复保存的 `ApplicationConnectionV1` 和只展示一次的
`ApplicationCredentialV1`。SDK 会再次执行 contract 校验，并拒绝 Client 类型与凭据类型不一致、
凭据绑定字段与 connection 不一致、未注册回调地址以及带固定 query 的回调地址。

环境变量建议统一使用以下名称：

```dotenv
X_OIDC_ISSUER=https://id.example.com
X_OIDC_CLIENT_ID=replace-with-client-id
X_OIDC_CLIENT_SECRET=replace-with-one-time-secret
X_OIDC_REDIRECT_URI=https://app.example.com/oidc/callback
X_OIDC_SCOPES=openid profile email offline_access
```

Secret 不属于 connection，不能写入接入说明、日志、错误、前端配置或版本库。

## 创建客户端

生产工厂要求显式注入事务存储、会话存储和刷新锁：

```typescript
import {
  createNodeOidcClient,
  type AuthSessionStore,
  type LoginTransactionStore,
  type RefreshLock,
} from "@x-oidc/node";
import {
  APPLICATION_CREDENTIAL_SCHEMA_VERSION,
  parseApplicationConnectionV1,
  parseApplicationCredentialV1,
} from "@x-oidc/contracts";

declare const transactionStore: LoginTransactionStore;
declare const sessionStore: AuthSessionStore;
declare const refreshLock: RefreshLock;

const client = createNodeOidcClient({
  connection: parseApplicationConnectionV1(connectionJson),
  credential: parseApplicationCredentialV1({
    schemaVersion: APPLICATION_CREDENTIAL_SCHEMA_VERSION,
    applicationId: connectionJson.applicationId,
    oidcClientId: connectionJson.oidcClientId,
    issuer: connectionJson.issuer,
    clientId: connectionJson.clientId,
    kind: "client_secret",
    clientSecret: process.env.X_OIDC_CLIENT_SECRET,
  }),
  transactionStore,
  sessionStore,
  refreshLock,
});
```

`createNodeOidcClient` 不会接管注入资源的生命周期。应用关闭时先停止新请求，再调用
`client.close()`，最后由应用关闭自己注入的数据库、Redis 客户端和锁。并发或重复调用
`client.close()` 会观察同一个完成或失败结果；关闭开始后所有新操作都返回 `CLIENT_CLOSED`，已被
客户端接受的登录、回调、会话、刷新和退出操作会完成后才关闭内部资源。

单机生产部署可以直接使用官方私有预览包 `@x-oidc/node-sqlite`。它提供 AES-256-GCM 静态
加密、transaction 原子消费、session CAS 和跨进程 refresh lease；完整示例见
[`packages/oidc-client-sqlite/README.md`](../oidc-client-sqlite/README.md)。多主机部署仍需后续共享
Redis/PostgreSQL adapter。

单进程开发和测试可以显式使用内存模式：

```typescript
import { createInMemoryNodeOidcClient } from "@x-oidc/node";

const client = createInMemoryNodeOidcClient({ connection, credential });
```

内存模式不跨进程、不跨重启，也没有高可用能力，不能作为生产环境的静默默认值。

## 登录流程

```typescript
const login = await client.beginLogin({
  redirectUri: "https://app.example.com/oidc/callback",
  returnTo: "/settings/security",
});

// 连接器把 transactionId 写入短期 Cookie，然后 302 到 authorizationUrl。
```

连接器必须把 `transactionId` 保存到短期 Cookie，推荐使用带应用命名空间的 host-only
`__Host-` Cookie，并设置 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，使 Cookie 过期时间
不晚于 `expiresAt`。`transactionId`
与 OAuth `state` 是两个独立高熵值：前者绑定发起登录的浏览器，后者绑定授权请求。

回调只传 OAuth query 参数，不传也不信任由 `Host`、`X-Forwarded-Host` 或完整请求 URL
拼出的地址：

```typescript
const result = await client.completeCallback({
  transactionId: transactionCookie,
  callbackParameters: new URL(request.url, "https://ignored.invalid").searchParams,
});

// 连接器在成功和失败路径都清理 transaction Cookie。
// 成功后把 result.sessionId 写入新的安全 Session Cookie，再跳转到 result.returnTo。
```

SDK 使用事务中保存的已注册 `redirectUri` 重建回调 URL，并原子消费事务，因此事务不能重放。
`returnTo` 只接受 `/path?query` 形式的同站相对路径，绝对 URL、协议相对 URL、反斜杠、fragment
和控制字符都会被拒绝。

## 会话、刷新与退出

```typescript
const session = await client.getSession(sessionCookie);
if (!session) {
  // 未登录或会话已过期
}

const refreshed = await client.refreshSession(sessionCookie);

const logout = await client.logout({
  sessionId: sessionCookie,
  postLogoutRedirectUri: "https://app.example.com/signed-out",
});
// 连接器先完成 CSRF Origin 校验；通过后无论远端退出是否成功都应清理本地 Session Cookie。
```

`AuthSessionView` 只包含用户白名单字段、scope、创建/过期时间和 `canRefresh`，不包含
Access Token、Refresh Token、ID Token 或内部 Session ID。框架连接器不得自行把 Store 记录暴露给
handler、模板或 JSON 响应。

Refresh Token 轮换在 `RefreshLock` 内重读会话，并用 `refreshVersion` 执行
compare-and-swap。自定义实现必须提供跨实例互斥和原子 CAS；锁租约失效时 CAS 仍是最后一道防线。
`invalid_grant` 会在锁内重新读取会话：只有 owner、`refreshVersion` 和 Refresh Token 都仍指向失败
请求时，才通过条件删除终止旧会话；另一个实例已经完成轮换时保留新会话。

退出会先按 owner 和版本删除本地会话，再分别尝试撤销 Refresh Token 与 Access Token，最后始终尝试
构造身份服务退出 URL。单个撤销失败不会恢复本地会话或阻止 OP logout，而是通过不含 Token 的
`warnings` 返回部分失败：

```typescript
const result = await client.logout({ sessionId });
if (result.warnings.length > 0) {
  // 记录固定 warning code，不记录 logout URL、Session ID 或 Token。
}
```

## 存储接口的安全要求

- `LoginTransactionStore.create` 必须按 `ownerNamespace + transactionId` 执行 set-if-absent，
  `consume` 必须按同一 owner 原子读取并删除。
- `AuthSessionStore` 的 create/get/CAS/delete 必须以 `ownerNamespace + sessionId` 为完整 key，不能让
  不同 issuer、应用或 Client 共用裸 Session ID。
- `ownerNamespace` 绑定版本化 connection 安全策略；scope、resource、PKCE 或 refresh 能力收缩后，
  旧会话按不存在处理，由连接器清理 Cookie，不会把策略失配误报为存储故障。
- `AuthSessionStore.compareAndSwap` 必须同时校验 owner、Session ID 和 `refreshVersion`；
  `deleteIfVersion` 也必须原子校验这三个维度。
- `SensitiveAuthSessionRecord` 含明文 Token，持久化实现必须静态加密并限制数据库权限。
- 存储日志、慢查询、审计和异常不得包含整个事务、会话或 Token。
- 多实例部署必须使用共享存储与分布式锁；包内 Memory 实现仅供开发测试。

## 错误处理

所有公开方法使用稳定的 `NodeOidcError`：

```typescript
import { isNodeOidcError } from "@x-oidc/node";

try {
  await client.completeCallback({ transactionId, callbackParameters });
} catch (error) {
  if (isNodeOidcError(error)) {
    response.statusCode = error.status;
    response.end(error.expose ? error.message : "认证服务暂时不可用");
  }
}
```

错误消息是固定脱敏文本，不携带原始 `cause`、上游响应、authorization code、Secret 或 Token。
`isNodeOidcError` 使用全局 Symbol brand 和字段校验，不依赖单一包副本的 `instanceof`。
跨 Store/Lock 边界收到 branded error 时，SDK 只读取合法 `code` 并重建规范错误，不信任调用方传入的
`message`、`status`、`expose`、`cause` 或其他字段。

## HTTP loopback 与测试入口

HTTPS issuer 按 OIDC 标准允许发现不同 HTTPS origin 的协议端点。仅在本地开发使用 loopback HTTP
issuer 时，SDK 才启用 `openid-client` 的 insecure transport 扩展；发现到的 authorization、token、
JWKS、revocation、userinfo 和 logout 等端点必须仍位于完全相同的 loopback origin，否则启动失败。

主入口的 `createNodeOidcClient` 和 `createInMemoryNodeOidcClient` 不接受协议适配器、时钟或随机数替身，
JavaScript 调用即使附带这些额外字段也会被忽略。仓库测试只能从
`@x-oidc/node/internal/testing` 使用这些危险注入点；生产连接器不得导入或透传该子路径。

## 当前边界

该包只实现 Web 应用的 OIDC RP 与服务端 Session，不实现框架路由、Cookie、中间件，也不实现
Resource Server 的 Bearer Token 验证。Bearer 认证属于后续独立 capability，连接器不能自行解析
或仅解码 JWT 代替完整验证。
