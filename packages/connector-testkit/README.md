# `@gitea-oidc/connector-testkit`

供 monorepo 内框架连接器复用的私有 Vitest conformance testkit。它从
`@gitea-oidc/connector-core` 的公开 HTTP 行为出发，统一验证登录、callback、Cookie、auth
投影、退出、错误与生命周期，不参与生产运行时，也不发布给应用开发者。

## Harness 边界

框架只需要实现 `ConnectorConformanceHarness`：

- `createInjected()`：用 testkit 提供的 `NodeOidcClient` 创建框架应用；
- `createOwned()`：用完整 `clientOptions` 创建框架应用；
- `request()`：把统一请求转换为框架的 inject、fetch 或测试客户端调用；
- `close()`：执行该框架的正常关闭流程；
- `probeAfterClose()`：关闭后直接调用 connector auth 边界，返回标准化的
  `CLIENT_CLOSED` 响应。

Harness 返回的响应只包含 status、大小写无关 header、`Set-Cookie` 数组、body 和 JSON 解析，
不暴露 Express、Fastify 或 Nest 类型。

```typescript
import {
  type ConnectorConformanceHarness,
  defineConnectorConformanceSuite,
} from "@gitea-oidc/connector-testkit";

const harness: ConnectorConformanceHarness = {
  name: "my-framework",
  async createInjected({ client, configuration }) {
    return createFrameworkFixture({ client, configuration });
  },
  async createOwned({ clientOptions, configuration }) {
    return createOwnedFrameworkFixture({ clientOptions, configuration });
  },
};

defineConnectorConformanceSuite(harness);
```

## 统一合同

每个 Harness 会运行同一组测试：

- `GET /oidc/login`、安全 `returnTo` 和外部跳转拒绝；
- callback 不信任 Host，固定使用已配置 Redirect URI；
- transaction 清理与 Session Cookie 写入；
- `optionalAuth`、`requireAuth`、单次 session 解析和公开 `AuthSessionView` 投影；
- 非法 Session Cookie 与 callback 错误会清理对应的一次性或无效 Cookie；
- `POST /oidc/logout` 与精确同源 Origin，CSRF 拒绝不会改动本地会话，上游退出失败仍清理本地会话；
- 稳定错误映射、敏感异常元数据脱敏和包含 `TRACE` 的错误 method `405`；
- 注入 client 不关闭，owned client 随框架生命周期关闭。

各框架仍应保留专属测试，例如 Express 4 Promise 转发、Fastify request decoration、Nest
decorator/guard 和双 platform bootstrap。

## Nest 接入

Nest Express 与 Nest Fastify 可以对同一个 Harness 工厂执行两次 suite。适配器在
`createInjected()`/`createOwned()` 中动态创建测试 Module，并分别传入默认 adapter 或
`FastifyAdapter`；`request()` 可继续使用当前真实监听端口的 fetch 方式。保护路由分别绑定
optional/required guard，`close()` 调用 `app.close()`，`probeAfterClose()` 直接调用已关闭的
`NestOidcService` auth 边界。Nest 自己的 decorator、guard 注入和 `registerAsync` 仍放在专属
测试中。

## 验证

```bash
pnpm --filter @gitea-oidc/connector-testkit test
pnpm --filter @gitea-oidc/connector-testkit typecheck
pnpm --filter @gitea-oidc/connector-testkit build
```
