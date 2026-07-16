# `@x-oidc/application-templates`

X OIDC 内置应用模板包。它负责校验产品输入、派生 OIDC Client 配置，并生成结构化接入说明；
不访问网络、不读取数据库，也不接收或保存 Client Secret。

## 当前状态

该包目前是 monorepo 内部包，从 `2.0.0` 起与全部 workspace 包同步版本并保持 `private: true`。`gitea@1` 和 `gitea@2`
继续支持目标版本 `1.24`、`1.25` 和 `1.26`；`gitea@3` 专门支持 `1.27`。历史模板用于保持已有
快照稳定，新建应用默认选择 `gitea@3`。

## 模板输入

所有模板版本都接受以下基础字段：

- `giteaBaseUrl`：Gitea 对外 Base URL。生产和预发布环境必须使用 HTTPS；开发环境仅允许
  loopback HTTP。
- `authSourceName`：Gitea 认证源名称，同时用于 callback 路径，只允许安全的小写 slug。
- `targetVersion`：必须属于所选模板声明的 `supportedVersions`；`gitea@3` 固定为 `1.27`。
- `environment`：`development`、`staging` 或 `production`。
- `owner`：可选负责人。
- `groupClaimName`：可选 group claim 名称。该名称必须存在于当前 IdP 的 claim 配置中；模板会选择
  实际承载该 claim 的 scope，不会凭空添加一个未配置的 `groups` scope。

`GiteaTemplateInputV2Schema` 额外支持：

- `iconUrl` 和 `skipLocalTwoFactor`；
- `fullNameClaimName`、`sshPublicKeyClaimName` 和成对配置的 `requiredClaimName`、
  `requiredClaimValue`；
- `adminGroup`、`restrictedGroup`、`groupTeamMap` 和 `groupTeamMapRemoval`；
- `syncEnabled` 和 `active`。

`GiteaTemplateInputV3Schema` 继承上述字段，并增加可选的 `externalIdClaimName`。该字段留空时 Gitea
使用默认且稳定的 `sub`；已有认证源从 1.26 升级到 1.27 时应继续留空。当前模板只接受省略该字段或
显式填写 `sub`，不会把邮箱、状态、用户组等可变、非唯一或非字符串 Claim 用作账号关联键。

`groupTeamMap` 使用 JSON 字符串，结构为“组 Claim 值 -> 组织 -> 团队名称数组”。模板会验证并规范化
JSON。管理员组、受限组和团队映射必须同时配置 `groupClaimName`；启用团队成员自动移除时必须提供
映射。

模板会派生精确 callback：

```text
<giteaBaseUrl>/user/oauth2/<authSourceName>/callback
```

模板还会把带末尾 `/` 的 Gitea Base URL 登记为 Post Logout Redirect URI：

```text
<giteaBaseUrl>/
```

OIDC Provider 会精确匹配该地址，部署时必须确保 Gitea 对外 Base URL 与浏览器实际使用的协议、域名、
路径和末尾 `/` 一致。

## 使用方式

持久化引用必须包含模板版本。`getLatest()` 只适合创建向导选择当前版本，不能用于重新解析已有应用。

```typescript
import { applicationTemplateCatalog } from "@x-oidc/application-templates";

const result = applicationTemplateCatalog.resolve(
  { id: "gitea", version: 3 },
  {
    giteaBaseUrl: "https://gitea.example.com",
    authSourceName: "company-sso",
    targetVersion: "1.27",
    environment: "production",
  },
  { issuer: "https://id.example.com/oidc" },
);

console.log(result.resolution.client.redirectUris);
```

`preview()` 返回校验、规范化和派生结果，但不暴露 snapshot 字段。`resolve()` 额外返回经过
JSON-safe 校验并递归冻结的 snapshot，可作为创建应用时保存的模板快照。非法的
`undefined`、函数、非有限数字、类实例和循环引用会被明确拒绝，不会被静默删除或转换。

## Gitea 协议策略

模板固定生成以下协议配置：

- confidential Client 和 `client_secret_basic`。
- Authorization Code grant，不启用 refresh token。
- 默认使用 `openid profile email` scopes；配置 group claim 时复用或增加实际承载该 claim 的
  已配置 scope。
- 第三方应用和显式 consent，不允许模板自行提升信任级别。
- PKCE 为 `optional`。
- Post Logout Redirect URI 固定为 Gitea Base URL 的站点根地址。

Gitea 的公开 issue
[#34747](https://github.com/go-gitea/gitea/issues/34747)
仍记录其 OpenID Connect 授权请求未发送 `code_challenge`。在目标版本完成兼容性验证前，模板不得把
PKCE 改为 `required`。

`supportedVersions` 表示当前代码希望兼容的目标版本，不表示已经完成真实实例认证。自动测试覆盖
输入、回调、scope/claim 映射、快照和 CLI 参数合同；正式发布前仍需分别使用目标 Gitea 版本完成
真实登录、退出与组映射矩阵。

## 目标版本能力

| 能力 | Gitea 1.24 | Gitea 1.25 | Gitea 1.26 | Gitea 1.27 |
| --- | --- | --- | --- | --- |
| 图标、跳过本地 2FA、Required Claim | 支持 | 支持 | 支持 | 支持 |
| Group Claim、管理员/受限组、组织团队映射 | 支持 | 支持 | 支持 | 支持 |
| 全名 Claim、SSH 公钥 Claim | 不支持 | 支持 | 支持 | 支持 |
| External ID Claim | 不支持 | 不支持 | 不支持 | 支持留空或显式 `sub` |
| 用户同步、认证源启用状态 | 后台确认 | 后台确认 | 后台确认 | 后台确认 |

选择 Gitea `1.24` 时，模板会拒绝全名和 SSH 公钥 Claim。Gitea 的 `add-oauth` 命令总是创建启用的
认证源，而且没有用户同步参数：`active=false` 时模板不会生成 CLI 命令；其他情况执行命令后仍需在
管理后台确认“启用用户同步”。Gitea 1.27 的 CLI 也没有 External ID Claim 参数；显式填写
`externalIdClaimName: "sub"` 时，`gitea@3` 不生成不完整的 CLI 命令，而是要求在首次登录前通过
管理后台完成认证源配置。

## 结构化接入说明

模板生成的 `IntegrationGuideV1` 只包含 contracts 允许的 heading、paragraph、field、code、
warning 和 steps 节点，不包含 HTML。说明同时覆盖 Gitea 管理后台字段和以下 CLI 形式：

```bash
gitea admin auth add-oauth \
  --name 'company-sso' \
  --provider openidConnect \
  --key "$X_OIDC_CLIENT_ID" \
  --secret "$X_OIDC_CLIENT_SECRET" \
  --auto-discover-url 'https://id.example.com/oidc/.well-known/openid-configuration' \
  --scopes 'openid,profile,email'
```

长期说明的字段节点只使用固定占位符，CLI 命令只引用临时环境变量。真实凭据必须继续由应用控制面
一次性交付，不能传入模板、snapshot 或 IntegrationGuide；在可信 Gitea 主机执行命令后应立即清除
这两个环境变量。`gitea@2` 和 `gitea@3` 会按配置追加受目标版本支持的 `--icon-url`、Claim、组映射
和布尔参数。

## 验证

```bash
pnpm --filter @x-oidc/application-templates typecheck
pnpm --filter @x-oidc/application-templates test
pnpm --filter @x-oidc/application-templates build
```
