# Gitea 接入指南

本文说明如何把 Gitea 接入 gitea-oidc，并完成登录、退出和用户组映射验收。生产环境推荐通过
内置管理后台的 Gitea 模板创建应用；不启用应用管理时，可以使用静态 `clients` 配置。

## URL 对照表

假设：

- gitea-oidc 地址：`https://id.example.com`
- Gitea 地址：`https://git.example.com`
- Gitea 认证源名称：`company-sso`

对应 URL 为：

| 用途 | URL |
| --- | --- |
| Issuer | `https://id.example.com/oidc` |
| 自动发现 URL | `https://id.example.com/oidc/.well-known/openid-configuration` |
| Gitea Callback URL | `https://git.example.com/user/oauth2/company-sso/callback` |
| Post Logout Redirect URI | `https://git.example.com/` |

Callback URL 中的 `company-sso` 必须与 Gitea 认证源名称一致。Post Logout Redirect URI 使用精确
匹配，协议、域名、端口、路径和末尾 `/` 都不能不同。

## 方式一：使用 Gitea 模板

该方式要求启用应用管理：

```json
{
  "applications": {
    "enabled": true,
    "clientSource": "database",
    "repository": {
      "type": "sqlite",
      "sqlite": { "dbPath": "/app/data/applications.db" }
    },
    "secretEncryption": {
      "keyId": "applications-v1",
      "masterKey": "replace-with-base64-encoded-32-byte-key"
    }
  }
}
```

完整部署约束见[生产部署指南](./PRODUCTION_SETUP.md)和
[应用管理接入指南](./APPLICATION_MANAGEMENT.md)。

### 创建应用

1. 登录 `https://id.example.com/admin`。
2. 打开“应用管理”，选择 Gitea 模板。
3. 填写 Gitea Base URL，例如 `https://git.example.com`。
4. 填写认证源名称，例如 `company-sso`。
5. 选择目标 Gitea 版本和环境。
6. 按需填写 Claim、管理员/受限组和组织团队映射，并确认用户同步、认证源启用状态。
7. 预览模板派生的 Callback URL、退出回跳地址、scopes、Gitea 字段和 CLI 命令。
8. 创建应用，并立即把一次性显示的 Client ID 与 Client Secret 保存到 Secret Manager。

新建应用默认使用 `gitea@2`，并可选择 Gitea `1.24`、`1.25` 或 `1.26`。模板会生成授权码流程、
`client_secret_basic`、精确 Callback URL 和 Post Logout Redirect URI。Gitea 1.24 不支持全名与
SSH 公钥 Claim，模板会在预览时拒绝；1.25 和 1.26 支持。上线前仍应使用真实目标版本完成一次端到端
验收。

Client Secret 明文只在创建或轮换响应中显示一次。页面关闭后不能再次读取，只能重新轮换。

## 方式二：使用静态 Client

未启用应用管理时，在 `clients` 中添加 Gitea Client：

```json
{
  "clients": [
    {
      "client_id": "gitea-production",
      "client_secret": "replace-with-an-independent-random-client-secret",
      "redirect_uris": [
        "https://git.example.com/user/oauth2/company-sso/callback"
      ],
      "post_logout_redirect_uris": [
        "https://git.example.com/"
      ],
      "response_types": ["code"],
      "grant_types": ["authorization_code", "refresh_token"],
      "token_endpoint_auth_method": "client_secret_basic"
    }
  ]
}
```

如果同时启用管理后台，静态 `clients` 中还必须有一个 Client 的 `redirect_uris` 包含
`https://id.example.com/admin/callback`。后台 Client 和 Gitea Client 建议分开配置、使用不同
Client Secret，避免一处凭据泄露扩大影响范围。

修改静态 Client 后需要重启服务。修改前先确认 Gitea 与 IdP 两侧可以在同一维护窗口内同步更新。

## 在 Gitea 管理后台配置

进入 Gitea 站点管理的认证源页面，新增 OAuth2 认证源并填写：

| Gitea 字段 | 值 |
| --- | --- |
| 认证类型 | OAuth2 |
| OAuth2 提供程序 | OpenID Connect |
| 认证名称 | `company-sso` |
| 客户端 ID | 管理后台生成的 Client ID |
| 客户端密钥 | 管理后台一次性显示的 Client Secret |
| 图标 URL | 按需填写 HTTPS URL |
| OpenID 连接自动发现 URL | `https://id.example.com/oidc/.well-known/openid-configuration` |
| 跳过本地两步验证 | 仅当上游已经强制执行 MFA 时勾选 |
| 附加授权范围（Scopes） | 使用模板生成的逗号列表，例如 `openid,profile,email` |
| 全名声明名称 | Gitea 1.25+ 按需填写，例如 `name` |
| SSH 公钥声明名称 | Gitea 1.25+ 按需填写 |
| 必须填写 Claim 声明的名称/值 | 按需成对填写 |
| 用户组 Claim 声明名称 | 组映射时填写，例如 `groups` |
| 管理员用户组 Claim 值 | 按需填写 `groups` 中的完整路径 |
| 受限用户组 Claim 值 | 按需填写 `groups` 中的完整路径 |
| 组到组织团队映射 | 按需填写模板验证后的 JSON |
| 从已同步团队移除用户 | 确认映射后按需勾选 |
| 启用用户同步 | 按部署策略确认 |
| 该认证源已经启用 | 上线时勾选 |

Gitea 页面展示的 Callback URL 必须与 gitea-oidc 应用记录中的 `redirect_uris` 完全一致。不要猜测
回调路径；如果认证源名称变化，应同时更新应用的 Redirect URI。

## 使用 Gitea CLI 配置

在可信的 Gitea 运行环境中临时设置凭据：

```bash
read -r GITEA_OIDC_CLIENT_ID
read -r -s GITEA_OIDC_CLIENT_SECRET
export GITEA_OIDC_CLIENT_ID GITEA_OIDC_CLIENT_SECRET

gitea admin auth add-oauth \
  --name 'company-sso' \
  --provider openidConnect \
  --key "$GITEA_OIDC_CLIENT_ID" \
  --secret "$GITEA_OIDC_CLIENT_SECRET" \
  --auto-discover-url 'https://id.example.com/oidc/.well-known/openid-configuration' \
  --scopes 'openid,profile,email' \
  --group-claim-name 'groups'

unset GITEA_OIDC_CLIENT_ID GITEA_OIDC_CLIENT_SECRET
```

模板会根据目标版本和已填写字段追加 Claim、组映射等参数。不使用组映射时删除
`--group-claim-name`。不要把真实 Client Secret 写进脚本、Shell 历史、日志、工单或文档。

`gitea admin auth add-oauth` 没有“启用用户同步”参数，并且总是创建启用状态的认证源。执行模板命令后
必须进入 Gitea 管理后台确认用户同步状态；如果模板中取消“该认证源已经启用”，模板不会提供 CLI
命令，应直接通过后台创建未启用的认证源。

## Claims 和用户组映射

OIDC 配置中的 scope 必须能返回 Gitea 使用的 claim。常用配置：

```json
{
  "oidc": {
    "claims": {
      "openid": ["sub"],
      "profile": [
        "name",
        "preferred_username",
        "email",
        "picture",
        "groups",
        "groups_tree",
        "roles",
        "status"
      ],
      "email": ["email", "email_verified"]
    }
  }
}
```

如果 Gitea 的 Group Claim Name 是 `groups`，授权请求必须包含承载该字段的 scope。上例中
`profile` 会返回 `groups`。该 Claim 包含从树根到每个节点的完整名称路径和 ID 路径，例如
`示例组织/研发中心/后端组` 和 `tenant_example/od_engineering/od_backend`。飞书用户还包含固定的
`Default` 分组；旧版自动添加的 `Owners` 已不再使用。`groups_tree` 保留完整层级，供理解树形分组
的自定义客户端使用。`sub` 是稳定用户标识，不应改成邮箱、昵称等可变字段。

Gitea 的组映射值应填写 `groups` 中实际返回的完整路径。管理后台的 `admin.allowedGroups` 仍兼容
任一节点的单独 ID 或名称，但建议新配置使用完整 ID 路径，避免不同组织或分支下的同名团队冲突。

## 上线验收

按以下顺序完成验收：

1. 打开发现文档，确认 `issuer`、授权端点、Token 端点和退出端点均为正确 HTTPS 地址。
2. 从 Gitea 登录页发起 OIDC 登录，确认能到达统一登录页。
3. 使用测试账号登录，确认回到 Gitea，账号标识、邮箱和用户组符合预期。
4. 在 Gitea 退出登录，确认出现退出确认页并最终回到 `https://git.example.com/`。
5. 再次访问受保护页面，确认需要重新登录。
6. 如果使用组映射，分别使用有权限和无权限账号验证授权结果。

验收时记录使用的 Gitea 版本、认证源名称、Callback URL、Post Logout Redirect URI 和 scopes，
不要记录 Client Secret 或 Token。

## Client Secret 轮换

使用应用管理时：

1. 在管理后台轮换 Client Secret，并立即保存新 Secret。
2. 在维护窗口内更新 Gitea 认证源。
3. 完成一次登录和退出验证。
4. 确认旧 Secret 不再使用。

静态模式需要同时修改 gitea-oidc 配置和 Gitea 认证源。不要提前删除仍在使用的凭据，也不要让
新旧配置长时间不一致。

## 常见问题

### `post_logout_redirect_uri not registered`

典型错误：

```text
error: invalid_request
error_description: post_logout_redirect_uri not registered
```

这表示 Gitea 发出的 `post_logout_redirect_uri` 没有在对应 Client 的
`post_logout_redirect_uris` 中精确注册。按以下顺序检查：

1. 从错误请求中读取实际 `client_id` 和 `post_logout_redirect_uri`。
2. 确认修改的是该 `client_id` 对应的应用，而不是后台 Client 或另一个环境的 Client。
3. 对比协议、域名、端口、路径和末尾 `/`；`https://git.example.com` 与
   `https://git.example.com/` 不是同一个注册值。
4. 应用管理模式在后台修改应用；静态模式修改 `clients[].post_logout_redirect_uris` 并重启服务。
5. 重新执行完整退出流程，不要只刷新旧错误页面。

生产 Gitea 根地址的常见注册值为：

```json
{
  "post_logout_redirect_uris": ["https://git.example.com/"]
}
```

不要为了消除错误注册通配符或不受控域名；服务端按精确 URI 校验退出回跳。

### `redirect_uri` 不匹配

确认 Gitea 认证源名称和 Callback URL 中的路径段一致。例如认证源名为 `company-sso` 时，回调
通常是：

```text
https://git.example.com/user/oauth2/company-sso/callback
```

### 登录后无法访问管理后台

Gitea Client 只负责 Gitea 登录。内置后台需要独立的后台 Client 和管理员组：

- 后台 Client 的 Redirect URI 包含 `https://id.example.com/admin/callback`。
- 用户的 `groups` 至少命中一个 `admin.allowedGroups`。

### 发现文档中的端点是 HTTP

检查 `server.url`、`oidc.issuer`、`trustProxy`、`trustedProxyIps` 和反向代理转发头。详见
[反向代理 HTTPS 配置指南](./REVERSE_PROXY_HTTPS.md)。

### 修改应用后仍使用旧配置

确认当前部署的 `applications.clientSource`：

- `database`：以管理后台和 `applications.db` 为事实源。
- `config`：以配置文件中的 `clients` 为事实源，修改后需要重启。

不要同时维护两份业务 Client 配置。

## 相关文档

- [生产部署指南](./PRODUCTION_SETUP.md)
- [生产运维手册](./OPERATIONS.md)
- [应用管理接入指南](./APPLICATION_MANAGEMENT.md)
- [管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)
