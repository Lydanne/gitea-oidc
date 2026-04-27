# 管理后台与 Provider API 接入指南

本文面向部署者和业务系统接入方，说明如何启用内置管理后台、保存 Provider token，
以及通过 SDK 代理调用飞书、钉钉等平台 API。

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
- `server.url` 是服务对外根地址，例如 `https://id.example.com`。
- `oidc.issuer` 是 OIDC 挂载地址，默认应为 `${server.url}/oidc`。
- 生产环境必须配置强 `oidc.cookieKeys`、持久化 JWKS 和非默认
  `providerApi.tokenEncryptionKey`。

本地默认发现文档地址：

```bash
curl http://localhost:3000/oidc/.well-known/openid-configuration
```

## 启用管理后台

后台默认挂载在 `/admin`，管理员默认通过用户组 `Owners` 判断。使用本地认证时，
`local.config.adminUsers` 中的用户会自动获得 `Owners` 组。

```json
{
  "server": {
    "url": "http://localhost:3000"
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
    "allowedGroups": ["Owners"],
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

管理台页面支持直接访问和刷新：

- `/admin/login`：后台登录页
- `/admin/users`：账号管理
- `/admin/providers`：Provider 状态
- `/admin/tokens`：Token 状态

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

用户创建和编辑支持 `username`、`name`、`email`、`authProvider`、`externalId`、`groups`、
`roles`、`status`、`picture`、`phone`。`status` 可用值为 `active`、`disabled`、`locked`
和 `pending`。管理员权限仍以 `groups` 包含 `Owners` 判定。

## 启用 Provider API

Provider API 默认使用和 `auth.userRepository.type` 相同的存储后端，支持 `memory`、`sqlite`
和 `pgsql`。生产环境不要使用 `memory`。

```json
{
  "providerApi": {
    "enabled": true,
    "tokenEncryptionKey": "replace-with-a-long-random-secret",
    "refreshSkewSeconds": 300,
    "probeIntervalSeconds": 300,
    "sdkProxy": true,
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

`tokenEncryptionKey` 至少 16 个字符。建议使用 32 字符以上随机值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Feishu token 入库流程

Feishu Provider API 依赖飞书 OAuth 登录回调保存用户 token。完整流程如下：

1. 在飞书开放平台配置应用，并按 [飞书认证插件使用指南](./FEISHU_PLUGIN_GUIDE.md)
   配置 `auth.providers.feishu`。
2. 启用 `providerApi.providers.feishu.enabled`。
3. 用户通过飞书登录一次。
4. OAuth callback 成功后，本服务保存该用户的 `accessToken`、`refreshToken` 和过期时间。
5. 业务系统持本服务签发的 OIDC access token 调用 Provider API。

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
          "autoCreateUser": true
        }
      }
    }
  },
  "providerApi": {
    "enabled": true,
    "tokenEncryptionKey": "replace-with-a-long-random-secret",
    "refreshSkewSeconds": 300,
    "probeIntervalSeconds": 300,
    "sdkProxy": true,
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

请求体字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `method` | 是 | `GET`、`POST`、`PUT`、`PATCH`、`DELETE` |
| `path` | 是 | Provider `baseUrl` 下的相对路径，禁止绝对 URL |
| `tokenKind` | 是 | `user` 或 `app` |
| `operation` | 否 | 操作标识；配置 `allowedOperations` 后必须命中白名单 |
| `ownerId` | 否 | 用户 token 默认取当前 OIDC 用户；跨用户和 app token 仅限管理员 |
| `query` | 否 | 查询参数 |
| `headers` | 否 | 附加请求头，`Authorization` 会被服务端覆盖 |
| `body` | 否 | JSON 请求体 |

示例：

```json
{
  "method": "GET",
  "path": "/authen/v1/user_info",
  "tokenKind": "user",
  "operation": "authen.user_info"
}
```

安全限制：

- `path` 只能是相对路径，且不能通过 `..` 逃出 provider `baseUrl`。
- `Authorization` 头由服务端使用已保存的 Provider token 覆盖。
- 普通用户只能调用自己的用户 token。
- app token 和跨用户 token 调用必须是管理员。

## curl 调试

`<oidc-access-token>` 来自业务系统完成本服务 OIDC 登录后的 access token。

```bash
curl -X POST "https://id.example.com/api/provider/feishu/request" \
  -H "Authorization: Bearer <oidc-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/authen/v1/user_info",
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
  method: "GET",
  path: "/authen/v1/user_info",
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
    method: "GET",
    path: "/authen/v1/user_info",
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

## Token 刷新与探活

- 懒刷新：API 调用前检查 token 是否即将过期，命中 `refreshSkewSeconds` 时自动刷新。
- 定时巡检：后台按 `probeIntervalSeconds` 探测即将过期或异常 token。
- 手动探活：管理员可在后台 Token 页面触发，也可调用 `/admin/api/tokens/probe`。
- 错误摘要：探活或刷新失败只记录错误摘要，不记录 access token、refresh token 或密钥。

## DingTalk 状态

第一版只保留钉钉统一接口、配置入口、类型和测试骨架，不实现钉钉登录和真实 token 交换。
启用后调用会返回 `DingTalk Provider API is not implemented yet`。

## 常见问题

### `/admin/login` 跳转到错误地址？

检查 `oidc.issuer` 是否包含 `/oidc`。默认应类似：

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

### 调用 Provider API 返回 `Provider token not found`？

用户需要先通过对应 Provider 登录一次。以飞书为例，用户完成飞书 OAuth 登录后才会保存用户
token。

### 调用 app token 或跨用户请求返回权限错误？

当前用户必须在 `admin.allowedGroups` 配置的组内，默认是 `Owners`。

### 调用返回 `operation is not allowed`？

请求体的 `operation` 未命中 `providerApi.providers.<provider>.allowedOperations`。补充白名单
或使用已允许的操作标识。
