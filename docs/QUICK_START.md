# 快速开始指南

本指南用于本地开发验证：启动 gitea-oidc、使用本地密码登录，并把一个本地 Gitea 接入 OIDC。
生产上线不要直接复用本地配置，请改用[生产部署指南](./PRODUCTION_SETUP.md)。

## 前置条件

- Node.js `22.13+`
- pnpm `10+`
- 可选：运行在 `http://localhost:3001` 的本地 Gitea

## 1. 安装依赖

```bash
pnpm install
```

## 2. 创建本地配置

```bash
cp example.gitea-oidc.config.json gitea-oidc.config.json
```

项目也支持 `gitea-oidc.config.js`。如果两个文件同时存在，JS 配置优先。配置文件和运行时数据库
已经被 `.gitignore` 排除，不要提交真实密钥。

示例配置默认使用：

- 服务地址：`http://localhost:3000`
- Issuer：`http://localhost:3000/oidc`
- Gitea Client ID：`gitea`
- Gitea Callback URL：`http://localhost:3001/user/oauth2/gitea/callback`
- Gitea Post Logout Redirect URI：`http://localhost:3001/`
- 用户门户：`http://localhost:3000/portal`，并发布一个本地 Gitea 导航卡片
- 门户和管理后台分别使用独立的内部 Client
- 用户、state：memory
- OIDC 数据：SQLite `./oidc.db`

HTTP 和 memory 只适合本地开发，生产配置校验会拒绝它们。

## 3. 创建本地管理员

```bash
read -r -s ADMIN_PASSWORD
export ADMIN_PASSWORD
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10));" > .htpasswd
unset ADMIN_PASSWORD
chmod 0600 .htpasswd
```

用户名为 `admin`，密码是刚才交互输入的值。示例配置中的 `local.config.adminUsers` 会让该用户获得
`gitea-oidc-admins` 组，从而访问内置管理后台。

## 4. 启动服务

```bash
pnpm dev
```

启动成功后访问：

- 用户门户：`http://localhost:3000`，根路径会重定向到 `/portal`
- 管理后台：`http://localhost:3000/admin`
- 发现文档：`http://localhost:3000/oidc/.well-known/openid-configuration`

## 5. 验证 OIDC 端点

```bash
curl --fail --silent --show-error \
  http://localhost:3000/oidc/.well-known/openid-configuration | jq \
  '{issuer, authorization_endpoint, token_endpoint, end_session_endpoint, jwks_uri}'
```

`issuer` 应为 `http://localhost:3000/oidc`，其余端点也应使用相同主机和 `/oidc` 前缀。

## 6. 验证用户门户和管理后台

先打开 `http://localhost:3000`，使用 `admin` 账号登录。登录成功后应进入用户门户，并看到 Gitea
卡片；即使本地 Gitea 尚未启动，卡片也应正常显示。点击右上角“管理后台”，再次完成后台登录后，
应能进入用户、Provider、Token 和应用页面。

点击门户右上角“退出”后，应先进入 OIDC 退出流程，最终回到：

```text
http://localhost:3000/portal/signed-out
```

示例配置为门户和管理后台使用两个独立 Client。它们必须分别注册：

```text
门户 Redirect URI:              http://localhost:3000/portal/callback
门户 Post Logout Redirect URI:  http://localhost:3000/portal/signed-out
后台 Redirect URI:              http://localhost:3000/admin/callback
```

这些地址已经写入示例配置。生产环境同样应分离门户、后台和业务 Client，并为它们使用不同的
Client Secret。

## 7. 接入本地 Gitea

在 Gitea 站点管理中添加 OAuth2 认证源：

| 字段 | 本地值 |
| --- | --- |
| Provider | OpenID Connect |
| 认证源名称 | `gitea` |
| Client ID | `gitea` |
| Client Secret | 与示例配置 `clients[0].client_secret` 相同 |
| 自动发现 URL | `http://localhost:3000/oidc/.well-known/openid-configuration` |
| Scopes | `openid profile email` |

认证源名称使用 `gitea` 时，Gitea Callback URL 是：

```text
http://localhost:3001/user/oauth2/gitea/callback
```

退出回跳地址是：

```text
http://localhost:3001/
```

它们必须分别出现在 Client 的 `redirect_uris` 和 `post_logout_redirect_uris` 中。生产接入和 CLI
配置见[Gitea 接入指南](./GITEA_INTEGRATION.md)。

## 8. 完成登录与退出测试

1. 打开 Gitea 登录页。
2. 点击刚创建的 OIDC 登录入口。
3. 使用本地管理员完成登录。
4. 确认回到 Gitea，用户信息符合预期。
5. 从 Gitea 退出，确认返回 `http://localhost:3001/`。

如果退出时报 `post_logout_redirect_uri not registered`，检查 Gitea 实际发送的 URI 是否和
`clients[].post_logout_redirect_uris` 完全相同，尤其是末尾 `/`。

## 9. 常用开发检查

```bash
pnpm lint
pnpm test
pnpm build
```

## 常见问题

### 登录页没有本地登录表单

检查 `auth.providers.local.enabled` 是否为 `true`，以及 `.htpasswd` 路径是否相对于当前工作目录
正确解析。

### 本地密码认证失败

确认 `.htpasswd` 存在、用户名一致、哈希完整，并且 `passwordFormat` 为 `bcrypt`。

### 管理后台提示无权限

确认用户的 `groups` 包含 `gitea-oidc-admins`，或命中自定义的 `admin.allowedGroups`。

### 启动提示 `portal_client_required`

确认 `portal.clientId` 对应的 Client 已精确注册 `/portal/callback` 和
`/portal/signed-out`，并使用授权码流程与 `client_secret_basic`。完整要求见
[用户门户部署与使用指南](./USER_PORTAL.md)。

### 用户门户没有应用

示例中的 Gitea Client 应包含 `clients[].portal`。自定义配置下，没有 `portal` 对象或设置
`portal.enabled=false` 的 Client 不会显示；数据库应用管理模式还要求 Application 为 `active`。

### Gitea 返回 `redirect_uri` 错误

Callback URL 中的认证源名称必须与 Gitea 配置一致，并精确注册到 `redirect_uris`。

### 飞书登录失败

检查飞书应用的 App ID、App Secret、回调地址和权限范围。完整步骤见
[飞书认证插件使用指南](./FEISHU_PLUGIN_GUIDE.md)。

## 下一步

- 上线部署：[生产部署指南](./PRODUCTION_SETUP.md)
- 日常运维：[生产运维手册](./OPERATIONS.md)
- Gitea 生产接入：[Gitea 接入指南](./GITEA_INTEGRATION.md)
- 用户门户：[用户门户部署与使用指南](./USER_PORTAL.md)
- 配置存储：[OIDC 适配器配置指南](./ADAPTER_CONFIGURATION.md)
- 管理后台：[管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)
