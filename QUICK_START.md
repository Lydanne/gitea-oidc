# 快速开始指南

本指南帮助你快速启动并运行新的认证插件系统。

## 前置条件

- Node.js 20+
- pnpm (或 npm/yarn)

## 1. 安装依赖

```bash
pnpm install
```

## 2. 创建配置文件

```bash
# 复制示例配置
cp gitea-oidc-auth.config.json gitea-oidc.config.json
```

## 3. 创建密码文件（本地认证）

### 方式 1: 使用 bcrypt（推荐）

```bash
# 安装 bcrypt-cli（如果没有）
npm install -g bcrypt-cli

# 生成密码哈希
bcrypt-cli hash "your-password" 10

# 创建 .htpasswd 文件
echo "admin:\$2b\$10\$..." > .htpasswd
```

### 方式 2: 使用 Node.js 脚本

```bash
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync('admin123', 10));" > .htpasswd
```

### 方式 3: 使用在线工具

访问 https://bcrypt-generator.com/ 生成哈希，然后手动创建 `.htpasswd`：

```
admin:$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
```

## 4. 配置认证提供者

编辑 `gitea-oidc.config.json`：

### 4.1 本地密码认证

```json
{
  "auth": {
    "providers": {
      "local": {
        "enabled": true,
        "displayName": "本地密码",
        "priority": 1,
        "config": {
          "passwordFile": ".htpasswd",
          "passwordFormat": "bcrypt"
        }
      }
    }
  }
}
```

### 4.2 飞书认证（可选）

```json
{
  "auth": {
    "providers": {
      "feishu": {
        "enabled": true,
        "displayName": "飞书登录",
        "priority": 2,
        "config": {
          "appId": "cli_your_app_id",
          "appSecret": "your_app_secret",
          "redirectUri": "http://localhost:3000/auth/feishu/callback",
          "scope": "contact:user.base:readonly"
        }
      }
    }
  }
}
```

## 5. 运行测试

```bash
# 运行所有测试
pnpm test

# 查看测试覆盖率
pnpm test:coverage
```

## 6. 启动服务器

```bash
# 开发模式（热重载）
pnpm dev

# 或生产模式
pnpm build
pnpm start
```

## 7. 测试认证

### 7.1 访问 OIDC 发现端点

```bash
curl http://localhost:3000/oidc/.well-known/openid-configuration
```

### 7.2 触发认证流程

1. 配置 Gitea（或其他 OAuth 客户端）：
   - Client ID: `gitea`
   - Client Secret: `gitea-client-secret-change-in-production`
   - Authorization URL: `http://localhost:3000/auth`
   - Token URL: `http://localhost:3000/token`
   - User Info URL: `http://localhost:3000/me`

2. 在 Gitea 中点击"使用 OIDC 登录"

3. 应该看到统一登录页面，包含：
   - 本地密码登录表单
   - 飞书登录按钮（如果启用）

### 7.3 测试本地密码登录

使用 `.htpasswd` 中的用户名和密码登录。

### 7.4 测试飞书登录

点击"飞书登录"按钮，完成飞书授权流程。

## 8. 查看日志

服务器日志会显示：

```
[INFO] Registered auth provider: local
[INFO] Registered auth provider: feishu
[INFO] Initialized provider: local
[INFO] Initialized provider: feishu
[INFO] All auth providers initialized successfully
[INFO] Server listening at http://0.0.0.0:3000
```

## 常见问题

### Q: 登录页面为空？

**A**: 检查：
1. 配置文件中 `auth.providers` 是否正确
2. 插件是否启用（`enabled: true`）
3. 查看服务器日志确认插件是否注册成功

### Q: 本地密码认证失败？

**A**: 检查：
1. `.htpasswd` 文件是否存在
2. 密码哈希格式是否正确（bcrypt 格式以 `$2b$` 开头）
3. 用户名和密码是否匹配

### Q: 飞书登录失败？

**A**: 检查：
1. 飞书应用配置是否正确
2. `redirectUri` 是否与飞书后台配置一致
3. `appId` 和 `appSecret` 是否正确
4. 网络是否可以访问飞书 API

### Q: 如何添加更多用户？

**A**: 编辑 `.htpasswd` 文件，每行一个用户：

```
user1:$2b$10$hash1...
user2:$2b$10$hash2...
user3:$2b$10$hash3...
```

### Q: 如何切换到数据库存储？

**A**: 参考 `IMPLEMENTATION_SUMMARY.md` 中的"生产环境优化"部分，实现 `PostgresUserRepository`。

## 下一步

- [ ] 阅读 [认证插件设计文档](./AUTH_PLUGIN_DESIGN.md)
- [ ] 阅读 [Server 集成指南](./SERVER_INTEGRATION_GUIDE.md)
- [ ] 实现自定义认证插件
- [ ] 配置生产环境部署
- [ ] 添加监控和日志

## 项目结构

```
gitea-oidc/
├── src/
│   ├── core/
│   │   └── AuthCoordinator.ts      # 认证协调器
│   ├── providers/
│   │   ├── LocalAuthProvider.ts    # 本地密码认证
│   │   └── FeishuAuthProvider.ts   # 飞书认证
│   ├── repositories/
│   │   └── MemoryUserRepository.ts # 内存用户存储
│   ├── stores/
│   │   └── MemoryStateStore.ts     # OAuth State 存储
│   ├── types/
│   │   ├── auth.ts                 # 认证类型定义
│   │   └── config.ts               # 配置类型定义
│   ├── __tests__/
│   │   └── p0-improvements.test.ts # 单元测试
│   ├── config.ts                   # 配置加载
│   └── server.ts                   # 主服务器（待集成）
├── .htpasswd                       # 密码文件
├── gitea-oidc.config.json          # 配置文件
├── jest.config.js                  # Jest 配置
└── package.json                    # 项目依赖
```

## 相关文档

- [认证插件设计文档](./AUTH_PLUGIN_DESIGN.md) - 完整的架构设计
- [插件开发指南](./PLUGIN_ROUTES_GUIDE.md) - 如何开发自定义插件
- [Server 集成指南](./SERVER_INTEGRATION_GUIDE.md) - 详细的集成步骤
- [P0 改进说明](./P0_IMPROVEMENTS.md) - 安全性改进
- [实施总结](./IMPLEMENTATION_SUMMARY.md) - 完整的实施状态

## 获取帮助

如果遇到问题：

1. 查看服务器日志
2. 运行测试确认功能正常
3. 查阅相关文档
4. 检查配置文件格式

## 许可证

[Your License Here]
