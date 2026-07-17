# 用户门户部署与使用指南

内置用户门户为已经通过身份中心认证的用户提供应用目录。用户可以从门户查看可用系统、进入应用、
查看当前账号摘要、退出登录；命中管理员分组时还可以进入管理后台。

门户本身是一个 confidential OIDC Client，并使用独立的 BFF Session。浏览器不会获得门户登录时的
Access Token 或 Refresh Token；Session ID 只存在于 `HttpOnly` Cookie，前端 JavaScript 无法读取。

## 当前功能边界

当前门户提供以下能力：

- 访问服务根路径 `/` 时进入门户；门户未启用时继续进入原项目介绍页。
- 未登录用户通过现有认证 Provider 完成 OIDC 登录。
- 展示已发布的应用名称、说明、图标和入口 URL。
- 管理员在右上角看到管理后台入口；该入口仍由 `admin.allowedGroups` 独立鉴权。
- 退出门户 BFF Session 后继续进入 OIDC end-session，最终回到固定的退出完成页。
- 启用审计时，登录和退出分别写入 `user.login`、`user.logout`，`source` 为 `portal`。

当前所有已登录用户看到同一个已发布应用目录，不支持按用户、组织或团队配置应用可见性。门户卡片
只是经过服务端校验的导航入口；目标应用仍需自行发起 OIDC 登录并维护自己的会话。

当前不提供 Client API 代理，也不获取或保存 Gitea 等 Client 应用的用户 Token。已有 API 代理仅适用
于认证 Provider，继续由 `providerApi` 配置和权限边界管理。门户配置不会为 Client 增加 Provider API
权限。

## 配置门户 OIDC Client

配置 Schema 默认关闭门户；仓库的本地 `example.x-oidc.config.json` 已显式启用，便于直接验证。
生产启用时，`portal.clientId` 必须指向 `clients[]` 中的 confidential Client。推荐为门户单独创建
Client Secret，不与后台、Gitea 或其他业务 Client 共用。

下面是需要合并进完整 `x-oidc.config.js` 的门户配置：

```javascript
const serverUrl = "https://id.example.com";
const portalClientSecret = process.env.X_OIDC_PORTAL_CLIENT_SECRET;

if (!portalClientSecret) {
  throw new Error("缺少 X_OIDC_PORTAL_CLIENT_SECRET");
}

export default {
  server: {
    url: serverUrl,
    // host、port、trustProxy 等字段保持完整生产配置
  },
  oidc: {
    issuer: `${serverUrl}/oidc`,
    // cookieKeys、ttl、claims 和 features 保持完整生产配置
  },
  portal: {
    enabled: true,
    basePath: "/portal",
    clientId: "x-oidc-portal",
    sessionTtlSeconds: 3600,
  },
  clients: [
    {
      client_id: "x-oidc-portal",
      client_secret: portalClientSecret,
      redirect_uris: [`${serverUrl}/portal/callback`],
      post_logout_redirect_uris: [`${serverUrl}/portal/signed-out`],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_basic",
    },
    // 继续保留 Gitea、管理后台和其他业务 Client
  ],
};
```

门户 Client 必须同时满足：

- `client_id` 与 `portal.clientId` 完全相同。
- `redirect_uris` 精确包含 `${server.url}${portal.basePath}/callback`。
- `post_logout_redirect_uris` 精确包含
  `${server.url}${portal.basePath}/signed-out`。
- `response_types` 包含 `code`。
- `grant_types` 包含 `authorization_code`。
- `token_endpoint_auth_method` 为 `client_secret_basic`。

回调和退出地址执行字符串精确匹配。协议、域名、端口、路径和末尾 `/` 不一致都会导致启动校验或
退出回跳失败。生产环境必须使用 HTTPS，并通过 Secret Manager 或环境变量提供强 Client Secret。

### `portal` 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `portal.enabled` | `false` | 是否启用内置用户门户 |
| `portal.basePath` | `/portal` | 门户挂载路径，最长 128 个字符，必须是非根绝对路径 |
| `portal.clientId` | 空字符串 | 门户内部 confidential Client ID，启用时必填，最长 255 个字符 |
| `portal.sessionTtlSeconds` | `3600` | 门户 BFF Session 有效期，最大 `2592000` 秒 |

`portal.basePath` 不能占用 `/oidc`、`/auth`、`/interaction` 或 `/api`，也不能与已启用的
`admin.basePath` 相同、互为父路径或子路径。每个路径段只允许字母、数字、`_` 和 `-`。

门户 Session Cookie 与管理后台 Cookie 相互独立，均为 `HttpOnly` 和 `SameSite=Lax`；HTTPS
部署会同时启用 `Secure`。Session 使用固定 TTL，访问不会自动续期。使用
`auth.stateStore.type=redis` 时，门户 Session、一次性登录 state 和登录限流计数可由多个服务实例
共享。使用 memory stateStore 时，这些数据只存在于当前进程。

应用管理数据库模式仍受 SQLite 单实例限制；不能因为门户 Session 使用 Redis 就把
ApplicationRepository 扩展为多实例。相关约束见[应用管理接入指南](./APPLICATION_MANAGEMENT.md)。

## 部署产物与路由

生产镜像和 npm 包已经包含用户门户静态资源，不需要单独部署前端。源码部署使用
`pnpm build:prod`，构建过程会把门户产物装配到服务包中。

门户全部挂在 `portal.basePath` 下：

| 路由 | 访问要求 | 用途 |
| --- | --- | --- |
| `GET /portal` | 公开 | 加载门户页面；页面随后检查 BFF Session |
| `GET /portal/login/start` | 公开 | 创建一次性 state 和 PKCE，并进入 OIDC 授权流程 |
| `GET /portal/callback` | 公开回调 | 校验授权结果并建立门户 Session |
| `GET /portal/api/me` | 门户 Session | 返回当前账号摘要和管理员入口状态 |
| `GET /portal/api/applications` | 门户 Session | 返回已发布应用的最小公开投影 |
| `POST /portal/logout` | 门户 Session、同源 JSON 请求 | 删除门户 Session 并返回固定退出地址 |
| `GET /portal/signed-out` | 公开 | 显示门户退出完成页 |

表中的 `/portal` 只是默认路径；自定义 `portal.basePath` 后，所有路径都使用新的前缀。门户 API 是
内置页面的同源 BFF 接口，不是提供给业务 Client 的跨应用代理 API。

`GET ${portal.basePath}/api/me` 返回 `{ user, admin, basePath, adminBasePath }`。`user` 只包含当前
页面需要的账号摘要，例如 `sub`、可选的用户名、姓名、邮箱、头像、分组、角色和状态。
`GET ${portal.basePath}/api/applications` 返回数组，每项只包含 `id`、`name`、可选说明与图标、
`launchUrl` 和 `order`，不包含 Client Secret、Redirect URI 或管理状态。

手工调用退出接口时必须同时满足：

```http
POST /portal/logout HTTP/1.1
Content-Type: application/json
X-Gitea-OIDC-Portal-Action: logout
Origin: https://id.example.com

{}
```

成功响应为 `{ "ok": true, "redirectTo": "..." }`，调用方还必须继续导航到服务端返回的
`redirectTo` 才会结束身份中心 Session。Bearer Token 不能替代门户 Cookie；`returnTo` 只接受门户
内部且非保留的路径，外部地址会回退到门户首页。

常见状态码：

| 场景 | 状态码 |
| --- | --- |
| 登录启动或 callback 成功 | `302` |
| 登录启动超过限流 | `429` |
| state 无效、重放、浏览器绑定失败或授权未完成 | `400` |
| Token/Grant 绑定无效或用户状态不可登录 | `403` |
| Token 交换失败 | `502` |
| 门户 API 没有有效 Session | `401` |
| 应用目录读取或安全投影失败 | `500` |
| 退出成功 | `200` |
| 有 Session 但退出请求不满足同源、JSON 或动作 Header 要求 | `403` |

## 发布静态 Client 到门户

当 `applications.clientSource` 为 `config` 时，在需要展示的业务 Client 上增加
`clients[].portal`：

```javascript
export default {
  clients: [
    {
      client_id: "gitea",
      client_secret: process.env.GITEA_CLIENT_SECRET,
      redirect_uris: ["https://git.example.com/user/oauth2/gitea/callback"],
      post_logout_redirect_uris: ["https://git.example.com/"],
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "client_secret_basic",
      portal: {
        enabled: true,
        name: "Gitea",
        description: "代码托管与协作",
        launch_url: "https://git.example.com/",
        icon_url: "https://git.example.com/assets/img/logo.svg",
        order: 10,
      },
    },
  ],
};
```

`clients[].portal` 字段含义：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `enabled` | 否 | 默认 `true`；设为 `false` 时不在门户展示 |
| `name` | 否 | 门户名称；省略时使用 `client_id` |
| `description` | 否 | 应用说明 |
| `launch_url` | 是 | 用户点击卡片后进入的 HTTP(S) 地址 |
| `icon_url` | 否 | 应用图标的 HTTP(S) 地址 |
| `order` | 否 | 默认 `0`，数值越小越靠前 |

没有 `portal` 对象的 Client 不会显示。`launch_url` 和 `icon_url` 不能包含用户名、密码、fragment
或通配符；HTTP 只允许本地开发使用的 localhost 或 loopback 地址，生产环境必须使用 HTTPS。
`name` 最长 120 个字符，`description` 最长 2000 个字符，`order` 范围为 `0..1000000`。

门户先按 `order` 排序，再按名称和内部 ID 保持稳定顺序。建议让 `launch_url` 指向应用首页或应用
自己的登录入口，不要填写 OIDC callback 地址。

## 发布数据库 Application 到门户

当 `applications.clientSource` 为 `database` 时，门户从 ApplicationRepository 读取目录。只有
`status=active` 且 `Application.portal.enabled=true` 的应用会显示。

在管理后台创建模板应用或自定义应用时，可以启用“显示在用户门户”，并填写入口 URL、可选图标 URL
和排序值。应用名称与说明直接作为卡片名称与说明。下面只展示创建请求中的 `application` 字段
片段；完整请求还需要 `schemaVersion`、`client` 等字段，见
[应用管理接入指南](./APPLICATION_MANAGEMENT.md)：

```json
{
  "application": {
    "name": "内部工单",
    "description": "提交和处理内部工单",
    "environment": "production",
    "portal": {
      "enabled": true,
      "launchUrl": "https://tickets.example.com/",
      "iconUrl": "https://tickets.example.com/icon.png",
      "order": 20
    }
  }
}
```

生产和预发布 Application 的 `launchUrl`、`iconUrl` 必须使用 HTTPS；开发环境只对 loopback URL
放宽 HTTP。创建输入中 `enabled` 和 `order` 默认分别为 `true`、`0`。停用应用后，它会从门户目录
消失。

数据库模式仍会把 `clients[]` 导入为 system application。静态 Client 的 `portal.name`、
`portal.description`、`portal.launch_url`、`portal.icon_url` 和 `portal.order` 会同步到对应的 system
application；这类记录继续以部署配置为事实源，不能在管理后台手工启停。

## 用户访问流程

启用门户后，访问 `${server.url}/` 会重定向到 `portal.basePath`。内置页面随后读取当前门户会话和
应用目录；没有有效会话时，浏览器进入 `${portal.basePath}/login/start`，再通过配置的认证
Provider 完成 OIDC Authorization Code + PKCE 登录。

登录完成后：

1. 服务端校验一次性 state、浏览器绑定、Access Token、门户 Client 和 Grant。
2. 服务端只接受状态为 `active` 的用户；兼容缺失状态的旧记录，其余状态均拒绝登录。
3. 浏览器只读取脱敏用户摘要和应用目录，不会收到 OIDC Token。
4. 用户点击应用卡片后直接进入该应用的 `launchUrl`。

如果只有一个可跳转的认证 Provider，可以同时设置 `auth.autoRedirectSingleProvider=true`，减少一次
登录方式选择；该设置不会改变门户 Session 和 OIDC 校验边界。

启用审计时，一次完整流程可能同时出现 `source=oidc` 的授权事件和 `source=portal` 的 BFF 登录
事件。判断用户是否真正进入门户时应筛选 `source=portal`，不要只统计 Provider 凭据校验成功。

## 管理员入口

门户不会因为用户能够登录就授予管理权限。只有同时满足以下条件，右上角才显示“管理后台”：

- `admin.enabled=true`；
- 用户分组命中 `admin.allowedGroups`。

点击入口后仍要建立独立的管理后台 BFF Session，并再次经过后台权限校验。门户 Session 不能直接
调用管理 API，Bearer Token 也不能代替门户或管理后台 Cookie。

## 退出登录

内置页面使用同源 JSON `POST ${portal.basePath}/logout` 退出，并携带固定的门户动作 Header。服务端
先删除门户 BFF Session，再返回由服务端生成的 OIDC end-session URL；前端进入该地址后清理身份
中心会话，最终回到 `${portal.basePath}/signed-out`。

这一步只结束门户 BFF Session 和身份中心的 OIDC Session，不会远程删除 Gitea 或其他业务应用
已经建立的本地 Session，也不会撤销其他浏览器或设备上的门户 Session。共享设备或敏感系统仍应
在目标应用中单独退出；门户当前不提供 Client 前端/后端通道退出，也不会维护业务应用 Token。

退出回跳地址不接受浏览器传参，始终使用门户 Client 已注册的固定地址。这也是
`post_logout_redirect_uri not registered` 错误必须通过 Client 配置修复，而不能通过放宽任意回跳
地址解决的原因。

## 上线验收

上线前至少完成以下验证：

1. 匿名访问 `${server.url}${portal.basePath}/api/me` 返回 `401`。
2. 访问 `${server.url}/` 后进入门户，并通过预期的认证 Provider 登录。
3. 普通用户能看到已发布应用，但看不到管理后台入口。
4. 管理员能看到管理后台入口，并且后台仍会独立校验分组。
5. 点击每张应用卡片都进入预期的 HTTPS `launchUrl`。
6. 静态模式下设置 `clients[].portal.enabled=false` 并重启服务后，对应应用不再展示。
7. 数据库模式下停用 Application 后，对应应用不再展示。
8. 点击退出后进入 `${portal.basePath}/signed-out`，再次访问受保护 API 返回 `401`。
9. 启用审计时，日志包含 `source=portal` 的成功登录与退出事件，且不包含 Token 或 Client Secret。

## 故障排查

### 启动提示 `portal_client_required`

检查 `portal.clientId` 是否指向 `clients[]` 中真实存在的 Client，并核对 callback、退出回跳、
`response_types`、`grant_types` 和 `token_endpoint_auth_method`。即使使用数据库 Client 模式，门户
Client 仍要先存在于 `clients[]`，再作为 system Client 导入数据库。

### 退出提示 `post_logout_redirect_uri not registered`

确认 Client 的 `post_logout_redirect_uris` 精确包含
`${server.url}${portal.basePath}/signed-out`。不要填写 Gitea 首页或门户 callback，也不要遗漏部署前缀
或擅自增加末尾 `/`。

### 登录后应用目录为空

- 静态模式：检查业务 Client 是否存在 `portal` 对象，且 `portal.enabled` 没有设为 `false`；修改后
  需要重启或重新部署服务。
- 数据库模式：检查 Application 是否为 `active`，并且 `Application.portal.enabled` 为 `true`。
- 检查 `launchUrl`、`iconUrl` 是否满足当前环境的 HTTPS 或 loopback 规则。

### 多实例部署偶发重新登录

完整多实例部署必须同时使用 PostgreSQL 用户仓储、Redis OIDC Adapter、同一个 Redis
`auth.stateStore`、相同的 JWKS、Cookie Keys 和配置。只共享 stateStore 仍不足以保证授权码、Grant
和用户记录跨节点一致。memory stateStore 下门户 Session 和登录 state 不能跨实例读取。若同时启用
数据库应用管理，请先退回单实例，因为当前 ApplicationRepository 仍不支持多实例共享。

## 相关文档

- [Server 使用指南](./SERVER_USAGE.md)
- [应用管理接入指南](./APPLICATION_MANAGEMENT.md)
- [管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)
- [生产部署指南](./PRODUCTION_SETUP.md)
- [生产运维手册](./OPERATIONS.md)
