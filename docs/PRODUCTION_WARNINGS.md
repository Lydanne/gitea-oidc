# 解决 OIDC Provider 生产环境警告

## 警告信息

如果你看到以下警告:

```
oidc-provider WARNING: a quick start development-only in-memory adapter is used
oidc-provider WARNING: a quick start development-only signing keys are used
```

## 快速解决方案

### ✅ 已自动修复

项目已自动配置以下功能,**无需额外操作**:

1. **SQLite 持久化存储** - 自动使用 `oidc.db` 存储数据
2. **JWKS 密钥管理** - 首次启动时自动生成 `jwks.json`

### 首次启动

直接启动服务即可:

```bash
pnpm start
```

系统会自动:
- 生成 `jwks.json` 密钥文件
- 创建 `oidc.db` 数据库文件
- 警告消失 ✅

### 文件说明

启动后会生成以下文件:

```
jwks.json       # RSA 签名密钥 (敏感文件,已添加到 .gitignore)
oidc.db         # SQLite 数据库 (已添加到 .gitignore)
oidc.db-shm     # SQLite 共享内存
oidc.db-wal     # SQLite 预写日志
```

## 详细文档

完整的生产环境配置指南请参考:

👉 **[生产环境配置指南](./PRODUCTION_SETUP.md)**

包含:
- 安全最佳实践
- 密钥轮换策略
- 多实例部署方案
- 故障排除指南
