# 管理后台与 Provider API 接入指南

本文面向部署者和业务系统接入方，说明如何启用内置管理后台、保存 Provider token，
以及通过 SDK 代理调用飞书、钉钉等平台 API。

后台应用控制面中的模板与自定义应用、一次性 OIDC Client 凭据、Client Secret 轮换和
`clientSource` 切换由独立的[应用管理接入指南](./APPLICATION_MANAGEMENT.md)说明。

## 工作方式

本功能包含三层：

- 内置管理后台：默认访问路径为 `/admin`，用于账号管理、Provider 状态和 token 探活。
- Provider API 代理：默认接口为 `/api/provider/:provider/request`，业务系统只提交 OIDC
  access token。
- SDK 子路径：从 `gitea-oidc/client`、`gitea-oidc/express`、`gitea-oidc/nest`、
  `gitea-oidc/vue` 引入。

浏览器和业务服务不直接持有第三方 refresh token。第三方 token 只保存在本服务的 token
仓储中，持久化前使用 `providerApi.tokenEncryptionKey` 加密。

## 前置条件

- 服务端使用 Node.js `>=22` 和 `pnpm@10`。
- `server.url` 是服务对外根地址，例如 `https://id.example.com`，不能包含 query 或 fragment。
- `oidc.issuer` 是 OIDC 挂载地址，必须等于 `${server.url}/oidc`，不能包含 query 或 fragment。
- `server.corsOrigins` 默认是空数组，不会对任意浏览器来源开放 CORS；跨域浏览器 SDK
  接入时必须显式列出业务前端 HTTPS Origin，不能包含 path、query 或 fragment。
- 生产环境必须配置强且非默认的 `oidc.cookieKeys`、`clients[].client_secret`、持久化 JWKS；
  启用 Provider API 时必须配置非默认 `providerApi.tokenEncryptionKey`。
- `NODE_ENV=production` 下，`server.url`、客户端回调 URL 和 `server.corsOrigins`
  必须使用 HTTPS，用户仓储和 OIDC 适配器不能使用 `memory`。
- `NODE_ENV=production` 下启用本地认证时，必须配置 `passwordFile`，并显式使用
  `passwordFormat: "bcrypt"`，避免 `auto` 回退到弱哈希或明文密码。
- `NODE_ENV=production` 下启用 Provider API SDK 代理时，必须通过
  `providerApi.allowedClientIds` 指定允许调用代理的 OIDC `client_id`。

本地默认发现文档地址：

```bash
curl http://localhost:3000/oidc/.well-known/openid-configuration
```

## 启用管理后台

后台默认挂载在 `/admin`，管理员默认通过专用用户组 `gitea-oidc-admins` 判断。使用本地认证时，
`local.config.adminUsers` 中的用户会自动获得 `gitea-oidc-admins` 组。

```json
{
  "server": {
    "url": "http://localhost:3000",
    "corsOrigins": []
  },
  "oidc": {
    "issuer": "http://localhost:3000/oidc"
  },
  "clients": [
    {
      "client_id": "gitea",
      "client_secret": "change-this-client-secret",
      "redirect_uris": [
        "http://localhost:3001/user/oauth2/gitea/callback",
        "http://localhost:3000/admin/callback"
      ],
      "response_types": ["code"],
      "grant_types": ["authorization_code", "refresh_token"],
      "token_endpoint_auth_method": "client_secret_basic"
    }
  ],
  "auth": {
    "providers": {
      "local": {
        "enabled": true,
        "displayName": "本地密码",
        "config": {
          "passwordFile": ".htpasswd",
          "passwordFormat": "bcrypt",
          "adminUsers": ["admin"]
        }
      }
    }
  },
  "admin": {
    "enabled": true,
    "basePath": "/admin",
    "allowedGroups": ["gitea-oidc-admins"],
    "sessionTtlSeconds": 3600
  }
}
```

启动后访问：

```text
http://localhost:3000/admin
```

后台登录页为 `/admin/login`，点击登录后由 `/admin/login/start` 发起本服务 OIDC 授权码流程。
登录成功后，后台使用 HttpOnly BFF session cookie 访问 `/admin/api/*`。
`/admin/api/*` 不接受 OIDC bearer token；业务系统持有的 OIDC access token 只能调用
Provider API 代理。

启用内置后台时，必须至少有一个 `clients[]` 同时满足以下条件：

- `redirect_uris` 包含 `${server.url}${admin.basePath}/callback`，例如
  `http://localhost:3000/admin/callback`。
- `response_types` 包含 `code`。
- `grant_types` 包含 `authorization_code`。
- `token_endpoint_auth_method` 为 `client_secret_basic`。

服务端会选择匹配后台 callback 的客户端发起后台登录，不依赖 `clients[0]`。没有符合条件的
客户端时，配置验证会阻止启动。

管理台页面支持直接访问和刷新：

- `/admin/login`：后台登录页
- `/admin/users`：账号管理
- `/admin/providers`：Provider 状态
- `/admin/tokens`：Token 状态

后台安全边界：

- HTTPS 部署下，后台 session cookie 会自动追加 `Secure`。
- 生产环境非 HTTPS 公开 URL 会被配置验证拒绝，避免后台登录和 Provider API 在明文通道下运行。
- 后台 OAuth 登录 state 为一次性使用，默认 10 分钟过期，并有内存容量上限。
- 后台 OAuth callback 只接受后台客户端换回的 access token，并校验 token 仍绑定有效 grant；
  非后台客户端或 grant 不匹配的 token 不会建立后台 session。
- 后台 BFF session 有 TTL 和内存容量上限；超过上限时会淘汰最旧 session。
- 后台 API 只接受后台 BFF session cookie，不接受任意 OIDC 客户端获得的 bearer token。
- 后台 HTML 和 `/admin/assets/*` 静态资源会追加浏览器安全响应头，包括 CSP
  `frame-ancestors 'none'`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`
  和 `Referrer-Policy: same-origin`。
- OIDC 统一登录页 `/interaction/:uid` 也会追加 CSP、frame、nosniff 和 referrer
  安全响应头；OAuth 登录按钮只接受 HTTP(S) 或站内绝对路径 URL，Provider 返回的 raw HTML
  片段仍按可信插件代码处理。
- 使用后台 cookie session 的写接口会校验同源 `Origin`/`Referer`、JSON
  `Content-Type` 和 `X-Gitea-OIDC-Admin-Action: 1` 请求头。
- 后台用户 API 只返回管理台需要的账号字段，不返回 `metadata` 或 `providerProfile.raw`
  等 Provider 原始档案。
- 后台用户创建和编辑只接受下方列出的字段；编辑时还会拒绝修改
  `authProvider` 和 `externalId`。身份改绑需要独立的事务与凭据撤销流程，当前后台不提供。
- `GET /admin/api/tokens` 只返回 token 状态摘要，不会返回 `accessToken` 或
  `refreshToken` 明文。

## 后台功能

当前后台提供以下能力：

- 当前管理员信息：`GET /admin/api/me`
- 用户列表：`GET /admin/api/users`
- 用户详情：`GET /admin/api/users/:sub`
- 创建用户：`POST /admin/api/users`
- 更新用户：`PATCH /admin/api/users/:sub`
- 禁用、启用、删除用户：通过更新 `status` 或 `DELETE /admin/api/users/:sub`
- Provider 状态：`GET /admin/api/providers`
- Token 列表：`GET /admin/api/tokens`
- 手动探活：`POST /admin/api/tokens/probe`

禁用或删除用户时，服务端会先撤销 OIDC 与 Provider 凭据；撤销失败则不改变用户状态，
避免出现“后台显示已禁用，但旧 refresh token 仍可用”的不一致状态。

创建用户支持 `username`、`name`、`email`、`authProvider`、`externalId`、`groups`、`roles`、
`status`、`picture`、`phone`。编辑用户只支持其中除 `authProvider`、`externalId` 外的字段。
`status` 可用值为 `active`、`disabled`、`locked` 和 `pending`。同一组 `authProvider` 和
`externalId` 只能绑定一个用户；重复绑定会被拒绝。管理员权限仍以 `groups` 命中
`admin.allowedGroups` 判定。

`GET /admin/api/users` 支持以下查询参数：

- 过滤字段：`username`、`name`、`email`、`authProvider`、`status`。
- 排序字段：`sortBy=username|name|email|authProvider|status|createdAt|updatedAt`。
- 排序方向：`sortOrder=asc|desc`。
- 分页字段：`offset` 为非负整数，`limit` 为 `1` 到 `500` 的整数；未传 `limit`
  时默认返回前 100 条。

其它查询字段会返回 `400`。后台不会把任意 `sortBy` 或过滤字段透传给数据库。

`GET /admin/api/tokens` 支持以下查询参数：

- 过滤字段：`provider`、`ownerType`、`ownerId`、`status`。
- `ownerType` 可用值为 `user`、`app`。
- `status` 可用值为 `valid`、`expired`、`refresh_failed`、`revoked`、`unknown`。
- 分页字段：`offset` 为非负整数，`limit` 为 `1` 到 `500` 的整数；未传 `limit`
  时默认返回前 100 条。

其它查询字段会返回 `400`。后台 token 查询默认分页，只返回状态摘要，不返回第三方 token 明文。

`POST /admin/api/tokens/probe` 只接受 JSON 请求体中的 `provider`、`ownerType` 和
`ownerId`，且 `ownerType` 只能是 `user` 或 `app`。其它字段或非法枚举值会返回 `400`。

## 启用 Provider API

Provider API 默认关闭。启用后会保存第三方 Provider token，并使用和
`auth.userRepository.type` 相同的存储后端，支持 `memory`、`sqlite` 和 `pgsql`。
生产环境不要使用 `memory`。

如果浏览器端应用直接调用 Provider API，必须在 `server.corsOrigins` 中配置精确的业务前端
Origin，例如 `https://app.example.com`。不要使用反向代理把任意 Origin 放行。

Provider API provider 的 `baseUrl` 是第三方 token 出站边界。启用某个 provider 时，
`baseUrl` 只能使用 HTTP/HTTPS，不能包含用户名、密码、query 或 fragment；生产环境必须使用
HTTPS，避免第三方 access token 通过明文链路发送。

```json
{
  "oidc": {
    "claims": {
      "openid": ["sub"],
      "profile": ["name", "email", "groups", "roles", "status"],
      "provider_api": []
    }
  },
  "server": {
    "corsOrigins": ["https://app.example.com"]
  },
  "providerApi": {
    "enabled": true,
    "tokenEncryptionKey": "replace-with-a-32-byte-random-provider-token-secret",
    "refreshSkewSeconds": 300,
    "probeIntervalSeconds": 300,
    "requestTimeoutMs": 10000,
    "responseBodyLimitBytes": 1048576,
    "sdkProxy": true,
    "allowedClientIds": ["gitea"],
    "providers": {
      "feishu": {
        "enabled": true,
        "baseUrl": "https://open.feishu.cn/open-apis",
        "allowedOperations": ["authen.user_info", "contact.user.get"],
        "defaultAppOwnerId": "default"
      },
      "dingtalk": {
        "enabled": false,
        "baseUrl": "https://api.dingtalk.com",
        "allowedOperations": [],
        "defaultAppOwnerId": "default"
      }
    }
  }
}
```

`tokenEncryptionKey` 必须至少 32 个字符，且不能使用示例占位值。建议使用随机值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`allowedClientIds` 是可以调用 `/api/provider/:provider/request` 的 OIDC 客户端白名单。
生产环境启用 `providerApi.enabled` 且 `sdkProxy` 为 `true` 时不能为空，并且每个值必须存在于
`clients[].client_id`。这样可以避免低信任 OIDC 客户端拿到用户 access token 后横向调用
Provider API。

`requestTimeoutMs` 控制 Provider API 代理、用户 token 刷新和 app token 获取的第三方出站请求
超时时间，默认 `10000` 毫秒。该值必须在 `1000` 到 `60000` 毫秒之间，避免慢连接或无响应的
第三方接口长期占用请求处理资源。

`responseBodyLimitBytes` 控制 Provider API 代理、用户 token 刷新和 app token 获取读取第三方
响应体的最大字节数，默认 `1048576` 字节。该值必须在 `1024` 到 `10485760` 字节之间，避免
第三方异常响应或被授权调用方触发的大响应长期占用服务端内存。

调用 Provider API 的 access token 还必须包含 `provider_api` scope。业务客户端发起 OIDC
授权请求时需要在 `scope` 中包含 `openid provider_api`；普通登录 token 即使来自白名单
`client_id`，缺少该 scope 也会被 `/api/provider/:provider/request` 拒绝。

服务端还会校验该 access token 关联的 OIDC client 和授权 grant 仍存在且未过期；如果 client
已从配置移除、grant 已过期或 token 与 grant 的用户/client 不一致，请求会按无效 bearer
token 处理。

## Feishu token 入库流程

Feishu Provider API 依赖飞书 OAuth 登录回调保存用户 token。完整流程如下：

1. 在飞书开放平台配置应用，并按 [飞书认证插件使用指南](./FEISHU_PLUGIN_GUIDE.md)
   配置 `auth.providers.feishu`。
2. 启用 `providerApi.providers.feishu.enabled`。
3. 用户通过飞书登录一次。
4. OAuth callback 成功后，本服务保存该用户的 `accessToken`、`refreshToken` 和过期时间。
5. 业务系统持本服务签发且包含 `provider_api` scope 的 OIDC access token 调用 Provider API。

示例配置：

```json
{
  "auth": {
    "providers": {
      "feishu": {
        "enabled": true,
        "displayName": "飞书登录",
        "priority": 2,
        "config": {
          "appId": "cli_your_app_id",
          "appSecret": "your_app_secret",
          "redirectUri": "https://id.example.com/auth/feishu/callback",
          "scope": "contact:user.base:readonly",
          "encryptKey": "your_encrypt_key_here",
          "verificationToken": "your_verification_token_here",
          "autoCreateUser": true
        }
      }
    }
  },
  "providerApi": {
    "enabled": true,
    "tokenEncryptionKey": "replace-with-a-32-byte-random-provider-token-secret",
    "refreshSkewSeconds": 300,
    "probeIntervalSeconds": 300,
    "requestTimeoutMs": 10000,
    "responseBodyLimitBytes": 1048576,
    "sdkProxy": true,
    "allowedClientIds": ["gitea"],
    "providers": {
      "feishu": {
        "enabled": true,
        "baseUrl": "https://open.feishu.cn/open-apis",
        "allowedOperations": ["authen.user_info"]
      }
    }
  }
}
```

应用 token 会在需要 `tokenKind: "app"` 时按需获取并缓存。普通用户不能发起 app token
请求，只有 `admin.allowedGroups` 命中的管理员可以调用。

## Provider request 请求格式

接口路径：

```text
POST /api/provider/:provider/request
Authorization: Bearer <oidc-access-token>
Content-Type: application/json
```

`<oidc-access-token>` 必须由 `providerApi.allowedClientIds` 中的客户端签发，并包含
`provider_api` scope。

请求体字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `tokenKind` | 是 | `user` 或 `app` |
| `operation` | 是 | 操作标识；必须命中服务端操作定义和 `allowedOperations` 白名单 |
| `pathParams` | 否 | 路径模板参数，只能填充服务端操作定义中的占位符；值必须是安全单路径段 |
| `ownerId` | 否 | 用户 token 默认取当前 OIDC 用户；跨用户和 app token 仅限管理员 |
| `query` | 否 | 查询参数；只允许服务端 operation 定义的参数名 |
| `headers` | 否 | 附加请求头；只允许服务端 operation 定义的请求头名 |
| `body` | 否 | JSON 请求体；仅 operation 显式允许时可提交 |

示例：

```json
{
  "tokenKind": "user",
  "operation": "authen.user_info"
}
```

安全限制：

- 实际 `method` 和 `path` 由服务端维护的 `operation` 定义生成，调用方不能自定义。
- 请求体必须是 JSON 对象；`operation` 必须是非空字符串，`tokenKind` 只能是 `user` 或
  `app`，非法结构会在进入 Provider client 前被拒绝。
- 旧 SDK 如果仍提交 `method` 或 `path`，必须与服务端定义完全匹配，否则会被拒绝。
- `pathParams` 和 `query` 值只能是字符串、数字或布尔值，不能提交对象或数组。
- `pathParams` 会被限制为单个 URL 路径段，只允许 ASCII 字母、数字、`.`、`_`、`~` 和
  `-`，且不能是 `.` 或 `..`；`/`、`\`、`%`、`?`、`#` 等可能造成路径混淆的字符会被拒绝。
- `query`、`headers` 和 `body` 默认不允许；只有对应 operation 明确声明后才会转发。
- `Authorization` 头由服务端使用已保存的 Provider token 覆盖；调用方即使在 operation
  中配置了允许请求头，也不能提交 `Authorization`、`Cookie`、`Host`、`Forwarded`、
  `X-Forwarded-*`、`X-Real-IP`、方法覆盖或反向代理重写类请求头。
- 每个 operation 会声明允许的 token 类型；未声明时默认只允许 `user` token。`contact.user.get`
  这类租户通讯录接口只允许 `app` token，并且只有管理员能发起。
- Provider API 代理错误响应会脱敏 token-like 文本，不会把第三方 `access_token`、
  `refresh_token`、`Authorization: Bearer ...` 或 `client_secret` 原样返回给调用方。
- Provider API 响应只会回传安全响应头，例如 `content-type` 和 `content-language`；下游
  `set-cookie`、`location`、`x-request-id` 等 Provider 原始响应头不会放进 SDK 响应体。
- 普通用户只能调用自己的用户 token。
- app token 和跨用户 token 调用必须是管理员。

当前 Feishu 内置操作：

| `operation` | token 类型 | 方法 | 路径模板 | 允许参数 |
| --- | --- | --- | --- | --- |
| `authen.user_info` | `user` | `GET` | `/authen/v1/user_info` | 无 |
| `contact.user.get` | `app` | `GET` | `/contact/v3/users/{user_id}` | `pathParams.user_id`；`query.user_id_type`；`query.department_id_type` |

## curl 调试

`<oidc-access-token>` 来自业务系统完成本服务 OIDC 登录后的 access token，授权请求的
`scope` 需要包含 `provider_api`。

```bash
curl -X POST "https://id.example.com/api/provider/feishu/request" \
  -H "Authorization: Bearer <oidc-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenKind": "user",
    "operation": "authen.user_info"
  }'
```

响应格式：

```json
{
  "status": 200,
  "headers": {
    "content-type": "application/json"
  },
  "data": {}
}
```

## TypeScript client 接入

安装并从子路径导入：

```bash
pnpm add gitea-oidc
```

```typescript
import { GiteaOidcClient } from "gitea-oidc/client";

const client = new GiteaOidcClient({
  baseUrl: "https://id.example.com",
  accessToken: "<oidc-access-token>",
});

const result = await client.providerRequest("feishu", {
  tokenKind: "user",
  operation: "authen.user_info",
});

console.log(result.data);
```

当 access token 更新时：

```typescript
client.setAccessToken("<new-oidc-access-token>");
```

## Express 接入

Express 中间件通过 OIDC `userinfo` 端点校验 bearer token，并把用户信息放到 `req.user`。

```typescript
import express from "express";
import { createGiteaOidcExpressMiddleware } from "gitea-oidc/express";

const app = express();

app.use(
  createGiteaOidcExpressMiddleware({
    userInfoEndpoint: "https://id.example.com/oidc/me",
  }),
);

app.get("/api/me", (req, res) => {
  res.json({ user: req.user });
});
```

如果需要在 Express 服务里继续调用 Provider API，可以结合 `gitea-oidc/client` 使用请求中的
bearer token。

## Nest 接入

Nest Guard 工厂不依赖 `@nestjs/*` 运行时类型，可以在 Nest 项目中包装为 provider。

```typescript
import { CanActivate, Injectable } from "@nestjs/common";
import { createGiteaOidcNestGuard, getGiteaOidcUser } from "gitea-oidc/nest";

const BaseGuard = createGiteaOidcNestGuard({
  userInfoEndpoint: "https://id.example.com/oidc/me",
});

@Injectable()
export class GiteaOidcGuard extends BaseGuard implements CanActivate {}

export { getGiteaOidcUser };
```

在控制器中使用：

```typescript
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { GiteaOidcGuard, getGiteaOidcUser } from "./gitea-oidc.guard";

@Controller("me")
export class MeController {
  @Get()
  @UseGuards(GiteaOidcGuard)
  me(@Req() request: any) {
    return getGiteaOidcUser(request);
  }
}
```

## Vue 接入

`gitea-oidc/vue` 提供登录按钮、用户菜单和 Provider request composable。

```vue
<script setup lang="ts">
import {
  GiteaOidcLoginButton,
  GiteaOidcUserMenu,
  useProviderRequest,
} from "gitea-oidc/vue";

const oidcBaseUrl = "https://id.example.com";
const accessToken = "<oidc-access-token>";
const currentUser = { name: "Alice" };

const { loading, error, request } = useProviderRequest({
  baseUrl: oidcBaseUrl,
  accessToken,
});

const loadFeishuUser = async () => {
  return request("feishu", {
    tokenKind: "user",
    operation: "authen.user_info",
  });
};
</script>

<template>
  <GiteaOidcLoginButton
    href="https://id.example.com/oidc/auth"
    label="使用 Gitea OIDC 登录"
  />
  <GiteaOidcUserMenu :user="currentUser" logout-href="/logout" />
  <button :disabled="loading" @click="loadFeishuUser">读取飞书用户信息</button>
  <p v-if="error">{{ error }}</p>
</template>
```

实际业务中，前端通常从自身 BFF 或 OAuth 客户端状态中获取 OIDC access token；不要把第三方
Provider refresh token 下发给浏览器。

如果这个 Vue 应用与 gitea-oidc 不同源部署，服务端需要配置：

```json
{
  "server": {
    "corsOrigins": ["https://app.example.com"]
  }
}
```

## Token 刷新与探活

- 懒刷新：API 调用前检查 token 是否即将过期，命中 `refreshSkewSeconds` 时自动刷新。
- 定时巡检：后台按 `probeIntervalSeconds` 探测即将过期或异常 token。
- 巡检批次：内置 memory、SQLite 和 PostgreSQL 仓储只查询本轮需要探活的一批候选，
  不会在每个巡检周期解密扫描整张 token 表。
- 调用 gate：Provider API 请求发往第三方前只会使用 `status: "valid"` 的 token。
  `revoked`、`refresh_failed`、`unknown` 或无法刷新到 `valid` 的 token 不会继续代理调用。
- 撤销语义：`revoked` 表示本地撤销终态，定时巡检和后台手动探活都不会把它重新标记为
  `valid`；需要用户重新授权、删除旧 token 记录或管理员显式处理 app token 配置。
- 手动探活：管理员可在后台 Token 页面触发；对应接口 `/admin/api/tokens/probe`
  只接受后台 session cookie。
- 错误摘要：探活或刷新失败只记录错误摘要，不记录 access token、refresh token 或密钥。

## DingTalk 状态

第一版只保留钉钉统一接口、配置入口、类型和测试骨架，不实现钉钉登录和真实 token 交换。
启用后调用会返回 `DingTalk Provider API is not implemented yet`。

## 常见问题

### `/admin/login` 跳转到错误地址？

检查 `oidc.issuer` 是否等于 `${server.url}/oidc`。默认应类似：

```json
{
  "server": {
    "url": "https://id.example.com"
  },
  "oidc": {
    "issuer": "https://id.example.com/oidc"
  }
}
```

### 调用 Provider API 返回 `Unauthorized`？

确认请求头是本服务签发的 OIDC access token：

```text
Authorization: Bearer <oidc-access-token>
```

同时确认该 token 对应的 OIDC client 仍在 `clients[]` 中，且原始授权 grant 仍有效。

### 调用 Provider API 返回 `Forbidden`？

检查两类授权边界：

- access token 的 `client_id` 必须在 `providerApi.allowedClientIds` 中。
- access token 的 `scope` 必须包含 `provider_api`。

### 调用 Provider API 返回 `Provider token not found`？

用户需要先通过对应 Provider 登录一次。以飞书为例，用户完成飞书 OAuth 登录后才会保存用户
token。

### 调用 app token 或跨用户请求返回权限错误？

当前用户必须在 `admin.allowedGroups` 配置的组内，默认是 `gitea-oidc-admins`。

### 调用返回 `operation is not allowed`？

请求体的 `operation` 未命中服务端操作定义或
`providerApi.providers.<provider>.allowedOperations`。补充白名单，或使用已允许的操作标识。
