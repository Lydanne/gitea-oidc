# v1 到 v2 迁移指南

本文面向从 `gitea-oidc` v1.0.29 迁移到 X OIDC v2.0.0 的部署者和运维人员，说明迁移
步骤、回滚方式，以及配置、接口、数据模型和关键算法的差异。

v2 是新一代实现，不承诺直接兼容 v1 的全部运行数据。推荐采用蓝绿部署：保留可随时启动的
v1 实例，使用新的 v2 目录和配置完成验证后再切换流量。不要让 v1 和 v2 同时写同一数据库。

## 迁移结论

- OIDC `sub` 算法保持不变。只要 `authProvider` 和 `externalId` 不变，用户重新登录后仍会得到
  相同的 `sub`。
- v1 用户数据库可以作为迁移输入，但必须先备份并检查重复身份。v2 启动时会补充字段和索引。
- v1 的 `groups: string[]` 不会自动转换为 v2 的树形分组。迁移后用户必须重新登录或重新同步。
- 不建议迁移 v1 的 OIDC 会话、授权码、Grant 和 Token。使用空的 v2 OIDC 存储，要求用户重新
  登录，可以避免旧会话绕过 v2 的撤销和并发保护。
- v1 配置文件不能原样使用。文件名、`issuer`、生产安全配置和可选模块均有变化。
- 若保持原 `client_id`、客户端密钥、回调地址、`issuer` 和 JWKS，现有 OIDC Client 可以平滑
  切换；任何一项变化都应按破坏性迁移处理。

## 迁移前决策

### 选择迁移范围

推荐按以下顺序分阶段上线：

1. 先迁移核心 OIDC、认证 Provider、静态 Client 和用户仓储。
2. 验证 Gitea 登录、刷新令牌、退出登录和组映射。
3. 再按需启用管理后台和用户门户。
4. 最后评估数据库应用管理和 Provider API。

第一次切换时建议保持：

```json
{
  "admin": { "enabled": false },
  "portal": { "enabled": false },
  "providerApi": { "enabled": false },
  "applications": {
    "enabled": false,
    "clientSource": "config"
  }
}
```

这样可以先验证原有身份链路，避免把应用管理、门户和 Provider Token 代理一起带入切换窗口。

### 确定身份连续性策略

| 项目 | 保持连续 | 重新开始 |
| --- | --- | --- |
| `oidc.issuer` | 保持原公开 Issuer，但必须确认包含 `/oidc` | 使用新 Issuer，并在全部 Client 重新配置 |
| JWKS | 保留原 JWKS，使未过期 JWT 仍可验证 | 生成新 JWKS，按密钥轮换计划等待旧 Token 过期 |
| Client | 保留 `client_id`、密钥和 URL | 在 Gitea 等 Client 重新登记 |
| 用户 | 复制用户库，或依靠相同身份重新创建 | 使用新用户库并接受用户重新登录 |
| OIDC 运行数据 | 不迁移，强制重新登录 | 不迁移，强制重新登录 |

即使保留 JWKS，也建议使用空的 v2 OIDC 适配器数据库。JWKS 解决签名验证连续性，OIDC 适配器
保存的是会话和 Token 生命周期状态，两者不是同一种数据。

## 上线前检查

### 记录现有部署

在停机前记录并安全备份以下内容：

- 实际生效的 `gitea-oidc.config.js` 或 `gitea-oidc.config.json`。
- 用户 SQLite 文件或 PostgreSQL 数据库。
- OIDC SQLite 文件或 Redis 命名空间，仅用于回滚 v1，不导入 v2。
- JWKS 文件和文件权限。
- 本地密码文件。不要将密码文件提交到 Git。
- 反向代理配置、公开域名和受信任代理地址。
- 每个 Client 的 `client_id`、回调地址、退出回调地址和认证方式。
- Gitea 认证源配置及当前的组到组织/团队映射。

密钥、数据库连接串、Cookie Key、JWKS 私钥和 Client Secret 应保存在密钥管理系统中，不要写入
迁移记录、工单或命令历史。

### 检查 Provider 身份重复

v2 对非空的 `(authProvider, externalId)` 建立唯一索引。v1 只有普通索引，历史数据库中如果存在
重复值，v2 会启动失败。

SQLite 检查命令：

```bash
sqlite3 /path/to/users.db '
SELECT "authProvider", "externalId", COUNT(*)
FROM users
WHERE "externalId" IS NOT NULL
GROUP BY "authProvider", "externalId"
HAVING COUNT(*) > 1;'
```

PostgreSQL 检查语句：

```sql
SELECT "authProvider", "externalId", COUNT(*)
FROM users
WHERE "externalId" IS NOT NULL
GROUP BY "authProvider", "externalId"
HAVING COUNT(*) > 1;
```

结果必须为空。若存在重复记录，应先在 v1 备份副本中确认哪一条是有效账号，再制定人工合并方案；
不要让 v2 启动过程替你选择记录。

### 记录旧分组授权

导出所有依赖 v1 `groups` 的规则，包括：

- Gitea 的用户组 Claim 和组到组织/团队映射。
- 反向代理或其他 Client 对 `groups` 的判断。
- v1 飞书默认的 `Owners` 组。

v2 不再把 `Owners` 当作默认组。飞书用户默认加入 `Default`，管理后台默认使用专用组
`x-oidc-admins`。不要把 `Default` 当作管理员组。

## 配置迁移

### 重命名配置文件和类型

| v1 | v2 |
| --- | --- |
| `gitea-oidc.config.js` | `x-oidc.config.js` |
| `gitea-oidc.config.json` | `x-oidc.config.json` |
| `GiteaOidcConfig` | `XOidcConfig` |
| npm 包 `gitea-oidc` | npm 包 `@x-oidc/server-core` |
| `node dist/server.js` | `node apps/idp-server/dist/main.js` |

JS 配置仍优先于 JSON 配置。生产环境没有 v2 配置文件时会直接失败，不再静默使用开发默认值。
从 [`example.x-oidc.config.json`](../example.x-oidc.config.json) 复制结构，再逐项迁移值，不要只把旧
文件改名。

### 修正公开 URL 和 Issuer

v2 的服务根地址和 OIDC Issuer 分工如下：

```json
{
  "server": {
    "url": "https://id.example.com",
    "trustProxy": true,
    "trustedProxyIps": ["10.0.0.0/8"]
  },
  "oidc": {
    "issuer": "https://id.example.com/oidc"
  }
}
```

- `server.url` 是服务公开根地址，不带 `/oidc`。
- `oidc.issuer` 必须是实际 OIDC 挂载地址，带 `/oidc`。
- 自动发现 URL 是
  `https://id.example.com/oidc/.well-known/openid-configuration`。
- 反向代理后启用 `trustProxy` 时，生产环境还必须填写 `trustedProxyIps`，不要无条件信任任意来源
  的转发头。

v1 文档和示例曾同时出现带 `/oidc` 与不带 `/oidc` 的 Issuer。迁移时应以线上发现文档中的
`issuer` 为准，不能仅复制旧配置文本。若改变 Issuer，Gitea 会把它视为不同的身份提供方。

### 迁移 Client

静态 Client 的核心字段保持不变：

- `client_id`
- `client_secret`
- `redirect_uris`
- `post_logout_redirect_uris`
- `response_types`
- `grant_types`
- `token_endpoint_auth_method`

迁移时应逐字保留 URL，包括协议、端口、路径和末尾斜杠。Gitea 常见配置为：

```json
{
  "client_id": "gitea",
  "client_secret": "<从密钥管理系统注入>",
  "redirect_uris": ["https://git.example.com/user/oauth2/x-oidc/callback"],
  "post_logout_redirect_uris": ["https://git.example.com/"],
  "response_types": ["code"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "client_secret_basic"
}
```

`post_logout_redirect_uri` 必须精确出现在 `post_logout_redirect_uris` 中，否则退出时会返回
`invalid_request`。如果 Gitea 实际发出带末尾 `/` 的地址，配置也必须带末尾 `/`。

v2 的静态 Client 可增加 `portal` 展示信息，但这只控制用户门户中的导航展示，不会授予额外的
OIDC 或 Provider API 权限。

### 迁移认证配置

原有 `auth.userRepository` 和 `auth.providers` 仍然存在。v2 新增：

```json
{
  "auth": {
    "autoRedirectSingleProvider": false,
    "stateStore": { "type": "memory" }
  }
}
```

- 单实例可以使用 `memory` State Store。
- 多实例或 Redis OIDC 适配器必须使用 Redis State Store，保证 OAuth state、后台会话和限流计数
  在节点间一致。
- `autoRedirectSingleProvider` 默认关闭。启用后，仅有一个可跳转登录方式时会直接进入该 Provider。
- 本地认证新增 `adminUsers` 和 `lockoutPolicy`。建议先配置一个本地应急管理员，再启用后台。

示例：

```json
{
  "local": {
    "enabled": true,
    "displayName": "本地密码",
    "priority": 1,
    "config": {
      "passwordFile": "/run/secrets/x_oidc_htpasswd",
      "passwordFormat": "bcrypt",
      "adminUsers": ["bootstrap-admin"],
      "lockoutPolicy": {
        "enabled": true,
        "maxAttempts": 5,
        "lockoutDuration": 900
      }
    }
  }
}
```

`adminUsers` 中的用户登录后会获得 `x-oidc-admins` 组。验证其他管理员组规则之前，不要删除此
应急入口。

### 新增模块的默认策略

| 配置 | v2 默认/建议 | 迁移注意事项 |
| --- | --- | --- |
| `audit` | 启用，保留 30 天 | 记录登录、退出和用户变更；确认数据库容量和清理任务 |
| `admin` | 默认关闭 | 启用前配置专用管理员完整组路径 |
| `portal` | 默认关闭 | 启用前创建独立 Portal Client 和回调地址 |
| `providerApi` | 默认关闭 | 需要独立加密密钥、Client 白名单和操作白名单 |
| `applications` | 默认关闭 | 首次迁移保留 `clientSource: config` |

Provider API 代理的是用户在上游认证 Provider 的 Token，不是 Gitea 等 OIDC Client 的用户 Token。
v2 当前不提供 Client API 代理，也不会从 Gitea 登录回调中取得或维护 Gitea 用户 Token。

## 数据迁移

### 推荐目录布局

不要覆盖 v1 目录。为 v2 使用新目录并复制需要保留的数据：

```text
/srv/x-oidc-v1/        # 保留，只用于回滚
/srv/x-oidc-v2/
  x-oidc.config.js
  data/
    users.db           # 可由 v1 副本迁移
    oidc-v2.db         # 新建，不复制 v1 会话
    applications.db    # 仅启用数据库应用管理时使用
  secrets/
    jwks.json
    users.htpasswd
```

文件名只是示例，实际路径以配置为准。数据库和密钥文件权限应限制为运行用户可读写。

### 用户数据库

#### 使用 memory 的 v1

`memory` 中没有可迁移的持久数据。配置 v2 持久用户仓储后，让用户重新登录。只要 Provider 名称和
外部用户 ID 不变，确定性 `sub` 仍保持不变。

#### 使用 SQLite 的 v1

1. 停止 v1 写入。
2. 备份原用户数据库。
3. 将备份复制到 v2 数据目录，v2 配置指向副本。
4. 完成重复身份检查。
5. 首次启动 v2。仓储会增加 `id`、`status`、`roles`、`lastLoginAt`、`lastSyncedAt` 和
   `providerProfile` 字段，并为旧记录补随机 `id`。
6. 让用户重新登录，使 Provider 数据和树形分组覆盖旧值。

#### 使用 PostgreSQL 的 v1

1. 创建数据库级备份或时间点恢复点。
2. 停止 v1 写入并执行重复身份检查。
3. 使用专门的 v2 数据库副本进行首次演练。
4. v2 首次连接会增加缺失字段、回填随机 `id`，并建立唯一索引。
5. 验证成功后，再在正式切换窗口中执行相同步骤。

不要先让 v2 修改唯一的生产用户库再尝试回滚 v1。虽然 v1 通常会忽略新增列，但 v2 写回的树形
`groups` 与 v1 的 `string[]` 模型不兼容。回滚应恢复迁移前备份。

### 分组数据

v1 记录示例：

```json
["Owners", "研发中心", "od-001"]
```

v2 记录示例：

```json
[
  { "id": "Default", "name": "Default" },
  {
    "id": "tenant-001",
    "name": "示例组织",
    "children": [
      {
        "id": "od-001",
        "name": "研发中心",
        "children": [{ "id": "od-002", "name": "后端组" }]
      }
    ]
  }
]
```

v2 读取 v1 的字符串数组时会忽略这些非法树节点，因此在用户重新登录前，该用户的有效分组为空。
这是有意的安全收紧，不应通过把旧字符串机械包装成对象来恢复授权。飞书重新登录时会重新读取组织
和部门层级。

上线前必须确保至少一个管理员能通过本地 `adminUsers` 登录；否则旧 `Owners` 消失后，可能没有人
能够进入管理后台。

### OIDC 适配器数据

v1 和 v2 的 SQLite 适配器都使用 `oidc_store` 表，但 v2 增加了原子消费、Grant 校验、账号撤销和
Client 禁用屏障。表结构相似不代表会话语义兼容。

推荐做法：

- v2 使用新的 SQLite 文件或新的 Redis Key 前缀。
- 不复制 v1 Session、Interaction、AuthorizationCode、Grant、AccessToken 和 RefreshToken。
- 切换后要求用户重新登录。
- 保留 v1 OIDC 存储只用于回滚，不再写入。

v1 SQLite 适配器还曾固定使用当前目录的 `./oidc.db`；v2 会实际使用
`adapter.sqlite.dbPath`。迁移时必须核对 v1 进程工作目录中的真实文件，而不是只看旧配置值。

### JWKS

若要保持 Issuer 连续性，复制原 JWKS 文件并保持 `kid` 不变。复制后检查文件权限，不要打印私钥。
如果决定轮换密钥，应把它作为独立变更执行，并至少等待旧 Token 的最大有效期后再移除旧公钥。

## 接口差异

### HTTP 路由

| 接口 | v1 | v2 |
| --- | --- | --- |
| OIDC 挂载路径 | `/oidc/*` | `/oidc/*`，保持不变 |
| 发现文档 | `/oidc/.well-known/openid-configuration` | 保持不变，返回的 `issuer` 必须带 `/oidc` |
| 首页 | 跳转 `/index.html` | Portal 启用时跳转其 `basePath`，否则跳转 `/index.html` |
| 登录交互 | `GET /interaction/:uid` | 保持，并增加交互代际校验和安全响应头 |
| 本地登录 | `POST /interaction/:uid/login` | 保持，增加来源校验、限流和账号状态校验 |
| OAuth 完成 | `GET /interaction/:uid/complete` | 保持，认证结果改为一次性原子消费 |
| Consent | 自动同意 | 动态第三方应用使用 `POST /interaction/:uid/consent` 显式决定 |
| Provider 插件 | `/auth/{providerName}/*` | 保持，并增加权限元数据约束 |
| 管理后台 | 无 | `{admin.basePath}/*`，默认 `/admin`，仅启用时存在 |
| 用户门户 | 无 | `{portal.basePath}/*`，默认 `/portal`，仅启用时存在 |
| Provider API | 无 | `POST /api/provider/:provider/request`，全局和 Provider 均启用时存在 |
| 健康检查 | 无独立端点 | 仍无独立端点，使用 OIDC 发现文档检查 |

管理后台和门户的 `/api/*` 是同源 BFF 接口，依赖其 Cookie Session，不是面向第三方系统的通用
Bearer API。Provider API 需要 OIDC Access Token、`provider_api` Scope、Client 白名单和操作白名单。

### npm 和进程接口

v1 是单包应用；v2 是 pnpm monorepo。生产进程入口改为 `apps/idp-server`，可复用服务能力位于
`@x-oidc/server-core`。

公开导出包括：

- `@x-oidc/server-core`
- `@x-oidc/server-core/server`
- `@x-oidc/server-core/config`
- `@x-oidc/server-core/client`
- `@x-oidc/server-core/express`
- `@x-oidc/server-core/nest`
- `@x-oidc/server-core/vue`

工作区中的 Node SDK、SQLite 会话存储、Express、Fastify、NestJS Connector 和 CLI 目前是独立包；
部署前应以各包的 `private` 和发布状态为准，不要假设整个工作区都会发布到 npm。

### OIDC Claims

| Claim | v1 | v2 |
| --- | --- | --- |
| `sub` | 确定性 SHA-256 | 算法不变 |
| `preferred_username` | 未统一输出 | 从 `username` 统一投影 |
| `groups` | 平面字符串 | 组织/部门完整名称路径和完整 ID 路径 |
| `groups_tree` | 无 | 完整 `UserGroup[]` 树 |
| `roles` | 无 | 规范化角色数组 |
| `status` | 无 | `active`、`disabled`、`locked` 或 `pending` |
| `email_verified` | Provider 直接映射 | 未获可验证证据时为 `false` |

飞书分组路径同时输出名称和 ID，例如：

```json
{
  "groups": [
    "Default",
    "示例组织",
    "tenant-001",
    "示例组织/研发中心",
    "tenant-001/od-001",
    "示例组织/研发中心/后端组",
    "tenant-001/od-001/od-002"
  ]
}
```

组权限配置必须使用完整路径。不能再只配置叶子节点 `后端组` 或 `od-002`，否则不同组织的同名
部门可能产生歧义。路径段中的 `%` 转义为 `%25`，`/` 转义为 `%2F`。

## 模型差异

### 用户模型

| 字段 | v1 | v2 |
| --- | --- | --- |
| `id` | 无 | 随机 UUID，区分删除重建生命周期，不作为 OIDC Claim |
| `sub` | OIDC 主体标识 | 保持，仍是稳定外部标识 |
| `groups` | `string[]` | `UserGroup[]` 树 |
| `status` | 无 | 账号状态，旧数据默认 `active` |
| `roles` | 无 | 平台角色数组 |
| `lastLoginAt` | 无 | 最近登录时间 |
| `lastSyncedAt` | 无 | 最近 Provider 同步时间 |
| `providerProfile` | 无 | Provider 原始档案快照 |

`id` 和 `sub` 不可互换。Client、审计查询和 OIDC Claims 继续使用 `sub`；内部生命周期保护可以使用
随机 `id` 判断“同一个 `sub` 是否已被删除后重建”。

### 应用、审计和 Provider Token 模型

v2 新增了 v1 不存在的持久化模型：

- 应用、OIDC Client、Client Secret 版本和应用审计事件。
- 用户登录、退出、创建、更新和删除审计日志。
- 上游 Provider Access Token、Refresh Token、过期时间、状态和 CAS 修订号。
- 管理后台与门户 BFF Session 及其撤销代际。

这些模型没有可从 v1 导入的数据。启用对应模块时应让 v2 自己创建数据库，并配置独立的加密密钥。
应用密钥和 Provider Token 使用 AES-256-GCM 静态加密；丢失主密钥后不能仅靠数据库恢复明文。

## 关键算法差异

| 场景 | v1 | v2 | 迁移影响 |
| --- | --- | --- | --- |
| 用户 `sub` | `SHA-256(authProvider + ":" + externalId)` | 相同 | Provider 名称和外部 ID 不变即可保持账号关联 |
| 内部生命周期 | 只有 `sub` | 新增随机 UUID `id` | 删除重建后旧认证结果不能绑定到新账号 |
| 用户写入 | 先查再写 | SQLite 事务、PostgreSQL 唯一索引仲裁 | 迁移前必须清理重复 Provider 身份 |
| 飞书分组 | 部门名、部门 ID 平面集合并追加 `Owners` | 组织到部门的树，追加 `Default` | 所有授权和 Gitea 映射需要重配完整路径 |
| 分组路径 | 无层级、无转义 | 名称路径和 ID 路径，深度最多 32，转义 `%` 和 `/` | 不要自行用字符串拼接路径 |
| OAuth state | `get` 后 `delete` | 原子 `take`，并支持容量限制 | 并发回调不能重复消费同一 state |
| 登录失败计数 | 进程内基础校验 | 带 TTL 的原子计数和账号锁定 | 多实例必须使用共享 Redis State Store |
| Consent | 所有 Client 自动批准 | 静态 Client/受信任一方可跳过，第三方显式批准 | 数据库应用首次授权会显示同意页 |
| PKCE | 无额外强制策略 | 公共 Client 和 `require_pkce` Client 强制 S256 | 自定义公共 Client 必须实现 PKCE |
| 会话撤销 | 主要依赖 OIDC Provider 默认行为 | 用户、Client 和 BFF Session 撤销代际及写入屏障 | 不应复用 v1 OIDC 运行数据 |
| Token 并发刷新 | 无 Provider Token 模型 | CAS 修订号防止旧刷新结果覆盖新 Token | Provider API 数据只能由 v2 管理 |
| 配置失败 | 部分加载错误可能回退开发默认值 | 生产缺失或非法配置直接失败 | 先在预发布环境完成配置校验 |

## Gitea 迁移验证

### 更新认证源

如果 Issuer 和 Client 信息未变化，Gitea 认证源通常只需要核对，无需重新创建。至少确认：

| Gitea 配置项 | v2 建议值 |
| --- | --- |
| OAuth2 提供程序 | OpenID Connect |
| 自动发现 URL | `https://id.example.com/oidc/.well-known/openid-configuration` |
| Scopes | `openid profile email` |
| 全名 Claim | `name` |
| 用户组 Claim | 需要团队映射时填写 `groups` |
| 组到组织团队映射 | 使用 v2 输出的完整名称路径或完整 ID 路径 |

Gitea 1.24 至 1.27 的字段存在版本差异。启用 v2 应用管理后，可通过对应版本的 Gitea 模板生成
配置；首次迁移仍建议保留静态 Client，待核心登录稳定后再切换应用事实源。

### 必测场景

1. 发现文档的 `issuer`、授权端点、Token 端点、退出端点和 JWKS 地址均为 HTTPS 公开地址。
2. 本地应急管理员可以登录，但连续错误密码会触发锁定。
3. 飞书用户首次登录后，用户表出现组织/部门树和 `lastSyncedAt`。
4. ID Token 或 UserInfo 中的 `sub` 与 v1 相同。
5. `groups` 同时包含名称完整路径和 ID 完整路径。
6. Gitea 能创建或关联原用户，并正确同步组织/团队。
7. Gitea 退出时返回已登记的 `post_logout_redirect_uri`，不出现
   `post_logout_redirect_uri not registered`。
8. 已禁用用户不能继续登录，已有会话和 Refresh Token 不能恢复访问。
9. 重放同一授权码或 OAuth state 会失败。
10. 重启 v2 后用户、JWKS 和所需 OIDC 数据均来自持久化存储。

发现文档检查示例：

```bash
curl --fail --silent --show-error \
  https://id.example.com/oidc/.well-known/openid-configuration \
  | jq '{issuer, authorization_endpoint, token_endpoint, end_session_endpoint, jwks_uri}'
```

## 切换步骤

1. 在预发布环境使用生产配置结构和数据库副本完成全量验证。
2. 宣布维护窗口，停止 v1 入口并确认没有继续写入。
3. 备份 v1 配置、用户库、OIDC 存储和 JWKS。
4. 复制用户库和 JWKS 到 v2 专用目录；创建空的 v2 OIDC 存储。
5. 写入 `x-oidc.config.js` 或 `x-oidc.config.json`，使用密钥注入而不是明文提交。
6. 启动 v2，检查配置校验、用户库迁移和唯一索引日志。
7. 在切流前直接请求发现文档，并完成本地管理员和测试 Client 登录。
8. 切换反向代理流量。
9. 让飞书和其他外部 Provider 用户重新登录，重建树形分组。
10. 验证 Gitea 登录、用户关联、团队同步、刷新令牌和退出登录。
11. 观察一个完整的最大会话或 Token 周期，再决定是否清理 v1 运行数据。
12. 核心链路稳定后，再分批启用后台、门户、应用管理和 Provider API。

## 回滚步骤

1. 立即停止 v2 写入并从反向代理摘除 v2。
2. 恢复迁移前的 v1 用户数据库，不要直接把已由 v2 写入的用户库交给 v1。
3. 恢复 v1 的 OIDC 存储、JWKS、配置文件和原进程工作目录。
4. 启动 v1 并验证发现文档、登录和 Gitea 回调。
5. 将流量切回 v1。
6. 保存 v2 日志和失败数据库副本用于排查，不要覆盖最后一份 v1 备份。

回滚不会撤销已经被下游系统接受的身份变化。若迁移期间改变了 Issuer、Client ID、`sub` 或组映射，
还需要在 Gitea 等 Client 中恢复对应配置。

## 迁移完成标准

- v2 使用 `x-oidc.config.js` 或 `x-oidc.config.json`，生产启动无配置警告。
- `server.url`、`oidc.issuer`、反向代理和所有回调 URL 一致。
- 用户库不存在重复 Provider 身份，旧记录均具有非空随机 `id`。
- 活跃用户已经重新登录，关键用户的 `groups_tree` 和完整路径 `groups` 正确。
- 至少一个本地应急管理员可用，后台不依赖旧 `Owners` 默认组。
- Gitea 的登录、刷新、退出和团队映射全部通过。
- v2 使用新的 OIDC 运行存储，v1 与 v2 不共享写入目标。
- JWKS、数据库、密码文件和加密密钥已纳入备份与恢复演练。
- 审计保留期符合要求，默认 30 天的自动清理已纳入容量评估。
- 回滚步骤在预发布环境中验证完成。

更多生产配置、Gitea 字段和运维方式见：

- [生产部署指南](./PRODUCTION_SETUP.md)
- [Gitea 接入指南](./GITEA_INTEGRATION.md)
- [生产运维手册](./OPERATIONS.md)
- [应用管理接入指南](./APPLICATION_MANAGEMENT.md)
- [管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)
