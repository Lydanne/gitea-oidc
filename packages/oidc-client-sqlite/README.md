# `@x-oidc/node-sqlite`

为 `@x-oidc/node` 提供可直接使用的 SQLite transaction store、session CAS store 和跨进程
refresh lock。该包面向单机本地 SQLite 部署，可由同一主机的多个 Node 进程共享同一数据库路径；
当前包从 `2.0.0` 起与全部 workspace 包同步版本，仍为私有包且尚未发布到 npm。

## 安全模型

- transaction 和 session 的完整 JSON 使用 AES-256-GCM 加密后写入 SQLite；state、nonce、
  code verifier、原始 transaction/session ID、Access Token、Refresh Token 和 ID Token 不会明文落库；
- transaction、session 和 refresh lock 只保存按域分离的 HMAC-SHA256 lookup key；数据库或备份的
  只读泄露不能直接还原可用于 Cookie 的 bearer session ID；
- AAD 绑定表类型、owner namespace、lookup key 和 refresh version，交换行或篡改索引会解密失败；
- transaction 使用单条 `DELETE ... RETURNING` 原子消费，并发输家稳定得到空结果；
- session refresh 使用数据库 version 条件更新实现 CAS，退出和失效使用 version 条件删除；
- refresh lock 使用 SQLite 行、随机 lease token、短轮询和自动心跳在同一主机的多个 Node 进程间互斥；
- 数据库文件创建后收紧为 `0600`；公开错误不包含路径、SQL、Token 或底层异常。

调用方必须从 Secret Manager 读取独立的 32 字节主密钥。不要复用 OIDC Client Secret、Cookie key、
服务端 Application 主密钥或 JWKS 私钥。当前只支持单个 active key；轮换主密钥前需要停机迁移或
重新建立业务应用会话。

数据库元数据包含格式版本、`keyId` 和不可逆 key verifier，用于在查询 HMAC 索引前拒绝错误主密钥。
早期私有预览中保存过原始 ID 且没有格式元数据的数据库会 fail closed，必须删除并重新建立会话；
不会静默沿用含明文索引的旧文件。

## 使用方式

```typescript
import { createNodeOidcClient } from "@x-oidc/node";
import { createSqliteOidcStores } from "@x-oidc/node-sqlite";

const key = Buffer.from(process.env.X_OIDC_SESSION_KEY_BASE64URL ?? "", "base64url");
if (key.byteLength !== 32) {
  throw new Error("X_OIDC_SESSION_KEY_BASE64URL 必须解码为 32 字节");
}

const stores = createSqliteOidcStores({
  dbPath: "/srv/example-app/data/oidc-sessions.db",
  encryptionKey: key,
  keyId: "example-app-sessions-v1",
});

const client = createNodeOidcClient({
  connection,
  credential,
  transactionStore: stores.transactionStore,
  sessionStore: stores.sessionStore,
  refreshLock: stores.refreshLock,
});

// 应用退出时先停止 HTTP 流量，再按此顺序关闭。
await client.close();
await stores.close();
```

`encryptionKey` 在创建时会复制；`close()` 会等待已经进入 refresh lock 的操作完成、关闭数据库并
清零内部副本。关闭开始后所有新操作都会失败。注入 `@x-oidc/node` 的 store 归调用方所有，
Node client 不会替调用方关闭它们。

## 部署边界

SQLite 适合同一主机上的一个或多个 Node 进程共享同一文件，不适合 NFS、多 Pod 各自持有文件或
跨主机分布式部署。多主机应改用后续 Redis/PostgreSQL store。数据库、`-wal` 和 `-shm` 文件必须
位于受保护的持久化目录，并与主密钥一起纳入恢复演练。

Refresh lock 的 lease 会定期续期；即使进程在操作中崩溃，租约过期后其他进程也能继续。Session
CAS 仍是最终并发保护，防止过期 lease 的旧结果覆盖已经轮换或删除的会话。

包只构建一份 ESM 事实源，同时声明 `import`、`require` 和 `default` 条件。CommonJS 消费依赖
Node.js `>=20.19.0` 的 `require(esm)` 支持，不维护第二份 CJS 实现。

## 验证

```bash
pnpm --filter @x-oidc/node-sqlite test
pnpm --filter @x-oidc/node-sqlite typecheck
pnpm --filter @x-oidc/node-sqlite build
```
