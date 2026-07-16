# 应用管理接入指南

应用管理把 OIDC Client 从纯静态 `clients[]` 配置迁移为后台控制面。管理员可以通过版本化模板或
自定义 OIDC 配置创建应用、预览派生配置、一次获取接入凭据、轮换 Client Secret，并启用或停用
应用。控制面当前仍只支持单实例 SQLite 部署；Node SDK、框架连接器和 CLI 已在 monorepo 中形成
私有预览包，尚未发布到 npm。

## 启用前提

启用应用管理时，以下配置必须同时满足：

- `applications.enabled` 为 `true`，且 `applications.clientSource` 为 `database`。
- `applications.repository.type` 为 `sqlite`。数据库 Client 模式在所有环境都拒绝内存应用仓储，
  避免进程重启后丢失 system Client 的删除状态和 OIDC Artifact 撤销任务。
- `adapter.type` 为 `sqlite`。当前应用管理模式只支持单实例，不能与 Redis OIDC Adapter 混用。
- `oidc.features.registration.enabled` 为 `false`，避免公共动态注册绕过 `ApplicationService`。
- `applications.secretEncryption.masterKey` 是 Base64 或 Base64URL 编码的恰好 32 字节随机密钥。
- `clients[]` 至少保留启动所需的系统 Client，并包含管理后台回调
  `${server.url}${admin.basePath}/callback`。
- 数据库模式导入的系统 Client 当前只支持 `client_secret_basic`、`response_types=[code]`，以及
  `authorization_code` 和可选的 `refresh_token` grant；其他旧 Client 必须先显式迁移。

配置组合不匹配时，服务会在启动阶段拒绝运行。不要通过关闭配置校验绕过这些约束。

## 生成应用主密钥

使用 Node.js 生成 32 字节随机密钥：

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

将输出保存到部署平台的 Secret Manager，并通过环境变量注入。该密钥必须与
`oidc.cookieKeys`、`providerApi.tokenEncryptionKey`、JWKS 私钥和任何客户端密钥分域，不能
提交到配置文件、镜像或版本库。

当前版本没有应用主密钥在线轮换协议。直接替换 `masterKey` 或 `keyId` 会导致已有
confidential Client Secret 无法解密；必须把密钥和应用数据库一起备份、恢复。在迁移工具完成
前，不要原地轮换该密钥。

## 配置应用管理

推荐使用 `x-oidc.config.js` 从环境变量读取主密钥。把下面片段合并进完整生产配置：

```javascript
const applicationMasterKey = process.env.X_OIDC_APPLICATION_MASTER_KEY;

if (!applicationMasterKey) {
  throw new Error("缺少 X_OIDC_APPLICATION_MASTER_KEY");
}

export default {
  applications: {
    enabled: true,
    clientSource: "database",
    repository: {
      type: "sqlite",
      sqlite: {
        dbPath: "/app/data/applications.db",
      },
    },
    secretEncryption: {
      keyId: "applications-v1",
      masterKey: applicationMasterKey,
    },
  },
  oidc: {
    features: {
      registration: { enabled: false },
    },
  },
  adapter: {
    type: "sqlite",
    sqlite: {
      dbPath: "/app/data/oidc.db",
    },
  },
};
```

片段只展示应用管理相关字段。生产配置仍须提供 HTTPS URL、强 Cookie 密钥、持久化用户仓储、
后台系统 Client 和其他必填字段，完整要求见[生产环境配置指南](./PRODUCTION_SETUP.md)。

## `clientSource` 单一事实源

`clientSource` 是整源切换开关，不是查询优先级：

| 模式 | 配置组合 | Provider 的 Client 来源 | 应用管理 |
| --- | --- | --- | --- |
| 静态兼容模式 | `enabled: false`、`clientSource: "config"` | 直接读取 `clients[]` | 不可用，API 返回 `503` |
| 数据库模式 | `enabled: true`、`clientSource: "database"` | 只读取 ApplicationRepository | 可用 |

数据库模式启动时，服务会把 `clients[]` 导入或协调为 `system application`，然后向
`oidc-provider` 传入空的静态 Client 列表。后续认证只查询 ApplicationRepository，不会在
`clients[]` 和数据库之间混合查询。`clients[]` 在当前迁移期仍是 `system Client` 的部署事实源，
不能删除管理后台所需 Client。

`clients[].portal` 也会随 system Client 导入：`portal.name` 和 `portal.description` 成为应用名称
与说明，snake_case 的 `launch_url`、`icon_url` 会转换为 `Application.portal` 的 camelCase 字段。
门户 Client 本身如果不需要显示为卡片，应省略它的 `portal` 对象。

导入后的 `system application` 会在管理台展示，但只能通过部署配置管理，管理 API 和页面不会允许
启用或停用它们。这一约束用于保护管理后台 Client，避免管理员把自己的登录入口永久锁死。配置中
的 Client 元数据或 Secret 发生变化时，下次启动会在同一事务内保留 Application/Client ID、递增
版本、替换配置和轮换 Secret，并写入 system 审计；配置未变化时不会产生新版本。若 `client_id`
已被非 `system application` 占用，服务仍会 fail closed，不会覆盖业务应用。

从 `clients[]` 删除非后台 `system Client` 后，下次启动会先进入 `disabling`、撤销 active Secret
并记录脱敏指纹，再清理关联的 Grant、Code、Access Token 和 Refresh Token；全部成功后才进入
`disabled`。进程中断时下次启动会继续该流程。重新加入相同 `client_id` 时会先完成遗留撤销，再保留
原 ID、重新启用并写入新的加密 Secret。启用后台时，配置验证会继续阻止删除后台 callback 所依赖的
Client。

## 在管理后台创建应用

1. 使用 `admin.allowedGroups` 允许的管理员登录 `${server.url}${admin.basePath}`。
2. 打开“应用”页面，默认路径为 `/admin/applications`。
3. 选择“使用模板”或“自定义 OIDC”。模板表单和预览均由服务端的精确模板版本驱动；自定义模式
   需要选择环境、Client 类型、Redirect URI、可选的 Post Logout Redirect URI、scopes 和是否启用
   Refresh Token。
4. 提交前检查模板预览中的 Issuer、Redirect URI、Post Logout Redirect URI、scopes、PKCE 和
   结构化接入步骤。
5. 下载 `*.x-oidc.connection.json`；它是可重复获取的公开接入描述，不包含任何 Secret。
6. confidential Client 还要立即下载 `*.x-oidc.credential.json`，并把文件内容转存到业务应用的
   Secret Manager。
7. 使用公开 connection 和一次性 credential 配置业务应用的 OIDC 客户端。

生产和预发布 Redirect URI 与 Post Logout Redirect URI 必须使用 HTTPS。开发环境只允许 loopback
地址使用 HTTP，URI 不能包含 query、通配符、fragment 或用户凭据。所有应用必须包含 `openid`
scope；公共 Client 不生成 Client Secret，并强制使用 PKCE S256。登出回跳地址执行精确匹配，路径和
末尾 `/` 必须与业务系统实际发送的 `post_logout_redirect_uri` 一致。

第三方自定义应用默认使用显式 consent。只有受信任的 first-party 应用才能配置
`skip_for_trusted`，当前后台表单不会把普通自定义应用提升为 first-party。

禁用非 system 应用（自定义或模板）时，服务会先封锁关联 Client 的新授权记录写入，再持久化
`disabling` 状态并撤销已有 Grant、Code 和 Token；撤销完成后才进入 `disabled`。如果进程在中途
退出，下次启动会继续恢复未完成的撤销。system application 也使用相同的两阶段撤销和启动恢复，
但只能由 `clients[]` 的部署配置触发，不能从管理后台手工启停。

## 发布应用到用户门户

创建模板应用或自定义应用时，可以启用“显示在用户门户”，并填写门户入口 URL、可选图标 URL 和
排序值。对应的 `Application.portal` 字段为：

```json
{
  "enabled": true,
  "launchUrl": "https://app.example.com/",
  "iconUrl": "https://app.example.com/icon.png",
  "order": 20
}
```

只有 `status=active` 且 `portal.enabled=true` 的 Application 会进入普通用户目录。卡片名称和说明
来自 Application 自身的 `name`、`description`；`order` 越小越靠前。停用应用后，卡片随即从目录
消失。

生产和预发布环境的 `launchUrl`、`iconUrl` 必须使用 HTTPS；开发环境仅允许 loopback URL 使用
HTTP。门户展示配置只控制导航，不改变 Client scopes、consent、Provider API 权限或 OIDC 生命周期。
当前所有已登录用户看到同一个目录，不支持按用户、组织或团队过滤。

门户服务本身的 `portal` 配置、内部 Client、静态 `clients[].portal` 以及退出回跳要求见
[用户门户部署与使用指南](./USER_PORTAL.md)。

## 使用 Gitea 模板

内置目录保留支持 `1.24`、`1.25` 和 `1.26` 的 `gitea@1`、`gitea@2`；新建应用默认使用仅支持
`1.27` 的 `gitea@3`。管理员填写 Gitea Base URL、认证源名称、目标版本、部署环境和认证源选项后，
服务端会派生并校验：

- Gitea 固定回调地址；
- Gitea 站点根地址对应的 Post Logout Redirect URI；
- 与当前部署 claim 配置一致的 OIDC scopes；
- Gitea 的 PKCE 兼容策略；
- 图标、2FA、全名/SSH/Required Claim、管理员/受限组和组织团队映射；
- Gitea 1.27 可选的 External ID Claim；当前只允许留空或显式 `sub`；
- 管理后台字段、discovery URL 和目标版本支持的 `gitea admin auth add-oauth` 命令说明。

Gitea 1.24 不支持全名与 SSH 公钥 Claim，模板会拒绝这种组合；1.25 及以上支持。已有认证源升级到
1.27 时 External ID Claim 应留空，继续使用稳定的 `sub`。模板也接受显式 `sub`，但 Gitea 1.27
的 `add-oauth` 仍没有对应参数，此时模板不会生成不完整的 CLI 命令，而是要求在首次登录前通过后台
创建认证源。其他 Claim 会被模板拒绝。`add-oauth` 也没有用户同步参数且总是创建启用状态的认证源，
因此模板会要求在后台确认用户同步；选择不启用认证源时同样不会生成 CLI 命令。

创建时会把模板解析结果保存为不可变版本快照。即使模板目录以后升级或移除，应用的公开 connection
和接入说明仍从创建时快照重复生成，不会静默漂移。模板只生成结构化纯文本说明，不保存或拼接真实
Client Secret。

`supportedVersions` 是代码中的兼容目标，不等同于真实实例认证。当前自动测试覆盖输入约束、登录与
登出回跳派生、scope/claim 映射、快照稳定性和命令参数合同；在生产采用某个 Gitea 版本前，仍应
使用该版本实例完成一次真实登录、退出和组映射验收。

## 一次性凭据语义

confidential Client 的明文 Client Secret 只出现在首次创建响应中。相同
`Idempotency-Key` 的安全重放只返回 `already_delivered`，不会再次展示密钥。创建响应必须按
敏感数据处理，不能写入日志、审计、指标或错误上报。

如果首次创建响应丢失，Secret 不能重新下载。管理员应在应用列表点击“轮换密钥”：服务会在一个
事务中撤销旧的 active Secret、创建新 Secret、递增 Application version 并写入脱敏审计，新明文
仍只在本次响应中返回。旧 Secret 在事务提交后立即失效。

轮换使用乐观版本号，并与同一应用的启用、禁用操作串行执行。如果轮换请求的网络响应丢失，先刷新
应用列表获取当前 version，再执行一次轮换即可恢复；不要从 `applications.db`、审计或管理 API
读取密文。`system application` 只能通过部署配置轮换：在维护窗口同时准备 IdP 和业务 Client 的新
Secret，更新 `clients[]` 后重启 IdP，再立即切换业务 Client。启动过程会事务性替换数据库中的 active
Secret；public Client 不使用 Client Secret。

公开 connection 不属于一次性凭据。管理员可以随时在应用列表点击“配置”重新下载，服务端通过
`GET ${admin.basePath}/api/applications/:id/connection` 从当前 Application/Client 状态重新生成；
该响应不会包含明文、密文、fingerprint 或其他凭据字段。

## 使用 SDK、连接器和 CLI

monorepo 当前提供以下私有预览包：

- `@x-oidc/node`：框架无关的 Authorization Code + PKCE 核心，包含 discovery、state、nonce、
  transaction、Session、Refresh Token 并发控制和退出；
- `@x-oidc/node-sqlite`：加密 SQLite transaction/session store 和跨进程 refresh lock；
- `@x-oidc/express`：Express 4/5 固定路由、中间件和认证投影；
- `@x-oidc/fastify`：Fastify 5 plugin、hook 和认证投影；
- `@x-oidc/nestjs`：NestJS 10/11 动态模块、Guard 和参数装饰器，支持 Express/Fastify adapter；
- `@x-oidc/cli`：connection 严格校验、脱敏打印、discovery 诊断和项目初始化。

业务应用只需要公开 connection 和与其四个绑定字段完全一致的一次性 credential，不需要管理 API
权限。CLI 默认 dry-run，不读取 Secret、不写文件；`init --write` 只有在交互确认、目标 env 文件已
被 Git 忽略且凭据输入满足安全约束时才写入 `0600` 文件。当前未实现 setup code，不能通过 CLI
远程领取 Secret。

生产代码使用 `@x-oidc/node` 时必须注入持久化 transaction/session store 和跨实例 refresh
lock；单机部署可以直接使用 `@x-oidc/node-sqlite`。内存实现仅供单进程开发测试。框架连接器
固定暴露 `GET /oidc/login`、
`GET /oidc/callback` 和同源 `POST /oidc/logout`，不会把 Access Token、Refresh Token、ID Token
或内部 Session ID 投影到业务请求。

在这些包正式发布前，只能在本仓库 workspace 内验证。各包的完整示例和生命周期约束见对应
`packages/*/README.md`。

## SQLite 单实例与持久化

应用数据库和 OIDC Adapter 当前必须同时使用本地 SQLite，因此启用应用管理后只能运行一个
服务实例。不要把 SQLite 文件放在 NFS 上，也不要让多个 Pod 或容器分别挂载自己的
`applications.db`。多实例应用管理要等共享 ApplicationRepository 落地后再启用。

Docker 部署应把所有持久化文件放到同一个受保护 volume，例如：

```bash
docker run -d --name x-oidc -p 3000:3000 \
  -e NODE_ENV=production \
  --env-file /srv/x-oidc/x-oidc.env \
  -v /srv/x-oidc/data:/app/data \
  -v /srv/x-oidc/x-oidc.config.js:/app/x-oidc.config.js:ro \
  lydamirror/x-oidc:<version>
```

生产环境使用已发布的固定版本号，不要使用 `latest`。完整 Compose 和上线流程见
[生产部署指南](./PRODUCTION_SETUP.md)。

如果部署平台没有 Secret Manager，至少把 env 文件权限设为 `0600`，并排除在镜像、备份日志和
版本控制之外。不要把主密钥直接写进 shell 命令历史。

至少持久化以下数据；实际文件由配置路径决定：

- `applications.db`：应用、Client、加密 Secret、幂等记录和审计。
- `oidc.db`：授权码、Token、Grant 和会话等 OIDC 数据。
- `users.db`：使用 SQLite 用户仓储时的用户数据。
- `jwks.json`：Token 签名私钥。

应用主密钥应留在外部 Secret Manager，不要写入 volume。备份和恢复时必须使用同一把主密钥。

从未版本化的旧应用库首次升级时，服务会使用当前规范化的 `oidc.issuer`，在单个 SQLite 事务内
校验聚合、补齐 connection issuer 并写入仓储 schema 版本。升级前应先做一致性备份；未知版本、
索引不一致或无法通过当前严格 schema 的记录会阻止启动，不会被静默丢弃。

## 备份与恢复

最简单的一致性备份方式是先停止唯一实例，再归档整个数据 volume：

```bash
docker stop x-oidc
tar -C /srv/x-oidc/data -czf /srv/backup/x-oidc-data-YYYYMMDD.tar.gz .
docker start x-oidc
```

运行中直接复制单个 `.db` 文件可能遗漏 WAL 中尚未 checkpoint 的事务。若业务不能停机，应使用
SQLite Online Backup API 或 `sqlite3 .backup` 分别备份每个数据库，并验证恢复演练；不要只复制
主数据库而忽略 `-wal`、`-shm` 文件。

恢复时先停止服务，把备份恢复到空的数据 volume，并注入对应的应用主密钥，再启动唯一实例。
恢复后至少验证：

```bash
curl https://id.example.com/oidc/.well-known/openid-configuration
```

随后在管理后台确认应用列表可读，并使用测试 Client 完成一次授权码流程。

## 当前边界

当前已经提供自定义应用、Gitea 版本化模板、ApplicationRepository、Secret 加密与轮换、审计、
Client Adapter、`clientSource` 整源切换、一次性直接凭据、管理页面、Node SDK、加密 SQLite
客户端存储、三个框架连接器、本地接入 CLI 和普通用户应用门户。仍未完成的能力包括：

- Client API 代理、Client 用户 Token 获取和维护；现有代理能力只面向认证 Provider；
- setup code 及安全的远程凭据领取协议；
- 外部 KMS 主密钥轮换和历史密文迁移；
- 多实例共享 ApplicationRepository；
- npm 多包版本和发布编排；
- Gitea `1.24`、`1.25`、`1.26`、`1.27` 的真实实例兼容矩阵认证。

正式发布连接器前，外部业务应用仍应使用成熟的标准 OIDC 客户端库消费管理后台给出的 Issuer、
Client ID、Client Secret、Redirect URI、scopes 和 PKCE 策略；本仓库内部消费者可以使用预览包
参与集成验证。
