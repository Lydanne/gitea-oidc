# @gitea-oidc/applications

应用控制面的私有领域包，负责自定义应用、OIDC Client、密钥和审计的一致性边界。

## 当前能力

- `ApplicationService`：事务性创建、查询、启用和停用自定义应用。
- `ApplicationRepository`：持久化无关的事务接口。
- `MemoryApplicationRepository`：用于开发和测试的串行化内存事务实现，异常时整体回滚。
- `SqliteApplicationRepository`：用于生产单实例部署的 WAL 持久化实现，事务内同步维护
  Client 索引、幂等记录和审计事件。
- `ApplicationSecretEncryptor`：使用独立的 32 字节主密钥执行 AES-256-GCM 加密。
- `OidcClientProjector`：仅为 Provider 运行时投影并解密 active Client。

创建接口支持幂等键。首次直接交付会返回一次明文 `clientSecret`；相同幂等请求重放只返回
`already_delivered` 脱敏回执。列表、详情、审计和集成说明均不包含明文或密文。

## 安全约束

- 应用密钥主密钥必须与 Token、Cookie、JWKS 等密钥分域，并由部署环境或 KMS 提供。
- 生产和预发布 redirect URI 只允许 HTTPS；开发环境仅额外允许 HTTP loopback 地址。
- URI 禁止 fragment、通配符和用户凭据，public Client 必须使用 PKCE S256。
- `MemoryApplicationRepository` 仅用于测试和开发，不能用于生产。
- `SqliteApplicationRepository` 适合单实例部署；多实例部署需要共享数据库仓储，不能让每个实例
  各自持有 SQLite 文件。
- SQLite 仓储以 `BEGIN IMMEDIATE` 串行提交应用聚合、Client 索引、幂等记录和审计，并把数据库、
  WAL、SHM 文件权限限制为 `0600`。调用方退出前必须 `await repository.close()`。
- `OidcClientProjectionDto` 含可恢复的 Client Secret，只能留在 Provider 内部认证路径中。

## 开发验证

```bash
pnpm --filter @gitea-oidc/applications test
pnpm --filter @gitea-oidc/applications typecheck
pnpm --filter @gitea-oidc/applications build
```
