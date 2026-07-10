# 应用管理接入指南

应用管理把 OIDC Client 从纯静态 `clients[]` 配置迁移为后台控制面。管理员可以在管理后台创建
自定义应用、一次获取接入凭据，并启用或停用应用。当前能力属于 P2：只支持自定义应用和单实例
SQLite 部署；Gitea 模板、Node SDK、框架连接器和 CLI 尚未开放。

## 启用前提

启用应用管理时，以下配置必须同时满足：

- `applications.enabled` 为 `true`，且 `applications.clientSource` 为 `database`。
- `applications.repository.type` 为 `sqlite`。`memory` 仅供开发和测试，生产环境会拒绝启动。
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

推荐使用 `gitea-oidc.config.js` 从环境变量读取主密钥。把下面片段合并进完整生产配置：

```javascript
const applicationMasterKey = process.env.GITEA_OIDC_APPLICATION_MASTER_KEY;

if (!applicationMasterKey) {
  throw new Error("缺少 GITEA_OIDC_APPLICATION_MASTER_KEY");
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

数据库模式启动时，服务会把 `clients[]` 幂等导入为 system application，然后向
`oidc-provider` 传入空的静态 Client 列表。后续认证只查询 ApplicationRepository，不会在
`clients[]` 和数据库之间混合查询或双写。`clients[]` 在当前迁移期仍是系统 Client 的启动导入
源，不能删除管理后台所需 Client。

导入后的 system application 会在管理台展示，但只能通过部署配置管理，管理 API 和页面不会允许
启用或停用它们。这一约束用于保护管理后台 Client，避免管理员把自己的登录入口永久锁死。配置中
的 Client 元数据或 Secret 与已导入快照不一致时，服务会 fail closed，要求先执行显式迁移。

## 在管理后台创建应用

1. 使用 `admin.allowedGroups` 允许的管理员登录 `${server.url}${admin.basePath}`。
2. 打开“应用”页面，默认路径为 `/admin/applications`。
3. 创建自定义应用，选择环境、Client 类型、Redirect URI、scopes 和是否启用 Refresh Token。
4. 立即复制创建结果中的 Issuer、Client ID 和一次性凭据。
5. 把 Client Secret 保存到业务应用的 Secret Manager，再按页面返回的公开连接参数配置 OIDC
   客户端。

生产和预发布 Redirect URI 必须使用 HTTPS。开发环境只允许 loopback 地址使用 HTTP，URI 不能
包含通配符、fragment 或用户凭据。所有应用必须包含 `openid` scope；公共 Client 不生成
Client Secret，并强制使用 PKCE S256。

第三方自定义应用默认使用显式 consent。只有受信任的 first-party 应用才能配置
`skip_for_trusted`，当前后台表单不会把普通自定义应用提升为 first-party。

禁用自定义应用时，服务会先封锁关联 Client 的新授权记录写入，再持久化 `disabling` 状态并撤销
已有 Grant、Code 和 Token；撤销完成后才进入 `disabled`。如果进程在中途退出，下次启动会继续
恢复未完成的撤销。system application 不参与该管理流程。

## 一次性凭据语义

confidential Client 的明文 Client Secret 只出现在首次创建响应中。相同
`Idempotency-Key` 的安全重放只返回 `already_delivered`，不会再次展示密钥。创建响应必须按
敏感数据处理，不能写入日志、审计、指标或错误上报。

如果首次响应丢失，当前版本不能重新下载或轮换 Secret。应禁用该应用并重新创建；不要尝试从
`applications.db` 或管理 API 读取密文。public Client 不使用 Client Secret。

## SQLite 单实例与持久化

应用数据库和 OIDC Adapter 当前必须同时使用本地 SQLite，因此启用应用管理后只能运行一个
服务实例。不要把 SQLite 文件放在 NFS 上，也不要让多个 Pod 或容器分别挂载自己的
`applications.db`。多实例应用管理要等共享 ApplicationRepository 落地后再启用。

Docker 部署应把所有持久化文件放到同一个受保护 volume，例如：

```bash
docker run -d --name gitea-oidc -p 3000:3000 \
  -e NODE_ENV=production \
  --env-file /srv/gitea-oidc/gitea-oidc.env \
  -v /srv/gitea-oidc/data:/app/data \
  -v /srv/gitea-oidc/gitea-oidc.config.js:/app/gitea-oidc.config.js:ro \
  lydamirror/gitea-oidc:latest
```

如果部署平台没有 Secret Manager，至少把 env 文件权限设为 `0600`，并排除在镜像、备份日志和
版本控制之外。不要把主密钥直接写进 shell 命令历史。

至少持久化以下数据；实际文件由配置路径决定：

- `applications.db`：应用、Client、加密 Secret、幂等记录和审计。
- `oidc.db`：授权码、Token、Grant 和会话等 OIDC 数据。
- `users.db`：使用 SQLite 用户仓储时的用户数据。
- `jwks.json`：Token 签名私钥。

应用主密钥应留在外部 Secret Manager，不要写入 volume。备份和恢复时必须使用同一把主密钥。

## 备份与恢复

最简单的一致性备份方式是先停止唯一实例，再归档整个数据 volume：

```bash
docker stop gitea-oidc
tar -C /srv/gitea-oidc/data -czf /srv/backup/gitea-oidc-data-YYYYMMDD.tar.gz .
docker start gitea-oidc
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

## 当前 P2 边界

当前已经提供自定义应用、ApplicationRepository、Secret 加密、审计、Client Adapter、
`clientSource` 整源切换、一次性直接凭据和管理页面。以下能力尚未完成：

- Gitea 等版本化应用模板及专属配置向导。
- `@gitea-oidc/node`、Express、Fastify、NestJS 连接器。
- setup code、CLI `init` 和 `doctor`。
- Client Secret 轮换、撤销和外部 KMS 轮换协议。
- 多实例共享 ApplicationRepository。

在这些能力发布前，业务应用应使用成熟的标准 OIDC 客户端库消费管理后台给出的 Issuer、
Client ID、Client Secret、Redirect URI、scopes 和 PKCE 策略。
