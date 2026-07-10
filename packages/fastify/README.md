# `@gitea-oidc/fastify`

基于 `@gitea-oidc/node` 和 `@gitea-oidc/connector-core` 的 Fastify 5 OIDC 连接器。它注册
完整的浏览器登录路由，提供 `optionalAuth`、`requireAuth`、`getAuth()` 和类型安全的
`request.auth`，不在 Fastify 层保存或解析 Token。

## 当前状态

该包目前是 monorepo 内部预发布包，版本为 `0.0.0` 且保持 `private: true`。运行时要求
Node.js `>=20.19.0` 和 Fastify `^5.0.0`。

## 注册插件

先按 `@gitea-oidc/node` 文档创建使用持久化 store 和跨实例 refresh lock 的客户端，再创建并
注册 Fastify plugin：

```typescript
import { createFastifyOidc } from "@gitea-oidc/fastify";
import Fastify from "fastify";
import { nodeOidcClient } from "./oidc-client.js";

const app = Fastify();
const oidc = createFastifyOidc({
  client: nodeOidcClient,
  redirectUri: "https://app.example.com/oidc/callback",
  postLogoutRedirectUri: "https://app.example.com/signed-out",
});

app.register(oidc);

app.get("/profile", { preHandler: oidc.requireAuth }, async (request) => {
  const auth = oidc.getAuth(request);
  return { user: auth.user };
});

await app.listen({ port: 3000 });
```

插件会通过 `decorateRequest("auth", null)` 注册 `request.auth`。`request.auth` 和
`getAuth()` 只返回 `AuthSessionView`，不会包含 Session ID、Access Token、Refresh Token 或
ID Token。`optionalAuth` 在没有会话时保留 `null` 并继续；`requireAuth` 返回稳定的 `401`
错误。每个插件实例使用独立认证缓存 key，组合多个实例的 hook 时不会复用另一实例的会话结果。

## 固定路由

连接器直接注册以下绝对路径：

- `GET /oidc/login?returnTo=/dashboard`
- `GET /oidc/callback`
- `POST /oidc/logout`

其他常用 HTTP method 返回 `405`。连接器只把原始 query、Cookie 和 Origin 交给共享核心，
不会从 `Host` 或代理头拼接 callback URL。

logout 会先校验请求 `Origin`，通过后才清除本地 Session Cookie 并调用 Node SDK。来源校验失败
不会修改 Cookie；来源通过后即使远端撤销或 OP logout 失败，本地 Cookie 仍会被清除。前端应使用
同源 POST form 或 `fetch()`，不能使用普通退出链接：

```html
<form method="post" action="/oidc/logout">
  <button type="submit">退出</button>
</form>
```

## Cookie 与错误

HTTPS callback 默认使用按 origin 命名空间隔离的 `__Host-` transaction 和 session Cookie。
Cookie 始终设置 `HttpOnly`、`SameSite=Lax`、`Secure`、`Path=/` 和有限 Max-Age；连接器不会把
Session ID 放进 `request.auth`、日志或响应 body。

已知 connector 和 Node SDK 错误会映射为固定 JSON 错误，并附带 `Cache-Control: no-store`、
`Pragma: no-cache` 和 `Referrer-Policy: no-referrer`。未知异常继续交给应用自己的 Fastify
error handler。

## 生命周期

插件采用两阶段停机：`preClose` 先停止接收并等待已经进入请求链的响应完成，确保 callback 的
Session Cookie 和 `303` 已经发送；随后在 `onClose` 阶段调用连接器的幂等 `close()`：

- 传入现有 `client` 时不关闭它，但 `close()` 后当前连接器实例拒绝新请求；
- 传入完整 `clientOptions` 时关闭连接器创建的 Node client；
- `clientOptions` 中注入的 store 和 refresh lock 仍由调用方关闭。

如需在 Fastify 之外提前释放，也可以显式调用：

```typescript
await oidc.close();
```

`close()` 是请求生命周期之外的管理 API，不要在当前 Fastify handler 或 hook 内等待它，否则当前
响应本身会成为尚未排空的请求。

## 验证

登录、callback、Cookie、auth 投影、logout、错误和生命周期合同由私有
`@gitea-oidc/connector-testkit` 统一执行。Fastify 包另行保留非 encapsulated request decoration
和异步错误 handler 等框架专属测试。

```bash
pnpm --filter @gitea-oidc/fastify test
pnpm --filter @gitea-oidc/fastify typecheck
pnpm --filter @gitea-oidc/fastify build
```
