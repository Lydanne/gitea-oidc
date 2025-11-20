# OIDC Provider 生产环境警告解决方案

## 问题背景

在使用 `oidc-provider` 时,你可能会看到以下两个警告:

```
oidc-provider WARNING: a quick start development-only in-memory adapter is used, 
you MUST change it in order to not lose all stateful provider data upon restart 
and to be able to share these between processes

oidc-provider WARNING: a quick start development-only signing keys are used, 
you are expected to provide your own in the configuration "jwks" property
```

## 问题分析

### 警告 1: 内存适配器 (In-memory adapter)

**原因:**

- 默认使用内存存储所有 OIDC 状态数据(session、token、授权码等)
- 服务重启后所有数据丢失
- 无法在多进程间共享数据

**影响:**

- ❌ 用户登录状态在服务重启后失效
- ❌ 无法进行水平扩展(负载均衡)
- ❌ 不适合生产环境

### 警告 2: 临时签名密钥 (Development signing keys)

**原因:**

- 每次启动时临时生成 JWKS 密钥
- 密钥未持久化

**影响:**

- ❌ 服务重启后,旧 token 无法验证
- ❌ 用户需要重新登录
- ❌ 不符合安全最佳实践

## 解决方案

### ✅ 方案 1: SQLite 持久化适配器

**实现位置:** `src/stores/SqliteOidcAdapter.ts`

**配置方式:**

```typescript
// src/server.ts
const configuration: Configuration = {
  // 使用 SQLite 持久化适配器
  adapter: SqliteOidcAdapter,
  // ... 其他配置
};
```

**特性:**

- ✅ 数据持久化到 `oidc.db` 文件
- ✅ 服务重启后数据不丢失
- ✅ 自动清理过期数据
- ✅ 支持所有 OIDC 操作(upsert, find, consume, destroy 等)

**数据库文件:**

```
oidc.db         # 主数据库文件
oidc.db-shm     # 共享内存文件
oidc.db-wal     # 预写日志文件
```

### ✅ 方案 2: JWKS 密钥管理

**实现位置:** `src/utils/jwksManager.ts`

**功能:**

1. **自动生成密钥** - 首次启动时自动生成 RSA 2048 位密钥对
2. **持久化存储** - 保存到 `jwks.json` 文件
3. **自动加载** - 服务启动时自动加载现有密钥

**使用方式:**

```typescript
// src/server.ts
import { getOrGenerateJWKS } from './utils/jwksManager';

// 加载或生成 JWKS
const jwks = await getOrGenerateJWKS();

const configuration: Configuration = {
  jwks,  // 使用持久化的 JWKS
  // ... 其他配置
};
```

**手动生成密钥:**

```bash
# 使用默认配置
pnpm generate-jwks

# 指定文件路径和密钥 ID
pnpm tsx scripts/generate-jwks.ts ./my-jwks.json my-key-id
```

## 实施步骤

### 1. 代码已集成 ✅

以下代码已自动集成到项目中:

- ✅ `SqliteOidcAdapter` 已配置到 OIDC Provider
- ✅ `getOrGenerateJWKS()` 已在服务启动时调用
- ✅ 相关文件已添加到 `.gitignore`

### 2. 首次启动

直接启动服务即可:

```bash
pnpm start
```

**启动日志示例:**

```
🆕 JWKS 文件不存在,正在生成新密钥...
🔐 正在生成 RSA 密钥对...
✅ JWKS 已保存到: /path/to/jwks.json
[JWKS] 密钥加载完成
OIDC IdP server listening on http://localhost:3000
```

### 3. 验证

启动后检查生成的文件:

```bash
ls -lh jwks.json oidc.db
```

**预期输出:**

```
-rw-------  1 user  staff   4.0K  jwks.json
-rw-r--r--  1 user  staff    20K  oidc.db
```

### 4. 测试

运行测试脚本验证配置:

```bash
./scripts/test-production-setup.sh
```

## 安全最佳实践

### 1. 文件保护

```bash
# 限制文件权限 (仅所有者可读写)
chmod 600 jwks.json
chmod 600 oidc.db
```

### 2. 版本控制

确保敏感文件已添加到 `.gitignore`:

```gitignore
# OIDC 持久化文件 (包含敏感数据)
jwks.json
oidc.db
oidc.db-shm
oidc.db-wal
```

### 3. 备份策略

```bash
# 定期备份数据库
cp oidc.db oidc.db.backup.$(date +%Y%m%d)

# 备份密钥文件
cp jwks.json jwks.json.backup.$(date +%Y%m%d)
```

### 4. 密钥轮换

定期轮换密钥以提高安全性:

```bash
# 1. 备份旧密钥
mv jwks.json jwks.json.old

# 2. 生成新密钥
pnpm generate-jwks

# 3. 重启服务
pnpm start
```

**注意:** 密钥轮换后,使用旧密钥签发的 token 将无法验证,用户需要重新登录。

## 多实例部署

### 方案 1: 共享文件系统

将数据库和密钥文件放在共享文件系统上(如 NFS):

```bash
# 所有实例使用相同的文件
/shared/oidc.db
/shared/jwks.json
```

### 方案 2: PostgreSQL (未来支持)

未来版本将支持 PostgreSQL 适配器,适合大规模部署。

## 故障排除

### 问题 1: 警告仍然出现

**检查:**

1. 确认代码已更新到最新版本
2. 确认 `jwks.json` 文件存在
3. 查看服务启动日志

**解决:**

```bash
# 删除旧文件重新生成
rm jwks.json oidc.db*
pnpm start
```

### 问题 2: 数据库文件损坏

**症状:** 服务启动失败或数据异常

**解决:**

```bash
# 恢复备份
cp oidc.db.backup.20240101 oidc.db

# 或删除数据库重新开始
rm oidc.db*
pnpm start
```

### 问题 3: 密钥格式错误

**症状:** 服务启动时报错 "无效的 JWKS 文件格式"

**解决:**

```bash
# 验证 JSON 格式
node -e "JSON.parse(require('fs').readFileSync('jwks.json', 'utf-8'))"

# 如果格式错误,重新生成
rm jwks.json
pnpm generate-jwks
```

## 技术细节

### SQLite 适配器实现

```typescript
export class SqliteOidcAdapter implements Adapter {
  private db: Database.Database;
  private name: string;

  constructor(name: string) {
    this.name = name;
    this.db = new Database('./oidc.db');
    
    // 创建表结构
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oidc_store (
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        expires_at INTEGER,
        consumed_at INTEGER,
        PRIMARY KEY (name, key)
      );
    `);
    
    // 定期清理过期数据
    setInterval(() => this.cleanup(), 60000);
  }
  
  // 实现 Adapter 接口的所有方法
  async upsert(key: string, payload: any, expiresIn?: number) { ... }
  async find(key: string): Promise<any> { ... }
  async destroy(key: string) { ... }
  // ...
}
```

### JWKS 生成流程

```typescript
export async function generateJWKS(
  filePath: string, 
  keyId: string = 'default-key'
): Promise<JWKSConfig> {
  // 1. 生成 RSA 密钥对
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  
  // 2. 导出为 JWK 格式
  const privateJWK = await exportJWK(privateKey);
  
  // 3. 添加元数据
  const jwk: JWK = {
    ...privateJWK,
    kid: keyId,
    alg: 'RS256',
    use: 'sig',
  };
  
  // 4. 保存到文件
  const jwks: JWKSConfig = { keys: [jwk] };
  writeFileSync(filePath, JSON.stringify(jwks, null, 2));
  
  return jwks;
}
```

## 相关文档

- **[生产环境配置指南](./PRODUCTION_SETUP.md)** - 完整的生产环境配置
- **[快速解决方案](./PRODUCTION_WARNINGS.md)** - 快速解决警告
- **[OIDC Provider 文档](https://github.com/panva/node-oidc-provider)** - 官方文档

## 总结

通过以上两个方案:

1. ✅ **SQLite 持久化适配器** - 解决数据持久化问题
2. ✅ **JWKS 密钥管理** - 解决密钥持久化问题

你的 OIDC Provider 已经可以安全地部署到生产环境,不会再出现开发环境警告。

**关键优势:**

- ✅ 数据持久化,服务重启不丢失
- ✅ 密钥持久化,token 持续有效
- ✅ 自动化管理,无需手动配置
- ✅ 安全可靠,符合最佳实践
