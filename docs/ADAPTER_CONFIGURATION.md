# OIDC 适配器配置指南

OIDC Adapter 保存授权码、Token、Grant、Session、撤销状态等协议数据。它不是用户仓储、应用仓储
或 OAuth stateStore；生产部署必须分别选择并配置这些存储。

## 四类存储的职责

| 配置 | 保存内容 | 单实例推荐 | 多实例推荐 |
| --- | --- | --- | --- |
| `auth.userRepository` | 用户和 Provider 身份映射 | SQLite | PostgreSQL |
| `adapter` | OIDC 协议记录 | SQLite | Redis |
| `auth.stateStore` | OAuth state、后台会话、登录失败计数 | memory | Redis |
| `applications.repository` | 应用、Client Secret、审计 | SQLite | 当前不支持共享实现 |

不要因为四者都能使用 Redis 或 SQLite 的概念，就把它们视为同一存储。各自的生命周期和一致性
要求不同。

## 选择适配器

| Adapter | 使用场景 | 持久化 | 多实例 | 生产限制 |
| --- | --- | --- | --- | --- |
| SQLite | 单实例 | 是 | 否 | 数据目录必须持久化且不能位于 NFS |
| Redis | 多实例 | 由 Redis 决定 | 是 | 必须同时使用 Redis stateStore |
| memory | 本地测试 | 否 | 否 | 生产校验直接拒绝 |

当前需要内置应用管理时，必须选择 SQLite OIDC Adapter，并保持单实例。需要多实例 Redis 时，必须
关闭应用管理并使用静态 `clients`。

## SQLite Adapter

```json
{
  "adapter": {
    "type": "sqlite",
    "sqlite": {
      "dbPath": "/app/data/oidc.db"
    }
  }
}
```

适用于单实例和中小规模生产部署。服务会创建数据库并清理过期记录。

部署要求：

- 只有一个 X OIDC 实例访问该文件。
- 使用本地持久化磁盘，不使用 NFS 或多个容器共享写入。
- 数据目录权限建议为 `0700`，数据库和 JWKS 文件权限建议为 `0600`。
- 备份时停止唯一实例并归档完整数据目录，或使用 SQLite Online Backup API。
- 不要运行中只复制主 `.db` 文件而忽略 `-wal` 和 `-shm`。

```bash
chmod 0700 /srv/x-oidc/data
chmod 0600 /srv/x-oidc/data/*.db
```

## Redis Adapter

URL 方式：

```json
{
  "adapter": {
    "type": "redis",
    "redis": {
      "url": "redis://:your-password@redis.example.internal:6379/0",
      "keyPrefix": "x-oidc:oidc:"
    }
  },
  "auth": {
    "stateStore": {
      "type": "redis",
      "redis": {
        "url": "redis://:your-password@redis.example.internal:6379/0",
        "keyPrefix": "x-oidc:state:"
      }
    }
  }
}
```

主机参数方式：

```json
{
  "adapter": {
    "type": "redis",
    "redis": {
      "host": "redis.example.internal",
      "port": 6379,
      "password": "your-password",
      "database": 0,
      "keyPrefix": "x-oidc:oidc:"
    }
  }
}
```

可用字段：

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `url` | Redis 连接 URL，优先用于集中配置 | 无 |
| `host` | Redis 主机；没有 `url` 时使用 | 无 |
| `port` | Redis 端口 | 客户端默认值 |
| `password` | Redis 密码 | 无 |
| `database` | Redis 数据库编号，`0` 到 `15` | `0` |
| `keyPrefix` | 键前缀 | OIDC 为 `oidc:`，state 为 `x-oidc:state:` |

生产要求：

- 使用认证和受控内网；跨不可信网络时使用受支持的 TLS 终端或 `rediss://`。
- 为 OIDC 和 stateStore 使用不同 `keyPrefix`。
- 使用独立 Redis 实例或严格隔离的数据库，禁止其他应用执行 `FLUSHDB`。
- 配置 AOF 或 RDB 持久化，并按业务 RPO 验证恢复。
- `maxmemory-policy` 使用 `noeviction`。逐出 OIDC 键会破坏会话、授权码和撤销语义。
- 监控连接失败、持久化失败、内存和 `evicted_keys`。

当前配置类型只支持普通 Redis 连接参数，不直接暴露 Cluster 或 Sentinel 拓扑选项。需要高可用时，
使用能提供稳定主节点连接端点的托管服务或代理，并在预发布环境验证故障切换。

## Memory Adapter

```json
{
  "adapter": {
    "type": "memory"
  }
}
```

它只适合测试。服务重启会丢失全部 OIDC 状态，多进程之间也不共享数据；生产配置校验会拒绝启动。

## 使用 JavaScript 配置和环境变量

应用不会自动读取 `REDIS_URL`、`SQLITE_DB_PATH` 等环境变量。必须在
`x-oidc.config.js` 中显式映射：

```javascript
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量: ${name}`);
  return value;
};

export default {
  adapter: {
    type: "redis",
    redis: {
      url: requiredEnv("X_OIDC_REDIS_URL"),
      keyPrefix: "x-oidc:oidc:"
    }
  },
  auth: {
    stateStore: {
      type: "redis",
      redis: {
        url: requiredEnv("X_OIDC_REDIS_URL"),
        keyPrefix: "x-oidc:state:"
      }
    }
  }
};
```

Redis URL 中可能包含密码，应由 Secret Manager 注入，不能写入仓库、镜像、日志或工单。

## 切换适配器

项目不提供 SQLite 与 Redis 之间的在线数据迁移。切换 Adapter 会使原存储中的会话、授权码、
Refresh Token 和撤销记录不再可见，通常需要用户重新登录。

安全切换流程：

1. 进入维护窗口并停止全部实例。
2. 备份旧存储、JWKS、配置和密钥。
3. 更新 Adapter 和 stateStore 配置。
4. 启动一个实例，确认配置校验和发现文档正常。
5. 完成登录、刷新和退出测试。
6. 多实例模式验证后再逐步增加副本。

不要在切换期间让 SQLite 和 Redis 实例同时对外服务；它们会形成两套互不一致的会话状态。

## 故障排查

### SQLite 报权限错误

确认服务用户对数据目录有读写和创建 WAL 文件的权限，同时避免让其他用户读取数据库：

```bash
chown -R x-oidc:x-oidc /srv/x-oidc/data
chmod 0700 /srv/x-oidc/data
chmod 0600 /srv/x-oidc/data/*.db
```

容器运行用户与宿主文件所有者不一致时，先确认镜像实际 UID/GID，再调整所有权。

### SQLite 持续锁定

确认只有一个实例访问数据库，文件不位于 NFS，并检查磁盘空间。停止实例并保存完整数据目录后再
恢复，不要直接删除 WAL 文件。

### Redis 无法连接

```bash
redis-cli -u 'redis://:your-password@redis.example.internal:6379/0' PING
```

检查 DNS、网络策略、TLS、认证和数据库编号。不要在命令历史中保留真实 Redis URL；生产排障应
通过安全的临时环境变量或凭据文件注入。

### Redis 内存不足

增加容量或减少不相关数据，保持 `maxmemory-policy noeviction`。不要通过 `allkeys-lru` 或
`volatile-lru` 让 Redis 静默逐出认证状态。

## 相关文档

- [生产部署指南](./PRODUCTION_SETUP.md)
- [生产运维手册](./OPERATIONS.md)
- [Redis OIDC 适配器使用指南](./REDIS_ADAPTER_GUIDE.md)
- [应用管理接入指南](./APPLICATION_MANAGEMENT.md)
