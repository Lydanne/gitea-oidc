# 生产运维手册

本文面向值班、发布和故障处理人员，说明 gitea-oidc 上线后的启动停止、健康检查、备份恢复、
升级回滚、监控和密钥轮换。首次部署请先完成[生产部署指南](./PRODUCTION_SETUP.md)。

## 运行时约定

- 生产入口为 `node apps/idp-server/dist/main.js`，根脚本 `pnpm start` 运行同一入口。
- 进程响应 `SIGTERM` 和 `SIGINT`，先关闭 HTTP 服务和运行时资源；默认 10 秒未完成会强制退出。
- Docker Compose 应保留至少 20 秒 `stop_grace_period`。
- 生产环境缺少配置文件或配置校验失败时，进程退出码非零，不会回退到开发默认值。
- 配置文件必须位于进程工作目录，JS 配置优先于 JSON 配置。

## 日常操作

以下命令假设部署目录为 `/srv/gitea-oidc`：

```bash
cd /srv/gitea-oidc

docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=200 idp
docker compose --env-file .env.production restart idp
docker compose --env-file .env.production stop idp
docker compose --env-file .env.production up -d idp
```

不要使用 `docker kill` 作为日常停止方式。只有进程无法在宽限期内退出时才强制终止，并在恢复后
检查 SQLite、Redis 和日志状态。

## 健康检查

项目目前没有独立的 `/healthz` 或指标端点。使用 OIDC 发现文档作为存活与就绪检查：

```bash
curl --fail --silent --show-error \
  https://id.example.com/oidc/.well-known/openid-configuration | jq -e \
  '.issuer == "https://id.example.com/oidc"'
```

同时检查 JWKS：

```bash
curl --fail --silent --show-error \
  https://id.example.com/oidc/jwks | jq -e '.keys | length > 0'
```

探针不应自动发起完整登录，也不要在监控系统中保存授权码、Cookie、Token 或 Client Secret。

### 发布后冒烟测试

每次发布至少验证：

1. 容器或进程状态稳定，没有反复重启。
2. 发现文档的 Issuer 和所有公开端点使用正确 HTTPS 域名。
3. JWKS 可访问，且 `kid` 与预期一致。
4. 管理后台可以打开并登录。
5. 测试 Gitea Client 可以完成登录。
6. Gitea 退出后回到已注册的 Post Logout Redirect URI。
7. 启用 Provider API 时，使用允许的 Client 完成一次最小只读调用。

## 日志管理

生产环境建议使用 `info`，排障窗口可以临时使用 `debug`，完成后恢复。日志可能包含请求路径、错误
摘要和字段名，但不应记录密码、Token、Client Secret、Cookie Key、Provider Secret 或 JWKS
私钥。

常用检查：

```bash
docker compose --env-file .env.production logs --since=30m idp
docker compose --env-file .env.production logs --since=30m idp \
  | rg "配置验证失败|服务器启动失败|OIDC|Redis|SQLite|JWKS"
```

将容器日志接入集中式日志平台时，配置容量和保留周期，并对未经验证的请求参数继续按敏感数据处理。

## 审计日志管理

身份审计默认启用，记录用户登录和退出、管理后台登录和退出，以及用户创建、更新和删除事件。
在 `/admin/audit-logs` 可按用户、事件、结果和时间筛选。这里的审计记录与普通进程日志不同：它们是
结构化业务记录，并随用户仓储持久化。

成功登录以 OIDC 最终授权响应为准，不以 Provider 凭据校验通过为准；已有 SSO Session 登录新
Client 也会产生记录。没有命中本服务签发 state 的匿名 callback 请求不会写入结构化审计，应在反向
代理或网关继续限制公开回调的请求频率。

上线前确认：

- `audit.enabled` 为 `true`。
- `audit.retentionDays` 满足合规要求，默认是 `30` 天，可配置范围是 `1` 到 `3650` 天；超过期限的
  记录会自动删除。
- `auth.userRepository` 使用 SQLite 或 PostgreSQL；`memory` 重启后会丢失审计记录。
- 反向代理配置可信代理范围，避免审计 IP 被不可信转发头伪造。
- 数据库备份、访问控制和清理策略覆盖审计表。

服务在新事件写入时至多每小时执行一次过期清理。磁盘容量告警不能只观察 OIDC Adapter 数据，
还要观察用户数据库中的 `audit_logs`。审计失败不会中断用户登录或资料更新，因此应同时监控
`Failed to persist audit log`、`记录 OIDC 登录失败`、`写入管理端事件失败` 和
`记录用户变更失败` 等错误。

审计记录不会保存密码、Token、Cookie、Client Secret、用户资料新旧值或 Provider 原始档案。
它仍可能包含用户标识、用户名、IP 和 User-Agent，应按个人信息限制读取、导出和备份权限。

## 单实例 SQLite 备份

一致性最强、最容易恢复的方式是停止唯一实例后归档整个数据目录：

```bash
cd /srv/gitea-oidc
docker compose --env-file .env.production stop idp
BACKUP_FILE="/srv/gitea-oidc/backup/data-$(date +%Y%m%d-%H%M%S).tar.gz"
sudo tar -C /srv/gitea-oidc/data \
  -czf "$BACKUP_FILE" .
sudo chmod 0600 "$BACKUP_FILE"
docker compose --env-file .env.production up -d idp
```

数据目录通常包含：

- `users.db`：SQLite 用户仓储和身份审计日志。
- `oidc.db`：授权码、Token、Grant、Session 和撤销状态。
- `applications.db`：应用、加密 Client Secret、幂等记录和应用控制面审计记录。
- `jwks.json`：OIDC Token 签名私钥。

运行中直接复制单个 `.db` 文件可能遗漏 WAL 中尚未 checkpoint 的事务。不能停机时，应使用
SQLite Online Backup API 或受支持的快照机制，对所有数据库获取同一恢复点；不要只复制主文件而
忽略 `-wal` 和 `-shm`。

配置、环境变量、密码文件和应用主密钥也需要备份，但应与数据归档分开加密保存，并限制恢复权限。
数据库备份没有对应的应用主密钥时，应用 Client Secret 无法解密。

## Redis 和 PostgreSQL 备份

多实例部署应使用基础设施自身的备份能力：

- PostgreSQL 使用受验证的逻辑备份或物理备份，并记录恢复点。
- Redis 启用符合业务 RPO 的 AOF 或 RDB 持久化，使用 `noeviction`，并监控持久化失败。
- 备份前确认 Redis OIDC 数据和 stateStore 均在范围内。
- 不要用 `KEYS *`、`FLUSHDB` 或手工复制 Redis 数据目录作为生产备份流程。
- 仍要单独备份并安全分发同一份 `jwks.json`、配置和密钥。

Redis 中的短期 state 可以过期，但 OIDC Grant、Refresh Token、撤销屏障等数据丢失会改变认证和
退出语义，不能把 Redis 当成可随意清空的缓存。

## 恢复演练

SQLite 恢复流程：

```bash
cd /srv/gitea-oidc
docker compose --env-file .env.production stop idp
sudo mv data "data.failed-$(date +%Y%m%d-%H%M%S)"
sudo install -d -m 0700 data
sudo tar -C data -xzf backup/data-YYYYMMDD-HHMMSS.tar.gz
docker compose --env-file .env.production up -d idp
```

恢复时必须同时使用备份对应的配置、JWKS、应用主密钥和 Provider Token 加密密钥。恢复后执行：

1. 发现文档和 JWKS 检查。
2. 管理员登录。
3. 应用列表和用户列表读取。
4. 测试 Gitea 登录和退出，并在后台确认对应身份审计记录。
5. 测试管理员退出并重新登录，确认后台审计记录。
6. Provider Token 探活（如果启用）。

至少定期在隔离环境中完成一次恢复演练，并记录恢复耗时和数据恢复点。

## 升级流程

生产镜像必须固定版本号。不要直接把 `latest` 作为可回滚的发布标识。

### 升级前

1. 记录当前镜像版本、配置文件校验和、数据库备份名和密钥版本。
2. 阅读目标版本的发布说明和配置变更。
3. 在预发布环境使用生产配置结构完成启动、登录、退出和管理后台测试。
4. 停止唯一 SQLite 实例并完成一致性备份。
5. 保留旧版本镜像，不要提前清理。

### 执行升级

修改 `.env.production` 中的 `GITEA_OIDC_VERSION` 后执行：

```bash
cd /srv/gitea-oidc
docker compose --env-file .env.production config
docker compose --env-file .env.production pull idp
docker compose --env-file .env.production up -d idp
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=200 idp
```

数据库 schema 升级由启动过程执行。启动失败时不会静默丢弃无法迁移的记录；不要反复重启覆盖
现场，应先保存日志并按回滚流程处理。

### 升级后

执行“发布后冒烟测试”，并重点观察：

- 配置验证或数据库迁移错误。
- 容器重启次数。
- 登录、Token 交换和退出错误率。
- SQLite 文件和磁盘空间变化。
- Redis `evicted_keys`、连接错误和持久化状态。

## 回滚流程

数据库经过新版本迁移后，不保证旧版本可以直接读取。安全回滚必须同时恢复旧镜像和升级前数据：

1. 停止当前实例。
2. 保存失败版本的日志和数据目录副本。
3. 恢复升级前的完整数据备份。
4. 恢复与备份匹配的配置和密钥。
5. 将 `GITEA_OIDC_VERSION` 改回原版本。
6. 启动旧版本并执行完整冒烟测试。

不要只切换旧镜像并继续使用已升级数据库。多实例回滚时先停止全部实例，避免新旧版本并行写入同一
存储。

## 密钥轮换

### Cookie Keys

生成新值并放在 `oidc.cookieKeys` 数组首位，保留上一把 Key 作为后续项。等待旧 Cookie 的最长
有效期过去并确认没有回滚需求后，再删除最旧 Key。每次只变更一个环节，并完成后台与 Gitea 登录
验证。

### Client Secret

Client Secret 需要 IdP 和业务 Client 协调切换。应用管理模式通过后台轮换后，新 Secret 只显示
一次；保存后立即更新 Gitea，并完成登录和退出测试。静态模式需要在维护窗口同步更新双方配置。

### JWKS

当前生成流程会创建新的签名 Key 集；直接替换 `jwks.json` 会使仍依赖旧公钥的 Token 无法验证。
只在计划维护窗口或密钥泄露事件中执行，并明确接受用户重新登录。替换前备份旧文件，替换后重启
服务并检查发现文档与 JWKS。

源码部署可在项目根目录生成默认文件：

```bash
pnpm generate-jwks
```

生产 Docker 部署通常让服务在首次启动时写入持久化 `jwks.filePath`，不要在临时容器文件系统中
生成后丢失。

### 应用主密钥和 Provider Token 密钥

当前不提供外部 KMS 历史密文重加密流程。随意修改
`applications.secretEncryption.masterKey` 会导致现有 Client Secret 无法解密；修改
`providerApi.tokenEncryptionKey` 会导致已保存 Provider Token 无法解密。这两类密钥应视为需要
长期备份的恢复材料，不能按普通密码直接替换。

## 监控和告警

至少监控：

- 发现文档可用性、延迟和证书有效期。
- 进程或容器重启次数、退出码和内存占用。
- 登录、Token、Callback 和退出端点的 `4xx`、`5xx` 比例。
- SQLite 数据目录容量、inode、备份成功时间和恢复演练时间。
- PostgreSQL 连接池、慢查询、磁盘和复制状态。
- Redis 连接数、内存、`evicted_keys`、持久化失败和复制状态。
- JWKS 文件是否存在、权限是否正确，以及备份是否包含它。
- Provider Token 探活失败、刷新失败和第三方 API 超时。
- 身份审计写入失败、用户数据库容量和 `audit_logs` 增长速度。

项目当前没有内置 Prometheus 指标端点。需要指标时，应在反向代理、容器平台、数据库和 Redis 层
采集，不要通过修改公开 OIDC 响应来临时暴露内部状态。

## 故障处理

### 服务启动失败

1. 查看最近 200 行日志。
2. 根据错误路径修复配置，不要删除持久化数据碰运气。
3. 确认配置文件位于工作目录，JS 配置是否覆盖了 JSON 配置。
4. 检查环境变量、文件权限、磁盘空间、Redis/PostgreSQL 连通性和 JWKS。
5. 如果发生在升级后，停止重试并按回滚流程恢复。

### 发现文档或端点出现 HTTP

检查 `server.url`、`oidc.issuer`、`trustProxy`、`trustedProxyIps` 和代理转发头。不要通过关闭生产
校验绕过问题。详见[反向代理 HTTPS 配置指南](./REVERSE_PROXY_HTTPS.md)。

### Gitea 退出返回 `post_logout_redirect_uri not registered`

确认错误请求中的 `client_id` 对应应用注册了完全相同的退出回跳 URI，包括末尾 `/`。详见
[Gitea 接入指南](./GITEA_INTEGRATION.md)。

### SQLite 锁定或损坏

确认只有一个实例访问数据目录，且文件不位于 NFS。停止实例、保存现场，并从最近一次已验证备份
恢复。不要在未备份的情况下删除 `*.db`、`-wal` 或 `-shm` 文件。

### Redis 出现逐出键

立即阻止继续逐出，检查 `maxmemory-policy` 是否为 `noeviction`，评估 OIDC 会话和撤销状态是否已
丢失。严重时进入维护窗口、撤销受影响会话并要求重新登录。

## 上线日执行顺序

1. 冻结配置和目标镜像版本。
2. 完成数据与密钥备份，并验证归档可读取。
3. 启动服务，确认配置校验通过。
4. 验证发现文档、JWKS 和 HTTPS 代理。
5. 验证管理员登录和应用列表。
6. 使用测试 Gitea 账号完成登录、退出和组映射。
7. 开启监控和告警，观察一个完整业务窗口。
8. 记录版本、配置校验和、备份点和验收结果。

## 相关文档

- [生产部署指南](./PRODUCTION_SETUP.md)
- [Gitea 接入指南](./GITEA_INTEGRATION.md)
- [应用管理接入指南](./APPLICATION_MANAGEMENT.md)
- [OIDC 适配器配置指南](./ADAPTER_CONFIGURATION.md)
- [管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)
