# `@x-oidc/express`

基于 `@x-oidc/node` 的 Express 4/5 OIDC 连接器。它注册完整的浏览器登录路由并提供
`optionalAuth`、`requireAuth` 和类型安全的 `req.auth`，不在 Express 层保存或解析 Token。

## 当前状态

该包目前是 monorepo 内部预发布包，从 `2.0.0` 起与全部 workspace 包同步版本并保持 `private: true`。公开发布前会通过实际
tarball 分别验证 Express 4 和 Express 5 的运行与类型消费。

## 创建连接器

先按 `@x-oidc/node` 文档创建使用持久化 store 和跨实例 refresh lock 的客户端，再注入
Express 连接器：

```typescript
import { createExpressOidc } from "@x-oidc/express";
import express from "express";
import { nodeOidcClient } from "./oidc-client.js";

const app = express();
const oidc = createExpressOidc({
  client: nodeOidcClient,
  redirectUri: "https://app.example.com/oidc/callback",
  postLogoutRedirectUri: "https://app.example.com/signed-out",
});

app.use(oidc.router);

app.get("/profile", oidc.requireAuth, (req, res) => {
  const auth = oidc.getAuth(req);
  res.json({ user: auth.user });
});
```

`req.auth` 和 `getAuth()` 只返回 `AuthSessionView`，不会包含 Session ID、access token、
refresh token 或 ID token。`optionalAuth` 在没有会话时写入 `null` 并继续；`requireAuth` 返回
稳定的 `401` 错误。每个连接器实例使用独立认证缓存 key，组合多个连接器时不会复用另一实例的
会话结果。

## 路由

连接器直接注册以下固定绝对路径，不需要再次 mount 到 `/oidc`：

- `GET /oidc/login?returnTo=/dashboard`
- `GET /oidc/callback`
- `POST /oidc/logout`

其他 method 返回 `405`。logout 会先校验请求 `Origin`，通过后才清除本地 Session Cookie 并调用
Node SDK；来源校验失败不会修改 Cookie，来源通过后即使远端撤销或退出失败仍会清除本地 Cookie。
前端应使用同源 POST form 或 `fetch()`，不能使用普通退出链接：

```html
<form method="post" action="/oidc/logout">
  <button type="submit">退出</button>
</form>
```

## 错误与生命周期

登录路由和已知认证错误统一返回 `Cache-Control: no-store`、`Pragma: no-cache` 和
`Referrer-Policy: no-referrer`。所有异步 handler 都显式执行 `.catch(next)`，不依赖仅
Express 5 提供的 rejected Promise 自动转发行为。

如果传入现有 `client`，`oidc.close()` 不关闭它，但当前连接器实例会停止接受请求。如果传入完整
`clientOptions`，连接器会关闭自己创建的 Node client；其中的 store 和 lock 仍由调用方管理。
应用退出时应显式处理生命周期：

```typescript
await oidc.close();
```

## 验证

登录、callback、Cookie、auth 投影、logout、错误和生命周期合同由私有
`@x-oidc/connector-testkit` 统一执行。Express 包另行保留 Express 4 Promise 转发、异步错误
middleware 和只读 `request.auth` 等框架专属测试。

```bash
pnpm --filter @x-oidc/express typecheck
pnpm --filter @x-oidc/express test
pnpm --filter @x-oidc/express build
```
