# `@gitea-oidc/cli`

应用开发者在本地校验 Gitea OIDC 连接描述、诊断 OIDC discovery，并为 Node.js 项目生成
最小环境变量配置。当前包保持 `private: true`，只供 monorepo 内联调，尚未开放外部安装。

CLI 只读取管理系统导出的 `ApplicationConnectionV1`。连接描述是可重复读取的公开配置，不能包含
`clientSecret`；confidential Client 的凭据只允许通过隐藏的 TTY 输入或权限受限的凭据文件提供。
当前版本不实现 setup code，也不调用管理 API。

## 运行要求

- Node.js `>=20.19.0`。
- 包以 ESM 为事实源，同时声明 `import`、`require` 和 `default` 条件；CommonJS 通过该 Node
  版本的 `require(esm)` 加载，不维护第二份 CJS 构建。
- connection 文件必须符合 `@gitea-oidc/contracts` 的严格 schema。

在 workspace 内构建和测试：

```bash
pnpm --filter @gitea-oidc/cli build
pnpm --filter @gitea-oidc/cli test
pnpm --filter @gitea-oidc/cli typecheck
```

## 校验与脱敏打印

校验管理系统导出的连接描述：

```bash
gitea-oidc config validate ./connection.json
```

CLI 不提供明文打印模式。打印时必须显式传入 `--redact`，应用 ID、OIDC Client ID 和
`client_id` 会被脱敏。连接 contract 会直接拒绝带 query 或 fragment 的 Redirect URI：

```bash
gitea-oidc config print ./connection.json --redact
```

如果 connection 文件包含明文 Secret 或其他未知字段，严格 schema 会直接拒绝该文件。

## Discovery 诊断

`doctor` 读取 connection 中的 `issuer`，请求其
`/.well-known/openid-configuration`：

```bash
gitea-oidc doctor ./connection.json
gitea-oidc doctor ./connection.json --timeout 10000
gitea-oidc doctor ./connection.json --allow-private-network
```

检查包括：

- discovery 请求可达、返回 JSON 且响应不超过 `1 MiB`；
- 响应中的 `issuer` 与 connection 中的值逐字精确匹配；
- `authorization_endpoint`、`token_endpoint` 和 `jwks_uri` 都是同源安全 URL；
- 生产地址必须使用 HTTPS；loopback 开发环境允许同源 HTTP；
- discovery 重定向和跨源 endpoint 会被拒绝。
- issuer 的 DNS 结果默认必须全部是公网 IP，并会在请求前后各校验一次。

`--timeout` 的范围是 `100` 到 `120000` 毫秒，默认 `5000` 毫秒。该时限覆盖 DNS、响应头、
响应体读取和 JSON 校验；超时后 CLI 会终止请求并取消响应体。只有可信内网或 loopback 开发环境
可以显式添加 `--allow-private-network`，不能对不可信 connection 使用该选项。

## 初始化项目

在目标项目目录运行 `init`。CLI 会检查当前 `package.json` 的 dependencies、
devDependencies、optionalDependencies 和 peerDependencies，并按以下顺序推荐连接器：

1. 检测到 `@nestjs/common` 时推荐 `@gitea-oidc/nestjs`；
2. 检测到 `fastify` 时推荐 `@gitea-oidc/fastify`；
3. 检测到 `express` 时推荐 `@gitea-oidc/express`；
4. 没有已支持框架时推荐 `@gitea-oidc/node`。

Express、Fastify 和 NestJS 连接器固定使用 `/oidc/callback`。检测到这些框架时，connection 必须
至少注册一个 pathname 精确等于 `/oidc/callback` 的 Redirect URI；否则 `init` 会在读取 Secret 或
写文件前失败，并提示先在管理系统补充回调，或改用 `@gitea-oidc/node` 自行适配路由。

默认命令只显示推荐包和脱敏的 `.env` 预览，不读取凭据，也不写文件：

```bash
gitea-oidc init ./connection.json
```

预览和生成的配置使用以下变量：

```dotenv
GITEA_OIDC_ISSUER='https://id.example.com'
GITEA_OIDC_CLIENT_ID='your-client-id'
GITEA_OIDC_REDIRECT_URI='https://app.example.com/oidc/callback'
GITEA_OIDC_SCOPES='openid profile email'
GITEA_OIDC_CLIENT_SECRET='[REDACTED: 通过安全输入提供]'
```

public Client 不生成 `GITEA_OIDC_CLIENT_SECRET`。

生成文件只面向 dotenv 库或 Node.js `--env-file`。不要执行
`source .env.gitea-oidc` 或 `. .env.gitea-oidc`；CLI 会在文件头写入相同警告，并对无法无损
round-trip 的值拒绝写入。

## 安全写入

先将目标文件加入 Git 忽略列表：

```bash
printf '\n.env.gitea-oidc\n' >> .gitignore
```

只有添加 `--write`、CLI 证明 `.env.gitea-oidc` 已被 Git 忽略，并在交互式 TTY 中输入
`yes` 后，CLI 才会创建文件。confidential Client 默认在确认后通过隐藏输入读取 Secret：

```bash
gitea-oidc init ./connection.json --write
```

也可以使用凭据文件。文件必须是当前用户拥有的普通文件，权限必须为 `0600` 或更严格，不能是
符号链接，大小不能超过 `16 KiB`。内容必须符合 `ApplicationCredentialV1`：

```json
{
  "schemaVersion": 1,
  "applicationId": "replace-with-application-id",
  "oidcClientId": "replace-with-oidc-client-id",
  "issuer": "https://id.example.com",
  "clientId": "replace-with-client-id",
  "kind": "client_secret",
  "clientSecret": "replace-with-secure-client-secret"
}
```

这些绑定字段由管理系统随凭据一起生成。CLI 会逐字段匹配 connection；缺少绑定字段、只保存裸
`clientSecret` 或把一份 credential 与另一应用的 connection 混用都会被拒绝。

先通过安全渠道准备凭据文件并执行 `chmod 600`，再运行：

```bash
gitea-oidc init ./connection.json --write --credential-file ./credential.json
```

安全边界如下：

- 不接受 `--secret`、`--client-secret` 或其他命令行 Secret，避免进入 shell history 和进程列表；
- dry-run 不读取凭据文件；
- 输出和错误信息不会回显 Secret；
- 在支持 POSIX owner-only mode 的平台上，`.env.gitea-oidc` 使用独占创建和 `0600` 权限，
  已存在时绝不覆盖；
- 写入前必须 TTY 确认，取消时不读取 Secret、不创建文件；
- CLI 不修改 `.gitignore`，但无法证明目标已被忽略时会在读取 Secret 前失败；
- 无法可靠提供 `O_NOFOLLOW`、POSIX UID 或 mode 校验的平台会拒绝 credential 文件；
- Windows 上的 Node.js mode 不能建立 owner-only DACL，因此 confidential Client 的 `init --write`
  会在确认、读取 credential 或隐藏输入前失败。public Client 不写 Secret，仍可创建配置；
- Windows 上的 confidential Client 应通过系统 Secret Manager 或已经正确限制 ACL 的部署配置注入
  Secret，不要依赖 CLI 创建 Secret 文件；
- 凭据写入完成后，应立即安全删除临时 credential 文件。

## 错误码

- `0`：命令成功或用户取消写入；
- `1`：配置、网络、凭据或文件安全检查失败；
- `2`：命令格式或参数错误。
