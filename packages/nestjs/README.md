# `@gitea-oidc/nestjs`

面向 NestJS 10/11 的 OIDC 连接器。该包通过 Nest `HttpAdapterHost` 操作通用 HTTP 边界，运行时
同时支持 `@nestjs/platform-express` 和 `@nestjs/platform-fastify`，不依赖
`@gitea-oidc/express`，也不会在 Nest 层保存或解析 Token。

## 当前状态

该包目前是 monorepo 内部预发布包，版本为 `0.0.0` 且保持 `private: true`。公开发布前会继续通过
实际 tarball 验证 NestJS 10/11 的类型消费和两种 HTTP adapter 的运行时行为。

## 安装前提

应用应安装 Nest 核心依赖和一种 HTTP adapter：

```bash
pnpm add @gitea-oidc/nestjs @nestjs/common @nestjs/core reflect-metadata rxjs
pnpm add @nestjs/platform-express
```

Fastify 项目将最后一行替换为：

```bash
pnpm add @nestjs/platform-fastify
```

应用入口需要按 Nest 常规方式加载 `reflect-metadata`。

## 注册动态模块

如果应用已经创建 `NodeOidcClient`，可以直接注入：

```typescript
import { Module } from "@nestjs/common";
import { NestOidcModule } from "@gitea-oidc/nestjs";
import { nodeOidcClient } from "./oidc-client.js";

@Module({
  imports: [
    NestOidcModule.register({
      client: nodeOidcClient,
      redirectUri: "https://app.example.com/oidc/callback",
      postLogoutRedirectUri: "https://app.example.com/signed-out",
    }),
  ],
})
export class AppModule {}
```

需要从配置服务异步读取管理系统下发的连接配置时，可以使用 `registerAsync()`：

```typescript
NestOidcModule.registerAsync({
  imports: [ApplicationConfigModule],
  inject: [ApplicationConfigService],
  useFactory: async (config: ApplicationConfigService) => ({
    clientOptions: await config.createNodeOidcClientOptions(),
    redirectUri: config.oidcRedirectUri,
    postLogoutRedirectUri: config.oidcPostLogoutRedirectUri,
  }),
});
```

`clientOptions` 必须显式包含 transaction store、session store 和跨实例 refresh lock；生产环境不会
隐式启用内存存储。

## 固定路由

模块控制器注册以下固定合同：

- `GET /oidc/login?returnTo=/dashboard`
- `GET /oidc/callback`
- `POST /oidc/logout`

其他 method 返回 `405`。callback 只使用原始 query、短期 transaction Cookie 和配置中的注册
`redirectUri`，不会读取 `Host` 或代理头拼接 URL。logout 会先校验请求 `Origin`，通过后才清除
本地 Session Cookie；来源通过后，即使远端退出失败也会保留 Cookie 清理响应。

Nest 的 global prefix 默认会影响所有控制器。应用调用 `setGlobalPrefix()` 时，必须在应用层排除上述
三条 `/oidc/*` 路由，才能保持固定外部合同。

## Guard 和认证参数

`NestOidcOptionalAuthGuard` 允许匿名请求，`NestOidcRequiredAuthGuard` 在没有有效会话时返回稳定的
`401`。`@OidcAuth()` 和 `@OptionalOidcAuth()` 只读取 Guard 已解析的 `AuthSessionView`；未先运行
Guard 时不会静默信任 request 上的任意字段。

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  type AuthSessionView,
  NestOidcOptionalAuthGuard,
  NestOidcRequiredAuthGuard,
  OidcAuth,
  OptionalOidcAuth,
} from "@gitea-oidc/nestjs";

@Controller("profile")
export class ProfileController {
  @Get()
  @UseGuards(NestOidcRequiredAuthGuard)
  profile(@OidcAuth() auth: AuthSessionView) {
    return { user: auth.user };
  }

  @Get("preview")
  @UseGuards(NestOidcOptionalAuthGuard)
  preview(@OptionalOidcAuth() auth: AuthSessionView | null) {
    return { user: auth?.user ?? null };
  }
}
```

每个 `NestOidcService` 使用自己私有、不可枚举的 Symbol 在 request 上缓存解析结果；组合多个模块
实例时不会接受另一实例的会话，同一实例组合多个 Guard 时仍只访问一次 Session Store。公开视图经过
白名单投影和冻结，不包含 Session ID、access token、refresh token 或 ID token。

`NestOidcService` 也会作为 provider 导出，供需要命令式读取认证结果的控制器或 provider 注入。

## 生命周期和错误

- 传入现有 `client` 时，模块销毁不会关闭该 client，调用方仍负责其生命周期；当前连接器实例仍会
  被关闭并拒绝后续请求。
- 传入 `clientOptions` 时，模块拥有创建出的 Node client，并在 HTTP adapter 完成请求排空后的
  `onApplicationShutdown` 中关闭一次。
- 使用 Fastify adapter 时，模块会在 Fastify `preClose` 阶段先等待已经接收的响应完成，再允许底层
  HTTP server 回收连接，避免 callback 已创建 Session 却丢失响应 Cookie。
- 注入的 store 和 lock 仍属于调用方资源，应由应用统一关闭。
- 已知连接器和 Node SDK 错误使用固定脱敏响应；未知异常交给 Nest 全局异常链。
- OIDC 路由和已知认证错误统一设置 `Cache-Control: no-store`、`Pragma: no-cache` 和
  `Referrer-Policy: no-referrer`。

显式调用 `NestOidcService.close()` 时应位于请求生命周期之外，不要在当前 controller、guard 或
interceptor 中等待它。

## 验证

```bash
pnpm --filter @gitea-oidc/nestjs test
pnpm --filter @gitea-oidc/nestjs typecheck
pnpm --filter @gitea-oidc/nestjs build
```
