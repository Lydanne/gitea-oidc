# 管理后台与 Provider API

本文面向部署者，说明内置管理后台、Provider token 存储和 SDK 代理的配置方式。

## 启用后台

后台默认挂载在 `/admin`，管理员默认通过用户组 `Owners` 判断。使用本地认证时，
示例配置里的 `local.config.adminUsers` 会让 `admin` 用户自动获得 `Owners` 组。

```json
{
  "admin": {
    "enabled": true,
    "basePath": "/admin",
    "allowedGroups": ["Owners"],
    "sessionTtlSeconds": 3600
  }
}
```

后台登录会复用本服务 OIDC 授权码流程。客户端配置需要允许后台回调地址：

```json
{
  "clients": [
    {
      "client_id": "gitea",
      "redirect_uris": [
        "http://localhost:3001/user/oauth2/gitea/callback",
        "http://localhost:3000/admin/callback"
      ]
    }
  ]
}
```

## Provider API

Provider API 通过 `/api/provider/:provider/request` 暴露给 SDK。浏览器和业务服务只提交
OIDC access token，本系统在服务端读取并刷新第三方 token，不会把 refresh token 下发给前端。

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
      }
    }
  }
}
```

`tokenEncryptionKey` 至少 16 个字符，生产环境必须替换示例值。当前 token 仓储复用
`auth.userRepository.type` 对应的后端：`memory`、`sqlite` 或 `pgsql`。

## SDK 快速接入

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
```

普通用户只能使用自己的用户 token。应用 token 和跨用户请求只允许 `Owners` 组管理员调用。

## 探活与刷新

- API 调用前会检查 token 是否即将过期，命中 `refreshSkewSeconds` 时自动刷新。
- 后台巡检按 `probeIntervalSeconds` 定时探测即将过期或异常 token。
- 探活失败只记录错误摘要，不记录 access token、refresh token 或应用密钥。

## 钉钉状态

第一版保留钉钉统一接口和配置入口，但不实现钉钉登录与真实 token 交换。启用后会返回
`DingTalk Provider API is not implemented yet`，用于后续按同一接口补齐。
