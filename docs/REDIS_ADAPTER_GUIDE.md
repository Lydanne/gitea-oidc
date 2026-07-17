# Redis OIDC 适配器使用指南

Redis Adapter 用于多实例 X OIDC，共享 OIDC 协议记录、撤销屏障和短期状态。单实例且启用应用
管理时应优先使用 SQLite；拓扑选择见[OIDC 适配器配置指南](./ADAPTER_CONFIGURATION.md)。

## 支持边界

当前配置支持：

- Redis URL，包含可选用户名、密码、数据库编号和 TLS scheme。
- `host`、`port`、`password`、`database` 参数。
- 独立 `keyPrefix`。
- OIDC 记录 TTL、索引和原子 Lua 操作。
- Redis `auth.stateStore`，用于 OAuth state、后台会话和登录失败计数。

当前配置不直接支持 Redis Cluster 节点列表或 Sentinel 参数。需要高可用时，应使用提供稳定主节点
端点的托管 Redis、代理或基础设施层故障切换，并完成真实故障演练。

## 完整最小配置

```json
{
  "auth": {
    "userRepository": {
      "type": "pgsql",
      "pgsql": {
        "connectionString": "postgresql://x_oidc:your-password@postgres:5432/x_oidc"
      }
    },
    "stateStore": {
      "type": "redis",
      "redis": {
        "url": "redis://:your-password@redis:6379/0",
        "keyPrefix": "x-oidc:state:"
      }
    }
  },
  "applications": {
    "enabled": false,
    "clientSource": "config"
  },
  "adapter": {
    "type": "redis",
    "redis": {
      "url": "redis://:your-password@redis:6379/0",
      "keyPrefix": "x-oidc:oidc:"
    }
  }
}
```

该片段需要合并到完整生产配置中。所有实例还必须共享相同的静态 `clients`、Cookie Keys、
Provider 配置和 JWKS。

## Redis 服务要求

### 网络和认证

- Redis 只允许 X OIDC 实例所在网络访问。
- 启用 Redis ACL 或密码认证。
- 跨不可信网络时使用 TLS 或受控的加密隧道。
- 不在配置示例、日志和 Shell 历史中保存真实 Redis URL。

### 内存策略

使用：

```text
maxmemory-policy noeviction
```

不要使用 `allkeys-lru`、`volatile-lru` 或其他逐出策略。OIDC Token 带 TTL 不代表它们是普通缓存；
提前逐出会使会话、授权码、索引或撤销状态不一致。

容量不足时让写入明确失败并触发告警，比静默丢弃认证状态更安全。

### 持久化

按业务 RPO 选择 AOF、RDB 或托管服务备份。恢复演练必须覆盖：

- OIDC 主记录与索引。
- Account 和 Client 撤销状态。
- OAuth state 与后台会话。
- 与同一恢复点匹配的 PostgreSQL 用户数据和 JWKS。

Redis 不是可以随时清空的缓存。执行 `FLUSHDB` 会让已有登录、刷新和撤销语义发生变化。

## Key Prefix

为不同环境和用途使用不同前缀：

```json
{
  "adapter": {
    "type": "redis",
    "redis": {
      "keyPrefix": "production:x-oidc:oidc:"
    }
  },
  "auth": {
    "stateStore": {
      "type": "redis",
      "redis": {
        "keyPrefix": "production:x-oidc:state:"
      }
    }
  }
}
```

不要让生产、预发布和开发环境共享相同前缀。修改前缀等同于切换到空存储，会使旧会话不可见。

## 多实例启动

建议顺序：

1. 预置并安全分发同一份 `jwks.json`，不要让不同实例独立生成签名密钥。
2. 确认所有实例使用完全相同的配置和密钥版本。
3. 启动一个实例，验证 Redis 连接、发现文档、登录和退出。
4. 再增加副本并验证任意节点都能处理 Callback 和后台会话。
5. 验证负载均衡器健康检查和优雅退出。

生产校验会拒绝“Redis OIDC Adapter + memory stateStore”的组合。

## 监控

至少监控：

- `connected_clients` 和连接拒绝。
- `used_memory`、`maxmemory` 和内存增长趋势。
- `evicted_keys`，生产目标必须为 `0`。
- AOF/RDB 最近成功时间和错误。
- 主从复制延迟和故障切换状态。
- Lua 执行错误、超时和应用侧 Redis 重连日志。

排查键数量时使用增量 `SCAN`，不要在生产执行阻塞式 `KEYS`：

```bash
redis-cli --scan --pattern 'production:x-oidc:oidc:*' | wc -l
redis-cli --scan --pattern 'production:x-oidc:state:*' | wc -l
```

命令中的连接凭据应通过安全方式注入。不要把键值正文复制到日志或工单，其中可能包含会话元数据。

## 备份与恢复

使用 Redis 平台自身的备份和恢复流程，不手工复制在线数据目录。恢复后：

1. 确认 Redis 角色、持久化和复制状态正常。
2. 使用匹配恢复点的用户数据库、配置和 JWKS 启动一个实例。
3. 检查发现文档和 JWKS。
4. 完成登录、刷新和退出测试。
5. 确认已禁用用户和 Client 的撤销状态符合预期。
6. 再恢复全部副本。

如果恢复点丢失了认证状态，应评估强制全部用户重新登录，而不是假设遗留 Refresh Token 仍被正确
撤销。

## 故障排查

### 配置校验提示缺少 Redis

`adapter.type: "redis"` 和 `auth.stateStore.type: "redis"` 都必须提供 `url` 或 `host`。

### 登录偶发 state 无效

确认所有实例都使用 Redis stateStore、相同前缀和相同 Redis 数据库，并检查负载均衡器是否把流量
发送到了仍使用旧配置的实例。

### 后台登录或会话跨节点失败

后台会话也保存在 `auth.stateStore`。检查 Redis 连接、前缀、TTL 和各节点时间，不能用 memory
stateStore 依赖会话粘滞规避。

### 出现 `OOM command not allowed`

容量已经不足。保持 `noeviction`，先阻止扩容前的持续写入并增加内存或清理其他业务数据。不要切换
为逐出策略临时掩盖问题。

### 故障切换后出现数据回退

检查 Redis 持久化与复制 RPO，评估丢失的 OIDC 和撤销状态。必要时撤销全部会话、轮换相关 Client
Secret，并要求用户重新登录。

## 相关文档

- [OIDC 适配器配置指南](./ADAPTER_CONFIGURATION.md)
- [生产部署指南](./PRODUCTION_SETUP.md)
- [生产运维手册](./OPERATIONS.md)
