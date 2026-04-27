# Provider API 设计

本文面向维护者，说明统一 Provider API、token 仓储和 SDK 子路径的实现边界。

## 核心模块

- `src/types/providerApi.ts` 定义 `ProviderApiClient`、`ProviderTokenRecord` 和代理请求类型。
- `src/repositories/*ProviderTokenRepository.ts` 提供 memory、SQLite、PostgreSQL token 仓储。
- `src/provider-api/*` 实现 Provider client、权限服务和后台探活调度器。
- `src/routes/providerApiRoutes.ts` 暴露 SDK 代理，`src/routes/adminRoutes.ts` 暴露后台 API。

## 权限模型

`ProviderApiService` 负责跨 Provider 的通用权限判断：

- `tokenKind: "user"` 默认使用当前 OIDC 用户的 token。
- 指定其他用户的 `ownerId` 需要管理员权限。
- `tokenKind: "app"` 只能由管理员调用。
- 管理员由 `admin.allowedGroups` 判断，默认 `Owners`。

Provider client 负责更靠近平台的限制：

- 只允许相对路径，拒绝绝对 URL 和协议相对 URL。
- 设置 `allowedOperations` 后，SDK 请求必须提交命中的 `operation`。
- `Authorization` 头由服务端覆盖，调用方不能注入第三方 token。

## Token 生命周期

Provider token 以明文进入仓储接口，持久化实现必须在写入前加密。当前加密工具为
`TokenEncryptor`，使用 AES-256-GCM 和 `providerApi.tokenEncryptionKey` 派生密钥。

刷新策略分为两层：

- 懒刷新：`getUserToken()` 发现 token 即将过期时调用 `refreshUserToken()`。
- 巡检：`ProviderTokenProbeScheduler` 定期探测即将过期或异常 token。

## Feishu 实现

`FeishuAuthProvider` 在 OAuth 回调成功后保存用户 token。`FeishuProviderApiClient` 负责：

- 获取并缓存应用 token。
- 使用 refresh token 刷新用户 token。
- 通过 `/authen/v1/user_info` 探测用户 token。
- 通过统一 `request()` 调用飞书 OpenAPI。

## DingTalk 骨架

`DingTalkProviderApiClient` 当前只保留统一接口骨架。后续实现时应复用同样的仓储、
权限和探活流程，并补齐：

- 钉钉 OAuth 登录 Provider。
- 用户 token 交换与刷新。
- 应用 token 获取。
- 钉钉 user/app token 的探活端点。

## SDK 子路径

`package.json` 暴露以下 ESM 子路径：

- `gitea-oidc/client`
- `gitea-oidc/express`
- `gitea-oidc/nest`
- `gitea-oidc/vue`

构建由 `rolldown` 多入口输出 JS，`tsc --emitDeclarationOnly` 输出声明文件。
