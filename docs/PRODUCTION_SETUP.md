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
# 定期备份数据库
cp oidc.db oidc.db.backup.$(date +%Y%m%d)
```

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
```

### 2. 文件权限

在 Linux/Unix 系统上,限制文件访问权限:

```bash
chmod 600 jwks.json
chmod 600 oidc.db
```

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

在 `gitea-oidc.config.json` 中配置生产环境参数:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "https://idp.example.com",
    "trustProxy": true
  },
  "oidc": {
    "issuer": "https://idp.example.com",
    "cookieKeys": [
      "your-strong-random-key-1",
      "your-strong-random-key-2"
    ]
  }
}
```

**重要配置项:**

- `server.url`: 使用 HTTPS 和实际域名
- `server.trustProxy`: 在反向代理后必须设为 `true`
- `oidc.issuer`: 必须与 `server.url` 一致
- `oidc.cookieKeys`: 使用强随机密钥

### 5. 生成强随机密钥

Cookie 密钥生成示例:

```bash
# 使用 OpenSSL 生成随机密钥
openssl rand -base64 32
```

## 部署检查清单

在部署到生产环境前,请确认:

- [ ] ✅ 已生成 `jwks.json` 文件
- [ ] ✅ `jwks.json` 已添加到 `.gitignore`
- [ ] ✅ `oidc.db` 已添加到 `.gitignore`
- [ ] ✅ 文件权限已正确设置 (600)
- [ ] ✅ 配置文件使用 HTTPS URL
- [ ] ✅ 配置文件使用强随机 Cookie 密钥
- [ ] ✅ 反向代理配置正确 (`trustProxy: true`)
- [ ] ✅ 已设置数据库备份策略
- [ ] ✅ 已设置密钥轮换计划

## 多实例部署

如果需要部署多个实例(负载均衡):

### 方案 1: 共享文件系统

将 `oidc.db` 和 `jwks.json` 放在共享文件系统上(如 NFS):

```bash
# 所有实例使用相同的文件
/shared/oidc.db
/shared/jwks.json
```

### 方案 2: 使用 PostgreSQL (推荐)

未来版本将支持 PostgreSQL 适配器,适合大规模部署。

## 故障排除

### 问题 1: 服务重启后用户需要重新登录

**原因:** JWKS 密钥在每次启动时重新生成

**解决:** 确保 `jwks.json` 文件存在且持久化

### 问题 2: 数据库文件损坏

**原因:** 服务异常终止或磁盘空间不足

**解决:**

```bash
# 恢复备份
cp oidc.db.backup.20240101 oidc.db

# 或删除数据库重新开始
rm oidc.db*
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
