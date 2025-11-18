# OIDC 适配器配置指南

## 概述

OIDC 适配器负责持久化存储 OIDC Provider 的状态数据(如 Session、Token、授权码等)。项目支持多种适配器类型,可根据部署需求选择。

## 适配器类型

### 1. SQLite 适配器 (默认)

**适用场景**: 单实例部署、中小规模应用

**优点**:
- ✅ 无需额外服务
- ✅ 配置简单
- ✅ 数据持久化
- ✅ 适合开发和小规模生产环境

**配置示例**:

```json
{
  "adapter": {
    "type": "sqlite",
    "sqlite": {
      "dbPath": "./oidc.db"
    }
  }
}
```

### 2. Redis 适配器

**适用场景**: 分布式部署、高并发应用

**优点**:
- ✅ 高性能
- ✅ 支持分布式
- ✅ 自动过期
- ✅ 适合大规模生产环境

**配置示例**:

```json
{
  "adapter": {
    "type": "redis",
    "redis": {
      "url": "redis://localhost:6379",
      "keyPrefix": "oidc:"
    }
  }
}
```

**详细配置**:

```json
{
  "adapter": {
    "type": "redis",
    "redis": {
      "host": "localhost",
      "port": 6379,
      "password": "your-password",
      "database": 0,
      "keyPrefix": "myapp:oidc:"
    }
  }
}
```

### 3. Memory 适配器 (仅开发)

**适用场景**: 仅用于开发和测试

**警告**: ⚠️ 数据存储在内存中,服务重启后会丢失!

**配置示例**:

```json
{
  "adapter": {
    "type": "memory"
  }
}
```

## 完整配置示例

### SQLite 配置 (推荐单实例)

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "http://localhost:3000",
    "trustProxy": false
  },
  "adapter": {
    "type": "sqlite",
    "sqlite": {
      "dbPath": "./oidc.db"
    }
  },
  "oidc": {
    "issuer": "http://localhost:3000",
    "cookieKeys": ["secret-key-1", "secret-key-2"]
  },
  "clients": [
    {
      "client_id": "my-client",
      "client_secret": "secret",
      "redirect_uris": ["http://localhost:3001/callback"]
    }
  ]
}
```

### Redis 配置 (推荐分布式)

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "https://idp.example.com",
    "trustProxy": true
  },
  "adapter": {
    "type": "redis",
    "redis": {
      "url": "redis://redis-server:6379",
      "password": "your-redis-password",
      "keyPrefix": "prod:oidc:"
    }
  },
  "oidc": {
    "issuer": "https://idp.example.com",
    "cookieKeys": ["production-secret-1", "production-secret-2"]
  }
}
```

## 环境变量配置

可以使用环境变量动态配置适配器:

### JavaScript 配置文件

创建 `gitea-oidc.config.js`:

```javascript
export default {
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '3000'),
    url: process.env.SERVER_URL || 'http://localhost:3000',
    trustProxy: process.env.TRUST_PROXY === 'true',
  },
  
  adapter: {
    type: process.env.ADAPTER_TYPE || 'sqlite',
    
    // SQLite 配置
    sqlite: {
      dbPath: process.env.SQLITE_DB_PATH || './oidc.db',
    },
    
    // Redis 配置
    redis: {
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD,
      database: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'oidc:',
    },
  },
  
  // ... 其他配置
};
```

### 环境变量示例

```bash
# .env
ADAPTER_TYPE=redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-password
REDIS_DB=0
REDIS_KEY_PREFIX=myapp:oidc:
```

## 适配器切换

### 从 SQLite 切换到 Redis

1. **安装 Redis**:
   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Docker
   docker run -d -p 6379:6379 redis:latest
   ```

2. **更新配置**:
   ```json
   {
     "adapter": {
       "type": "redis",
       "redis": {
         "url": "redis://localhost:6379"
       }
     }
   }
   ```

3. **重启服务**:
   ```bash
   pnpm start
   ```

### 从 Redis 切换到 SQLite

1. **更新配置**:
   ```json
   {
     "adapter": {
       "type": "sqlite",
       "sqlite": {
         "dbPath": "./oidc.db"
       }
     }
   }
   ```

2. **重启服务**:
   ```bash
   pnpm start
   ```

**注意**: 切换适配器后,现有的会话和 token 会失效,用户需要重新登录。

## 配置验证

适配器工厂会自动验证配置:

```typescript
import { OidcAdapterFactory } from './adapters/OidcAdapterFactory';

const config = {
  type: 'redis',
  redis: {
    url: 'redis://localhost:6379',
  },
};

const validation = OidcAdapterFactory.validateConfig(config);

if (!validation.valid) {
  console.error('配置错误:', validation.errors);
}
```

## 性能对比

| 特性 | SQLite | Redis | Memory |
|------|--------|-------|--------|
| **读写速度** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **分布式支持** | ❌ | ✅ | ❌ |
| **数据持久化** | ✅ | ✅ | ❌ |
| **内存占用** | 低 | 中 | 高 |
| **配置复杂度** | 简单 | 中等 | 简单 |
| **运维成本** | 低 | 中 | 低 |

## 最佳实践

### 1. 开发环境

```json
{
  "adapter": {
    "type": "sqlite",
    "sqlite": {
      "dbPath": "./dev-oidc.db"
    }
  }
}
```

### 2. 测试环境

```json
{
  "adapter": {
    "type": "memory"
  }
}
```

### 3. 生产环境 (单实例)

```json
{
  "adapter": {
    "type": "sqlite",
    "sqlite": {
      "dbPath": "/data/oidc.db"
    }
  }
}
```

### 4. 生产环境 (分布式)

```json
{
  "adapter": {
    "type": "redis",
    "redis": {
      "url": "redis://redis-cluster:6379",
      "password": "strong-password",
      "keyPrefix": "prod:oidc:"
    }
  }
}
```

## 故障排除

### SQLite 问题

**问题**: 数据库文件权限错误

**解决**:
```bash
chmod 644 oidc.db
chown user:group oidc.db
```

**问题**: 数据库锁定

**解决**: 确保没有其他进程访问数据库文件

### Redis 问题

**问题**: 连接失败

**解决**:
```bash
# 检查 Redis 是否运行
redis-cli ping

# 检查连接配置
redis-cli -h localhost -p 6379 -a password ping
```

**问题**: 内存不足

**解决**: 配置 Redis 最大内存和淘汰策略
```bash
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
```

## 相关文档

- [Redis 适配器详细指南](./REDIS_ADAPTER_GUIDE.md)
- [生产环境配置](./PRODUCTION_SETUP.md)
- [SQLite 适配器测试](../src/adapters/__tests__/SqliteOidcAdapter.test.ts)

## 总结

选择适配器时考虑:

1. **单实例部署** → 使用 SQLite
2. **分布式部署** → 使用 Redis
3. **开发测试** → 使用 Memory 或 SQLite
4. **高并发** → 使用 Redis
5. **简单部署** → 使用 SQLite
