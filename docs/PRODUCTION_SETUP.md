# 生产环境配置指南

本文档说明如何配置 gitea-oidc 以适用于生产环境,解决开发环境警告。

## 问题说明

在开发环境中,你可能会看到以下警告:

```
oidc-provider WARNING: a quick start development-only in-memory adapter is used
oidc-provider WARNING: a quick start development-only signing keys are used
```

这些警告表明:

1. **内存适配器**: 所有 OIDC 状态数据存储在内存中,服务重启后会丢失
2. **临时签名密钥**: 使用临时生成的密钥,服务重启后所有已签发的 token 会失效

## 解决方案

### 1. 持久化存储适配器 ✅

项目已自动配置使用 SQLite 持久化适配器,无需额外配置。

**特性:**

- ✅ 数据持久化到 `oidc.db` 文件
- ✅ 服务重启后数据不丢失
- ✅ 自动清理过期数据
- ✅ 支持所有 OIDC 操作

**数据库文件位置:**

```
./oidc.db          # 主数据库文件
./oidc.db-shm      # 共享内存文件
./oidc.db-wal      # 预写日志文件
```

**备份建议:**

```bash
# 先停止唯一实例，再归档完整数据目录
docker stop gitea-oidc
tar -C /srv/gitea-oidc/data -czf /srv/backup/gitea-oidc-data-YYYYMMDD.tar.gz .
docker start gitea-oidc
```

运行中直接复制 `oidc.db` 可能遗漏 WAL 中尚未 checkpoint 的事务。不能停机时，使用 SQLite
Online Backup API 或 `sqlite3 .backup`；不要只复制主数据库而忽略 `-wal`、`-shm` 文件。

### 2. 持久化 JWKS 签名密钥 ✅

项目已自动配置 JWKS 密钥管理,首次启动时会自动生成密钥。

#### 配置 JWKS

在配置文件中可以自定义 JWKS 设置:

```json
{
  "jwks": {
    "filePath": "./jwks.json",  // JWKS 文件路径
    "keyId": "default-key"       // 密钥 ID (kid)
  }
}
```

配置说明:

- `filePath`: JWKS 文件保存路径,默认 `./jwks.json`
- `keyId`: 密钥标识符,用于密钥轮换,默认 `default-key`

#### 自动生成(推荐)

首次启动服务时,系统会自动生成 `jwks.json` 文件:

```bash
pnpm start
```

在 Linux/Unix 系统上，自动生成和手动生成的 JWKS 文件会被写成 `0600` 权限；加载已有
JWKS 文件时，如果发现 group/other 访问位，也会在读取前收紧到 `0600`。

输出示例:

```
🆕 JWKS 文件不存在,正在生成新密钥...
🔐 正在生成 RSA 密钥对...
✅ JWKS 已保存到: /path/to/jwks.json
⚠️  请妥善保管此文件,不要提交到版本控制系统!
```

#### 手动生成

如果需要手动生成密钥:

```bash
# 使用默认配置生成
pnpm tsx scripts/generate-jwks.ts

# 指定输出路径和密钥 ID
pnpm tsx scripts/generate-jwks.ts ./my-jwks.json my-key-id
```

#### JWKS 文件格式

生成的 `jwks.json` 文件包含 RSA 密钥对:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "...",
      "e": "AQAB",
      "d": "...",
      "p": "...",
      "q": "...",
      "dp": "...",
      "dq": "...",
      "qi": "...",
      "kid": "key-1234567890",
      "alg": "RS256",
      "use": "sig"
    }
  ]
}
```

## 安全最佳实践

### 1. 保护敏感文件

确保以下文件已添加到 `.gitignore`:

```gitignore
# OIDC 持久化文件 (包含敏感数据)
jwks.json
oidc.db
oidc.db-shm
oidc.db-wal
applications.db
applications.db-shm
applications.db-wal
users.db
users.db-shm
users.db-wal
```

### 2. 文件权限

在 Linux/Unix 系统上,限制文件访问权限:

```bash
chmod 600 jwks.json
chmod 600 oidc.db
chmod 600 applications.db
chmod 600 users.db
```

`jwks.json` 包含签名私钥。服务会自动收紧该文件权限，但部署时仍应确认它没有被提交到镜像、
仓库或共享给非服务运行用户。

### 3. 密钥轮换

定期轮换 JWKS 密钥以提高安全性:

```bash
# 1. 备份旧密钥
mv jwks.json jwks.json.old

# 2. 生成新密钥
pnpm tsx scripts/generate-jwks.ts

# 3. 重启服务
pnpm start
```

**注意:** 密钥轮换后,使用旧密钥签发的 token 将无法验证,用户需要重新登录。

### 4. 生产环境配置

生产环境启动时必须提供 `gitea-oidc.config.js` 或 `gitea-oidc.config.json`。
当 `NODE_ENV=production` 且两个配置文件都不存在时，服务会拒绝启动，避免误用开发默认
Cookie key、客户端密钥和本地 URL。
生产环境配置验证还会阻止以下高风险配置继续启动：

- `server.url` 不是 HTTPS 公网地址、包含 query/fragment，或 `oidc.issuer` 没有等于
  `${server.url}/oidc`、包含 query/fragment。
- 客户端 `redirect_uris` 或 `post_logout_redirect_uris` 使用非 HTTPS 地址。
- `oidc.cookieKeys` 使用示例默认值，或客户端 `client_secret` 太短、仍是示例默认值。
- 启用内置后台但没有任何 OIDC client 的 `redirect_uris` 包含
  `${server.url}${admin.basePath}/callback`，或该 client 不支持授权码流程和
  `client_secret_basic`。
- `server.corsOrigins` 中配置了非 HTTPS Origin，或包含 path、query、fragment。
- 用户仓储或 OIDC 适配器使用 `memory`。
- 启用应用管理但没有同时使用 `applications.clientSource: "database"`，应用仓储使用
  `memory` 或 `:memory:`，或者 OIDC Adapter 不是 SQLite。
- `oidc.features.devInteractions.enabled` 为 `true`，或启用了 `trustProxy` 但没有将其限制为
  实际反向代理的 IP/CIDR。
- 启用本地认证但未配置 `passwordFile`，或 `passwordFormat` 不是 `bcrypt`。
- 启用的 Provider API provider 配置了非 HTTPS `baseUrl`，或 `baseUrl` 带用户名、密码、
  query、fragment 等不稳定边界。

在 `gitea-oidc.config.json` 中配置生产环境参数:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "https://idp.example.com",
    "trustProxy": true,
    "trustedProxyIps": ["127.0.0.1"],
    "corsOrigins": ["https://app.example.com"]
  },
  "oidc": {
    "issuer": "https://idp.example.com/oidc",
    "cookieKeys": [
      "your-strong-random-key-1",
      "your-strong-random-key-2"
    ]
  }
}
```

**重要配置项:**

- `server.url`: 使用 HTTPS 和实际域名，不能包含 query 或 fragment
- `server.trustProxy`: 在反向代理后必须设为 `true`
- `server.trustedProxyIps`: 仅列出实际反向代理的 IP 或 CIDR；不要对公网客户端无条件信任
  `X-Forwarded-*` 请求头
- `server.corsOrigins`: 默认空数组；只有浏览器端跨域调用 SDK 或 Provider API 时才列出精确
  HTTPS Origin，不能包含 path、query 或 fragment
- `oidc.issuer`: 必须等于 `${server.url}/oidc`，和服务端固定 `/oidc` 挂载路径一致，不能包含
  query 或 fragment
- `oidc.cookieKeys`: 使用强随机密钥，不能保留示例默认值
- `clients[].client_secret`: 生产环境至少 16 字符，不能保留示例默认值
- `auth.providers.local.config.passwordFormat`: 生产环境启用本地认证时必须显式设置为
  `bcrypt`，不要使用 `auto`、`md5` 或 `sha`
- 本地认证默认连续失败 5 次后锁定账号 15 分钟，可通过
  `auth.providers.local.config.lockoutPolicy` 调整；认证失败始终返回统一的“用户名或密码错误”
  信息，避免枚举账号。不存在的用户名不会创建失败状态，已存在账号的失败计数保存到
  `auth.stateStore`
- `oidc.features.devInteractions.enabled`: 必须保持 `false`；它仅用于本地调试，生产环境会被
  配置校验直接拒绝
- `applications.secretEncryption.masterKey`: 启用应用管理时必须是 Base64/Base64URL 编码的
  32 字节独立主密钥，不能复用 Cookie 或 Provider token 加密密钥

### 5. 管理后台与 Provider API 安全配置

启用内置管理后台或 Provider API 前，确认以下配置：

- `admin.allowedGroups` 使用专用后台组名，例如 `gitea-oidc-admins`，不要复用普通团队名。
- `providerApi.enabled` 默认关闭；只有确实需要代理飞书、钉钉等平台 API 时才开启。
- 开启 `providerApi.enabled` 时，`providerApi.tokenEncryptionKey` 必须是至少 32 字符的随机值。
- 开启 Provider API SDK 代理时，`providerApi.allowedClientIds` 必须列出允许调用代理的
  OIDC `client_id`，避免任意 OIDC 客户端复用用户 access token 调用 Provider API。
- `providerApi.requestTimeoutMs` 控制第三方 Provider 出站请求超时时间，默认 `10000` 毫秒；
  生产环境不要配置得过大，避免慢连接或无响应 Provider 长时间占用请求处理资源。
- `providerApi.responseBodyLimitBytes` 控制读取第三方响应体的最大字节数，默认 `1048576`
  字节；生产环境不要配置得过大，避免异常大响应占用服务端内存。
- 后台 HTTPS 部署会给 session cookie 追加 `Secure`，同时要求 `server.url` 使用公网 HTTPS
  地址且 `oidc.issuer` 等于 `${server.url}/oidc`。
- 统一登录页 `/interaction/:uid` 会设置 CSP、frame、nosniff 和 referrer 安全头；如果扩展
  自定义认证 Provider，`renderLoginUI()` 返回的 raw HTML 片段应视为可信代码并自行保持转义。
- Provider API 的 `allowedOperations` 只开放必要操作，实际 `method` 和 `path` 由服务端定义。
- 启用的 Provider API provider 的 `baseUrl` 必须是 HTTPS，且不能包含用户名、密码、query 或
  fragment，避免第三方 token 通过明文或混淆 URL 出站。
- Provider API 不会默认对任意 Origin 开放 CORS；如需浏览器 SDK 跨域访问，只在
  `server.corsOrigins` 中配置可信前端 Origin。

更多用法见 [管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)。

应用控制面配置、一次性凭据、SQLite volume 和备份要求见
[应用管理接入指南](./APPLICATION_MANAGEMENT.md)。

### 6. 生成强随机密钥

Cookie 密钥生成示例:

```bash
# 使用 OpenSSL 生成随机密钥
openssl rand -base64 32
```

## 部署检查清单

在部署到生产环境前,请确认:

- [ ] ✅ 已生成 `jwks.json` 文件
- [ ] ✅ 已提供 `gitea-oidc.config.js` 或 `gitea-oidc.config.json`
- [ ] ✅ `jwks.json` 已添加到 `.gitignore`
- [ ] ✅ `oidc.db` 已添加到 `.gitignore`
- [ ] ✅ 启用应用管理时，`applications.db` 已放入持久化 volume 并加入 `.gitignore`
- [ ] ✅ 应用主密钥已放入外部 Secret Manager，并与数据库一起纳入恢复演练
- [ ] ✅ 文件权限已正确设置 (600)
- [ ] ✅ 配置文件使用 HTTPS URL
- [ ] ✅ 配置文件使用强随机 Cookie 密钥
- [ ] ✅ 反向代理配置正确 (`trustProxy: true`)
- [ ] ✅ 已设置数据库备份策略
- [ ] ✅ 已设置密钥轮换计划

## 多实例部署

如果需要部署多个实例(负载均衡):

多实例必须使用 Redis OIDC 适配器和 Redis `auth.stateStore`；后者同时保存 OAuth state、
一次性回调结果、后台会话和本地登录失败计数。SQLite 文件（包括 NFS）只支持单实例，不能
作为并发多节点的 OIDC 存储。

当前应用管理的 `clientSource=database` 模式强制使用 SQLite OIDC Adapter 和 SQLite
ApplicationRepository，因此不能多实例部署。需要多实例时必须保持
`applications.enabled: false`、`applications.clientSource: "config"`，直到共享
ApplicationRepository 落地。

```json
{
  "adapter": {
    "type": "redis",
    "redis": { "url": "redis://redis:6379", "keyPrefix": "oidc:" }
  },
  "auth": {
    "stateStore": {
      "type": "redis",
      "redis": { "url": "redis://redis:6379", "keyPrefix": "gitea-oidc:state:" }
    }
  }
}
```

所有实例仍必须共享同一个持久化 `jwks.filePath`；首次创建采用文件锁和原子重命名，避免并发
启动时写入不同签名密钥。

## 故障排除

### 问题 1: 服务重启后用户需要重新登录

**原因:** JWKS 密钥在每次启动时重新生成

**解决:** 确保 `jwks.json` 文件存在且持久化

### 问题 2: 数据库文件损坏

**原因:** 服务异常终止或磁盘空间不足

**解决:**

```bash
# 停止服务后恢复到空的数据目录，再使用备份时对应的密钥启动
docker stop gitea-oidc
tar -C /srv/gitea-oidc/data -xzf /srv/backup/gitea-oidc-data-YYYYMMDD.tar.gz
docker start gitea-oidc

# 只在确认可以丢弃全部 OIDC 状态时，才删除数据库重新开始
# rm oidc.db*
```

### 问题 3: 警告仍然出现

**检查:**

1. 确认代码已更新到最新版本
2. 确认 `jwks.json` 文件存在
3. 查看服务启动日志

## 监控建议

建议监控以下指标:

1. **数据库大小**: 定期检查 `oidc.db` 文件大小
2. **过期数据清理**: 确认自动清理任务正常运行
3. **密钥有效期**: 记录密钥生成时间,定期轮换

## 相关文档

- [OIDC Provider 配置](https://github.com/panva/node-oidc-provider/blob/main/docs/README.md)
- [SQLite 最佳实践](https://www.sqlite.org/bestpractice.html)
- [JWKS 规范](https://datatracker.ietf.org/doc/html/rfc7517)
