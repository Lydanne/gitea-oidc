# @gitea-oidc/applications

应用控制面的私有领域包，负责自定义/模板应用、OIDC Client、密钥轮换和审计的一致性边界。

## 当前能力

- `ApplicationService`：事务性创建自定义或精确模板版本应用，支持预览、查询、启停和密钥轮换。
- `application-templates`：创建时解析 Gitea 等内置模板，并把版本、issuer、派生 Client 和结构化
  接入说明保存为不可变快照。
- `ApplicationRepository`：持久化无关的事务接口。
- `MemoryApplicationRepository`：用于开发和测试的串行化内存事务实现，异常时整体回滚。
- `SqliteApplicationRepository`：用于生产单实例部署的 WAL 持久化实现，事务内同步维护
  Client 索引、幂等记录和审计事件。
- `ApplicationSecretEncryptor`：使用独立的 32 字节主密钥执行 AES-256-GCM 加密。
- `OidcClientProjector`：仅为 Provider 运行时投影并解密 active Client。

创建接口支持幂等键。首次直接交付会返回一次明文 `clientSecret`；相同幂等请求重放只返回
`already_delivered` 脱敏回执。confidential Client 可通过乐观 version 原子撤销旧 Secret 并轮换
新 Secret；响应丢失后读取最新 version 再轮换即可恢复。列表、详情、审计和集成说明均不包含明文
或密文。

V1 明确限制一个 Application 只拥有一个 OIDC Client。`ApplicationDetailsV1`、Secret 摘要和状态
变更响应使用 `@gitea-oidc/contracts` 的共享 strict schema，避免管理端重复定义结构。

## 安全约束

- 应用密钥主密钥必须与 Token、Cookie、JWKS 等密钥分域，并由部署环境或 KMS 提供。
- 生产和预发布 redirect URI 只允许 HTTPS；开发环境仅额外允许 HTTP loopback 地址。
- Redirect URI 和 Post Logout Redirect URI 禁止 query、fragment、通配符和用户凭据，public
  Client 必须使用 PKCE S256。
- 模板应用必须保存与 Application、Client 和 issuer 完全一致的不可变快照；目录升级不能静默改变
  已有应用。
- `MemoryApplicationRepository` 仅用于测试和开发，不能用于生产。
- `SqliteApplicationRepository` 适合单实例部署；多实例部署需要共享数据库仓储，不能让每个实例
  各自持有 SQLite 文件。
- SQLite 仓储以 `BEGIN IMMEDIATE` 串行提交应用聚合、Client 索引、幂等记录和审计，并把数据库、
  WAL、SHM 文件权限限制为 `0600`。调用方退出前必须 `await repository.close()`。
- 创建 SQLite 仓储时必须传入当前 `connectionIssuer`。首次打开未版本化旧库时，仓储会在同一事务
  中校验全部聚合、补齐 issuer 并写入 schema 版本；未知版本或不合法旧数据会 fail closed。
- `OidcClientProjectionDto` 含可恢复的 Client Secret，只能留在 Provider 内部认证路径中。

## 开发验证

```bash
pnpm --filter @gitea-oidc/applications test
pnpm --filter @gitea-oidc/applications typecheck
pnpm --filter @gitea-oidc/applications build
```
