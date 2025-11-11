# Gitea OIDC Identity Provider

一个使用 Fastify + TypeScript + oidc-provider 实现的可扩展 OIDC (OpenID Connect) 身份提供者，支持多种认证方式的插件化架构。

## ✨ 功能特性

### 核心功能
- ✅ 完整的 OIDC 认证流程支持
- ✅ 插件化认证架构
- ✅ 多种认证方式（本地密码、飞书、可扩展）
- ✅ 统一登录页面
- ✅ OAuth State 管理（防 CSRF）
- ✅ 用户仓储抽象层
- ✅ 动态路由和静态资源
- ✅ Webhook 支持
- ✅ TypeScript 类型安全
- ✅ 完整的测试覆盖

### 认证插件
- 🔐 **本地密码认证** - 支持 htpasswd 格式（bcrypt, MD5, SHA）
- 🚀 **飞书认证** - 完整的 OAuth 2.0 流程
- 🔌 **可扩展** - 轻松添加新的认证方式

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置

```bash
# 复制示例配置
cp example.gitea-oidc.config.json gitea-oidc.config.json

# 创建密码文件（本地认证）
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync('admin123', 10));" > .htpasswd
```

### 3. 启动服务器

```bash
# 开发模式（热重载）
pnpm dev

# 生产模式
pnpm build && pnpm start
```

服务器将在 `http://localhost:3000` 启动

### 4. 测试

```bash
# 运行测试
pnpm test

# 查看覆盖率
pnpm test:coverage
```

## 📖 文档

- **[快速开始](./QUICK_START.md)** - 5 分钟快速上手
- **[集成完成](./INTEGRATION_COMPLETE.md)** - 集成状态和使用说明
- **[验证清单](./VERIFICATION_CHECKLIST.md)** - 完整的功能验证
- **[设计文档](./AUTH_PLUGIN_DESIGN.md)** - 架构设计详解
- **[插件开发](./PLUGIN_ROUTES_GUIDE.md)** - 如何开发自定义插件
- **[P0 改进](./P0_IMPROVEMENTS.md)** - 安全性改进说明
- **[集成指南](./SERVER_INTEGRATION_GUIDE.md)** - 详细集成步骤
- **[OIDC 帮助](./OIDC_HELP.md)** - OIDC 相关说明

## 🏗️ 技术栈

- **Fastify 5.x** - 高性能 Node.js Web 框架
- **oidc-provider 8.x** - OpenID Certified™ OIDC 服务器
- **TypeScript 5.x** - 类型安全
- **Jest** - 测试框架
- **bcrypt** - 密码哈希

## 📦 项目结构

```
gitea-oidc/
├── src/
│   ├── core/
│   │   └── AuthCoordinator.ts      # 认证协调器
│   ├── providers/
│   │   ├── LocalAuthProvider.ts    # 本地密码认证
│   │   └── FeishuAuthProvider.ts   # 飞书认证
│   ├── repositories/
│   │   └── MemoryUserRepository.ts # 用户存储
│   ├── stores/
│   │   └── MemoryStateStore.ts     # OAuth State 存储
│   ├── types/
│   │   ├── auth.ts                 # 认证类型定义
│   │   └── config.ts               # 配置类型
│   ├── __tests__/                  # 测试文件
│   ├── config.ts                   # 配置加载
│   └── server.ts                   # 主服务器
├── .htpasswd                       # 密码文件
├── example.gitea-oidc.config.json  # 配置示例
└── jest.config.js                  # Jest 配置
```

## 🔧 配置说明

### 配置文件结构

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "http://localhost:3000"
  },
  "auth": {
    "userRepository": {
      "type": "memory"
    },
    "providers": {
      "local": {
        "enabled": true,
        "config": {
          "passwordFile": ".htpasswd",
          "passwordFormat": "bcrypt"
        }
      },
      "feishu": {
        "enabled": false,
        "config": {
          "appId": "your_app_id",
          "appSecret": "your_app_secret"
        }
      }
    }
  }
}
```

### 测试账户

`.htpasswd` 文件中的测试用户：
- **用户名**: `admin` / **密码**: `admin123`
- **用户名**: `testuser` / **密码**: `password`

## 🔗 Gitea 集成

### 配置 OIDC 认证源

1. 进入 Gitea **管理面板** → **认证源** → **添加认证源**
2. 选择 **OpenID Connect**
3. 填写配置：
   - **发现 URL**: `http://localhost:3000/oidc/.well-known/openid-configuration`
   - **客户端 ID**: `gitea`
   - **客户端密钥**: `gitea-client-secret-change-in-production`
4. 保存配置

### 测试登录

1. 访问 Gitea 登录页面
2. 点击 OIDC 登录按钮
3. 使用测试账户登录（admin/admin123）
4. 成功后自动返回 Gitea

## 🔐 生产环境

### 安全建议

1. **更换 Cookie 密钥**：修改配置中的 `cookieKeys`
2. **使用 HTTPS**：配置 SSL 证书
3. **强密码策略**：使用 bcrypt 生成强密码
4. **数据库存储**：实现 PostgreSQL/MySQL 用户仓储
5. **Redis State Store**：用于分布式部署

### 扩展功能

- 实现数据库用户仓储（PostgreSQL/MySQL）
- 实现 Redis State Store
- 添加更多认证插件（企业微信、钉钉、LDAP）
- 添加管理界面
- 实现 MFA 支持

## 📄 许可证

ISC License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**更多详细信息请查看 [文档目录](#-文档)**
