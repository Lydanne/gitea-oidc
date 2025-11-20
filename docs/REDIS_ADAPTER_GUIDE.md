# Redis OIDC 适配器使用指南

## 概述

`RedisOidcAdapter` 是一个使用 Redis 作为持久化存储的 OIDC Provider 适配器,适合高并发和分布式部署场景。

## 特性

- ✅ **高性能**: Redis 内存数据库,读写速度快
- ✅ **分布式支持**: 多个服务实例可共享同一个 Redis
- ✅ **自动过期**: 利用 Redis 的 TTL 机制自动清理过期数据
- ✅ **索引支持**: 支持 userCode、uid、grantId 等索引查询
- ✅ **连接池**: 所有适配器实例共享同一个 Redis 连接

## 安装依赖

```bash
pnpm add redis
```

## 基本使用

### 1. 配置 Redis 连接

在 `src/server.ts` 中配置:

```typescript
import { RedisOidcAdapter } from './adapters/RedisOidcAdapter';

// 方式 1: 使用 URL 连接
const redisOptions = {
  url: 'redis://localhost:6379'
};

// 方式 2: 使用详细配置
const redisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'your-password',  // 可选
  database: 0,                // 可选,默认 0
  keyPrefix: 'oidc:'          // 可选,默认 'oidc:'
};

// 配置 OIDC Provider
const configuration: Configuration = {
  adapter: (name) => new RedisOidcAdapter(name, redisOptions),
  // ... 其他配置
};
```

### 2. 完整示例

```typescript
import { Provider, type Configuration } from 'oidc-provider';
import { RedisOidcAdapter } from './adapters/RedisOidcAdapter';

async function start() {
  // Redis 配置
  const redisOptions = {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    keyPrefix: 'myapp:oidc:',
  };

  // OIDC Provider 配置
  const configuration: Configuration = {
    adapter: (name) => new RedisOidcAdapter(name, redisOptions),
    clients: [
      {
        client_id: 'my-client',
        client_secret: 'secret',
        redirect_uris: ['http://localhost:3001/callback'],
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
      },
    ],
    // ... 其他配置
  };

  const oidc = new Provider('http://localhost:3000', configuration);
  
  // 优雅关闭
  process.on('SIGTERM', async () => {
    await RedisOidcAdapter.disconnect();
    process.exit(0);
  });
}
```

## 配置选项

### RedisOidcAdapterOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | `string` | - | Redis 连接 URL,格式: `redis://[:password@]host[:port][/db-number]` |
| `host` | `string` | `'localhost'` | Redis 主机地址 |
| `port` | `number` | `6379` | Redis 端口 |
| `password` | `string` | - | Redis 密码 |
| `database` | `number` | `0` | Redis 数据库编号 (0-15) |
| `keyPrefix` | `string` | `'oidc:'` | 键前缀,用于区分不同应用 |

## 环境变量配置

推荐使用环境变量管理 Redis 连接:

```bash
# .env
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-password
REDIS_DB=0
```

```typescript
const redisOptions = {
  url: process.env.REDIS_URL,
  password: process.env.REDIS_PASSWORD,
  database: parseInt(process.env.REDIS_DB || '0'),
};
```

## Redis 键结构

适配器使用以下键结构:

```
oidc:Session:session-id-123           # 主数据
oidc:AccessToken:token-id-456         # 主数据
oidc:userCode:USER-CODE-789           # userCode 索引 -> id
oidc:uid:interaction-uid-012          # uid 索引 -> id
oidc:grantId:grant-id-345             # grantId 索引 -> Set<id>
```

### 键命名规则

- **主键**: `{keyPrefix}{name}:{id}`
- **userCode 索引**: `{keyPrefix}userCode:{userCode}`
- **uid 索引**: `{keyPrefix}uid:{uid}`
- **grantId 索引**: `{keyPrefix}grantId:{grantId}` (使用 Set 存储)

## 生产环境部署

### 1. Redis 集群

```typescript
import { createCluster } from 'redis';

// 注意: 当前实现使用单个客户端
// 如需集群支持,需要修改 RedisOidcAdapter 使用 createCluster
const redisOptions = {
  url: 'redis://redis-cluster:6379',
};
```

### 2. Redis Sentinel

```typescript
const redisOptions = {
  url: 'redis://sentinel-host:26379',
  // Sentinel 配置需要额外的选项
};
```

### 3. 性能优化

```typescript
const redisOptions = {
  url: 'redis://localhost:6379',
  keyPrefix: 'prod:oidc:',
  // 可以在 createClient 中添加更多选项
};
```

## 监控和调试

### 查看 Redis 中的数据

```bash
# 连接到 Redis
redis-cli

# 查看所有 OIDC 相关的键
KEYS oidc:*

# 查看特定键的值
GET oidc:Session:session-id-123

# 查看键的 TTL
TTL oidc:Session:session-id-123

# 查看 grantId 关联的所有 ID
SMEMBERS oidc:grantId:grant-id-345
```

### 监控连接

```typescript
const client = await RedisOidcAdapter.getClient();

client.on('error', (err) => {
  console.error('Redis Error:', err);
  // 发送告警
});

client.on('reconnecting', () => {
  console.log('Redis Reconnecting...');
});

client.on('ready', () => {
  console.log('Redis Ready');
});
```

## 与 SQLite 适配器对比

| 特性 | Redis | SQLite |
|------|-------|--------|
| **性能** | ⭐⭐⭐⭐⭐ 极快 | ⭐⭐⭐ 快 |
| **分布式** | ✅ 支持 | ❌ 不支持 |
| **持久化** | ✅ 支持 (RDB/AOF) | ✅ 支持 |
| **内存占用** | 较高 | 较低 |
| **部署复杂度** | 需要 Redis 服务 | 无需额外服务 |
| **适用场景** | 高并发、分布式 | 单实例、中小规模 |

## 故障排除

### 问题 1: 连接失败

**错误**: `Redis Client Error: connect ECONNREFUSED`

**解决**:

```bash
# 检查 Redis 是否运行
redis-cli ping

# 启动 Redis
redis-server

# 或使用 Docker
docker run -d -p 6379:6379 redis:latest
```

### 问题 2: 认证失败

**错误**: `Redis Client Error: NOAUTH Authentication required`

**解决**:

```typescript
const redisOptions = {
  url: 'redis://:your-password@localhost:6379',
  // 或
  password: 'your-password',
};
```

### 问题 3: 数据丢失

**原因**: Redis 重启后数据丢失

**解决**: 启用 Redis 持久化

```bash
# redis.conf
save 900 1
save 300 10
save 60 10000

appendonly yes
appendfsync everysec
```

### 问题 4: 内存不足

**错误**: `OOM command not allowed when used memory > 'maxmemory'`

**解决**:

```bash
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
```

## 最佳实践

### 1. 使用键前缀

不同环境使用不同的键前缀:

```typescript
const redisOptions = {
  keyPrefix: process.env.NODE_ENV === 'production' 
    ? 'prod:oidc:' 
    : 'dev:oidc:',
};
```

### 2. 设置合理的 TTL

OIDC Provider 会自动设置 TTL,但可以在配置中调整:

```typescript
const configuration: Configuration = {
  ttl: {
    AccessToken: 3600,      // 1 小时
    AuthorizationCode: 600, // 10 分钟
    RefreshToken: 86400,    // 1 天
  },
};
```

### 3. 监控 Redis 性能

```bash
# 实时监控
redis-cli --stat

# 查看慢查询
redis-cli slowlog get 10

# 查看内存使用
redis-cli info memory
```

### 4. 定期清理

虽然 Redis 会自动清理过期键,但可以手动触发:

```bash
# 清理所有过期键
redis-cli --scan --pattern "oidc:*" | xargs redis-cli del
```

### 5. 备份策略

```bash
# 手动备份
redis-cli BGSAVE

# 定时备份 (crontab)
0 2 * * * redis-cli BGSAVE
```

## 迁移指南

### 从 SQLite 迁移到 Redis

1. **安装 Redis**

   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Ubuntu
   sudo apt install redis-server
   sudo systemctl start redis
   
   # Docker
   docker run -d -p 6379:6379 redis:latest
   ```

2. **更新代码**

   ```typescript
   // 旧代码
   import { SqliteOidcAdapter } from './adapters/SqliteOidcAdapter';
   adapter: SqliteOidcAdapter,
   
   // 新代码
   import { RedisOidcAdapter } from './adapters/RedisOidcAdapter';
   adapter: (name) => new RedisOidcAdapter(name, { url: 'redis://localhost:6379' }),
   ```

3. **测试**

   ```bash
   # 启动服务
   pnpm dev
   
   # 检查 Redis 中的数据
   redis-cli KEYS "oidc:*"
   ```

## 相关资源

- [Redis 官方文档](https://redis.io/documentation)
- [node-redis 文档](https://github.com/redis/node-redis)
- [OIDC Provider 文档](https://github.com/panva/node-oidc-provider)
- [Redis 最佳实践](https://redis.io/docs/manual/patterns/)

## 总结

Redis OIDC 适配器提供了高性能、可扩展的持久化存储方案,特别适合:

- ✅ 高并发场景
- ✅ 分布式部署
- ✅ 需要快速响应的应用
- ✅ 已有 Redis 基础设施的项目

对于单实例、中小规模的应用,SQLite 适配器可能是更简单的选择。
