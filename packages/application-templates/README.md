# `@gitea-oidc/application-templates`

Gitea OIDC 内置应用模板包。它负责校验产品输入、派生 OIDC Client 配置，并生成结构化接入说明；
不访问网络、不读取数据库，也不接收或保存 Client Secret。

## 当前状态

该包目前是 monorepo 内部包，版本为 `0.0.0` 且保持 `private: true`。当前只提供版本化的
Gitea 模板 `gitea@1`，支持目标版本 `1.24`、`1.25` 和 `1.26`。

## 模板输入

`GiteaTemplateInputV1Schema` 接受以下字段：

- `giteaBaseUrl`：Gitea 对外 Base URL。生产和预发布环境必须使用 HTTPS；开发环境仅允许
  loopback HTTP。
- `authSourceName`：Gitea 认证源名称，同时用于 callback 路径，只允许安全的小写 slug。
- `targetVersion`：`1.24`、`1.25` 或 `1.26`。
- `environment`：`development`、`staging` 或 `production`。
- `owner`：可选负责人。
- `groupClaimName`：可选 group claim 名称。该名称必须存在于当前 IdP 的 claim 配置中；模板会选择
  实际承载该 claim 的 scope，不会凭空添加一个未配置的 `groups` scope。

模板会派生精确 callback：

```text
<giteaBaseUrl>/user/oauth2/<authSourceName>/callback
```

## 使用方式

持久化引用必须包含模板版本。`getLatest()` 只适合创建向导选择当前版本，不能用于重新解析已有应用。

```typescript
import { applicationTemplateCatalog } from "@gitea-oidc/application-templates";

const result = applicationTemplateCatalog.resolve(
  { id: "gitea", version: 1 },
  {
    giteaBaseUrl: "https://gitea.example.com",
    authSourceName: "company-sso",
    targetVersion: "1.26",
    environment: "production",
  },
  { issuer: "https://id.example.com/oidc" },
);

console.log(result.resolution.client.redirectUris);
```

`preview()` 返回校验、规范化和派生结果，但不暴露 snapshot 字段。`resolve()` 额外返回经过
JSON-safe 校验并递归冻结的 snapshot，可作为创建应用时保存的模板快照。非法的
`undefined`、函数、非有限数字、类实例和循环引用会被明确拒绝，不会被静默删除或转换。

## Gitea V1 协议策略

模板固定生成以下协议配置：

- confidential Client 和 `client_secret_basic`。
- Authorization Code grant，不启用 refresh token。
- 默认使用 `openid profile email` scopes；配置 group claim 时复用或增加实际承载该 claim 的
  已配置 scope。
- 第三方应用和显式 consent，不允许模板自行提升信任级别。
- PKCE 为 `optional`。

Gitea 的公开 issue
[#34747](https://github.com/go-gitea/gitea/issues/34747)
仍记录其 OpenID Connect 授权请求未发送 `code_challenge`。在目标版本完成兼容性验证前，模板不得把
PKCE 改为 `required`。

`supportedVersions` 表示当前代码希望兼容的目标版本，不表示已经完成真实实例认证。自动测试覆盖
输入、回调、scope/claim 映射、快照和 CLI 参数合同；正式发布前仍需分别使用 Gitea `1.24`、
`1.25` 和 `1.26` 完成真实登录、退出与组映射矩阵。

## 结构化接入说明

模板生成的 `IntegrationGuideV1` 只包含 contracts 允许的 heading、paragraph、field、code、
warning 和 steps 节点，不包含 HTML。说明同时覆盖 Gitea 管理后台字段和以下 CLI 形式：

```bash
gitea admin auth add-oauth \
  --name 'company-sso' \
  --provider openidConnect \
  --key "$GITEA_OIDC_CLIENT_ID" \
  --secret "$GITEA_OIDC_CLIENT_SECRET" \
  --auto-discover-url 'https://id.example.com/oidc/.well-known/openid-configuration' \
  --scopes 'openid,profile,email'
```

长期说明的字段节点只使用固定占位符，CLI 命令只引用临时环境变量。真实凭据必须继续由应用控制面
一次性交付，不能传入模板、snapshot 或 IntegrationGuide；在可信 Gitea 主机执行命令后应立即清除
这两个环境变量。

## 验证

```bash
pnpm --filter @gitea-oidc/application-templates typecheck
pnpm --filter @gitea-oidc/application-templates test
pnpm --filter @gitea-oidc/application-templates build
```
