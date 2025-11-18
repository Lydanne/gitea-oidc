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
# 复制示例配置（支持 .json 或 .js 格式，.js 优先级更高）
cp example.gitea-oidc.config.json gitea-oidc.config.json
# 或使用 .js 格式以支持动态配置
# cp example.gitea-oidc.config.json gitea-oidc.config.js

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

- **[快速开始](./docs/QUICK_START.md)** - 5 分钟快速上手
- **[生产环境配置](./docs/PRODUCTION_SETUP.md)** - ⭐ 生产环境部署指南
- **[集成完成](./docs/INTEGRATION_COMPLETE.md)** - 集成状态和使用说明
- **[验证清单](./docs/VERIFICATION_CHECKLIST.md)** - 完整的功能验证
- **[设计文档](./docs/AUTH_PLUGIN_DESIGN.md)** - 架构设计详解
- **[插件开发](./docs/PLUGIN_ROUTES_GUIDE.md)** - 如何开发自定义插件
- **[P0 改进](./docs/P0_IMPROVEMENTS.md)** - 安全性改进说明
- **[集成指南](./docs/SERVER_INTEGRATION_GUIDE.md)** - 详细集成步骤
- **[OIDC 帮助](./docs/OIDC_HELP.md)** - OIDC 相关说明

## 🏗️ 技术栈

- **Node.js 22+** - JavaScript 运行时环境
- **Fastify 5.x** - 高性能 Node.js Web 框架
- **oidc-provider 9.x** - OpenID Certified™ OIDC 服务器
- **TypeScript 5.x** - 类型安全
- **Vitest** - 测试框架
- **Rolldown** - 高性能打包工具
- **bcrypt** - 密码哈希
- **better-sqlite3** - SQLite 数据库
- **pg** - PostgreSQL 客户端
- **redis** - Redis 客户端
- **Zod** - 配置验证

## 📦 项目结构

```bash
gitea-oidc/
├── src/
│   ├── adapters/               # OIDC 适配器
│   │   ├── OidcAdapterFactory.ts
│   │   ├── SqliteAdapter.ts
│   │   ├── RedisAdapter.ts
│   │   └── MemoryAdapter.ts
│   ├── core/
│   │   ├── AuthCoordinator.ts  # 认证协调器
│   │   └── PermissionChecker.ts
│   ├── providers/              # 认证提供者
│   │   ├── LocalAuthProvider.ts
│   │   └── FeishuAuthProvider.ts
│   ├── repositories/           # 用户仓储
│   │   ├── MemoryUserRepository.ts
│   │   ├── SqliteUserRepository.ts
│   │   └── PgsqlUserRepository.ts
│   ├── stores/                 # OAuth State 存储
│   │   └── OAuthStateStore.ts
│   ├── types/                  # 类型定义
│   │   ├── auth.ts
│   │   └── config.ts
│   ├── utils/                  # 工具函数
│   │   ├── configValidator.ts
│   │   └── ...
│   ├── schemas/                # 验证模式
│   ├── __tests__/              # 测试文件
│   ├── config.ts               # 配置加载
│   └── server.ts               # 主服务器
├── public/                     # 静态文件
│   ├── index.html
│   └── error-session-expired.html
├── .htpasswd                   # 密码文件
├── example.gitea-oidc.config.json  # 配置示例
├── Dockerfile                  # Docker 镜像构建
└── vitest.config.ts            # Vitest 配置
```

## 🔧 配置说明

### 配置文件格式

支持两种配置文件格式（按优先级排序）：

1. **gitea-oidc.config.js** - JavaScript 格式，支持动态配置、环境变量、函数导出
2. **gitea-oidc.config.json** - JSON 格式，静态配置

### 配置文件结构

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "http://localhost:3000",
    "trustProxy": false
  },
  "logging": {
    "enabled": true,
    "level": "info"
  },
  "oidc": {
    "issuer": "http://localhost:3000",
    "cookieKeys": [
      "change-this-to-a-random-string-in-production",
      "and-another-one-for-key-rotation"
    ],
    "ttl": {
      "AccessToken": 3600,
      "AuthorizationCode": 600,
      "IdToken": 3600,
      "RefreshToken": 86400
    },
    "claims": {
      "openid": ["sub"],
      "profile": ["name", "email", "email_verified", "picture"]
    },
    "features": {
      "devInteractions": { "enabled": false },
      "registration": { "enabled": false },
      "revocation": { "enabled": true }
    }
  },
  "clients": [
    {
      "client_id": "gitea",
      "client_secret": "gitea-client-secret-change-in-production",
      "redirect_uris": ["http://localhost:3001/user/oauth2/gitea/callback"],
      "response_types": ["code"],
      "grant_types": ["authorization_code", "refresh_token"],
      "token_endpoint_auth_method": "client_secret_basic"
    }
  ],
  "auth": {
    "userRepository": {
      "type": "memory",
      "config": {}
    },
    "providers": {
      "local": {
        "enabled": true,
        "displayName": "本地密码",
        "priority": 1,
        "config": {
          "passwordFile": ".htpasswd",
          "passwordFormat": "bcrypt"
        }
      },
      "feishu": {
        "enabled": false,
        "displayName": "飞书登录",
        "priority": 2,
        "config": {
          "appId": "cli_your_app_id_here",
          "appSecret": "your_app_secret_here",
          "redirectUri": "http://localhost:3000/auth/feishu/callback",
          "scope": "contact:user.base:readonly",
          "autoCreateUser": true,
          "userMapping": {
            "username": "en_name",
            "name": "name",
            "email": "email"
          },
          "encryptKey": "your_encrypt_key_here",
          "verificationToken": "your_verification_token_here"
        }
      }
    }
  },
  "adapter": {
    "type": "sqlite",
    "sqlite": {
      "dbPath": "./oidc.db"
    }
  }
}
```

### 配置字段说明

#### server

- `host`: 服务器监听地址（`0.0.0.0` 表示监听所有网络接口）
- `port`: 服务器端口
- `url`: 公开访问的完整 URL
- `trustProxy`: 是否信任反向代理（Nginx/Traefik 后必须启用）

#### logging

- `enabled`: 是否启用日志
- `level`: 日志级别（`info` | `warn` | `error` | `debug`）

#### oidc

- `issuer`: OIDC 发行者 URL，必须与 `server.url` 一致
- `cookieKeys`: Cookie 签名密钥数组，支持密钥轮换
- `ttl`: 各种令牌的生存时间（秒）
- `claims`: OIDC 声明配置
- `features`: 功能开关

#### auth.userRepository

支持三种用户仓储类型：

**Memory（内存）**

```json
{
  "type": "memory",
  "memory": {}
}
```

**SQLite**

```json
{
  "type": "sqlite",
  "sqlite": {
    "dbPath": "./users.db"
  }
}
```

**PostgreSQL**

```json
{
  "type": "pgsql",
  "pgsql": {
    "connectionString": "postgresql://user:pass@localhost:5432/dbname"
  }
}
```

或使用分离的配置：

```json
{
  "type": "pgsql",
  "pgsql": {
    "host": "localhost",
    "port": 5432,
    "database": "gitea_oidc",
    "user": "postgres",
    "password": "password"
  }
}
```

#### adapter

OIDC 数据持久化适配器配置，支持三种类型：

**SQLite（推荐用于单机部署）**

```json
{
  "type": "sqlite",
  "sqlite": {
    "dbPath": "./oidc.db"
  }
}
```

**Redis（推荐用于分布式部署）**

```json
{
  "type": "redis",
  "redis": {
    "host": "localhost",
    "port": 6379,
    "password": "optional",
    "db": 0
  }
}
```

**Memory（仅用于开发测试）**

```json
{
  "type": "memory"
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

## 🐳 Docker 使用

项目提供官方 Docker 镜像，可用于快速部署。

### 拉取镜像

```bash
# 拉取最新版本
docker pull lydamirror/gitea-oidc:latest

# 拉取指定版本
docker pull lydamirror/gitea-oidc:1.0.3
```

### 运行容器

```bash
# 基本运行
docker run -d -p 3000:3000 lydamirror/gitea-oidc

# 使用自定义配置（JSON 格式）
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -v ./gitea-oidc.config.json:/app/gitea-oidc.config.json \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  lydamirror/gitea-oidc

# 使用自定义配置（JS 格式）
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -v ./gitea-oidc.config.js:/app/gitea-oidc.config.js \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  lydamirror/gitea-oidc
```

### 环境变量

- `NODE_ENV`: 运行环境（默认 development）
- `PORT`: 监听端口（默认 3000）

### 数据持久化

```bash
# 使用 SQLite 持久化（OIDC 会话数据）
docker run -d -p 3000:3000 \
  -v /host/data:/app/data \
  -v ./gitea-oidc.config.json:/app/gitea-oidc.config.json \
  lydamirror/gitea-oidc

# 配置文件中设置：
# "adapter": {
#   "type": "sqlite",
#   "sqlite": {
#     "dbPath": "/app/data/oidc.db"
#   }
# }

# 使用 Redis 持久化（分布式部署）
docker run -d -p 3000:3000 \
  -v ./gitea-oidc.config.json:/app/gitea-oidc.config.json \
  lydamirror/gitea-oidc

# 配置文件中设置：
# "adapter": {
#   "type": "redis",
#   "redis": {
#     "host": "redis",
#     "port": 6379
#   }
# }
```

## 🔐 生产环境

### 安全建议

1. **更换 Cookie 密钥**：修改配置中的 `oidc.cookieKeys`
2. **更换客户端密钥**：修改 `clients[].client_secret`
3. **使用 HTTPS**：配置 SSL 证书，更新 `server.url` 为 https
4. **启用反向代理支持**：设置 `server.trustProxy: true`
5. **强密码策略**：使用 bcrypt 生成强密码（`passwordFormat: "bcrypt"`）
6. **持久化存储**：
   - 用户数据：使用 PostgreSQL 或 SQLite（`auth.userRepository.type`）
   - OIDC 会话：使用 Redis 或 SQLite（`adapter.type`）
7. **日志管理**：配置适当的日志级别（`logging.level`）
8. **限制访问**：配置防火墙规则，仅允许必要的端口访问

### 生产环境配置示例

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "https://auth.example.com",
    "trustProxy": true
  },
  "logging": {
    "enabled": true,
    "level": "warn"
  },
  "oidc": {
    "issuer": "https://auth.example.com",
    "cookieKeys": ["your-secure-random-key-1", "your-secure-random-key-2"]
  },
  "auth": {
    "userRepository": {
      "type": "pgsql",
      "pgsql": {
        "connectionString": "postgresql://user:pass@db:5432/auth"
      }
    }
  },
  "adapter": {
    "type": "redis",
    "redis": {
      "host": "redis",
      "port": 6379
    }
  }
}
```

### 扩展功能

已实现功能：

- ✅ 数据库用户仓储（PostgreSQL、SQLite）
- ✅ Redis 适配器（分布式部署）
- ✅ 插件化认证架构
- ✅ Webhook 支持

计划中的功能：

- ⏳ 添加更多认证插件（企业微信、钉钉、LDAP）
- ⏳ 添加管理界面
- ⏳ 实现 MFA 支持
- ⏳ 用户自助服务（密码重置、账号管理）

## 📄 许可证

ISC License

## 🚀 发布流程

项目使用 [release-it](https://github.com/release-it/release-it) 自动化发布，支持 npm 包发布和 Docker 镜像发布。

### 环境变量配置

发布前需要设置以下环境变量：

- `NPM_TOKEN`: npm 发布令牌
- `GHUB_TOKEN`: GitHub 令牌（用于创建 release）
- `DOCKER_USERNAME`: Docker Hub 用户名
- `DOCKER_PASSWORD`: Docker Hub 密码

### 发布步骤

```bash
# 发布补丁版本
pnpm run release

# 或指定版本类型
pnpm run release -- patch
pnpm run release -- minor
pnpm run release -- major

# 预发布版本
pnpm run release -- prerelease --preReleaseId=beta
```

发布流程将自动执行：

1. 构建生产版本
2. 递增版本号
3. 提交 Git 变更和标签
4. 推送代码到 GitHub
5. 创建 GitHub Release
6. 发布到 npm
7. 触发 Docker 镜像构建和推送

### CI/CD

项目使用 GitHub Actions 实现完整的 CI/CD 流程：

- **CI 工作流**：在每次推送和 PR 时运行代码检查、测试和构建
- **发布工作流**：支持手动触发和自动发布，包括 npm 包发布和 Docker 镜像构建

#### 所需环境变量

在 GitHub 仓库设置中配置以下 Secrets：

- `NPM_TOKEN`: npm 发布令牌
- `GHUB_TOKEN`: 自动配置（用于创建 release）
- `DOCKER_USERNAME`: Docker Hub 用户名
- `DOCKER_PASSWORD`: Docker Hub 密码

#### 手动发布

1. 进入 GitHub 仓库的 Actions 标签页
2. 选择 "Release" 工作流
3. 点击 "Run workflow" 按钮
4. 选择发布类型（patch/minor/major/prerelease）

#### 自动发布

推送代码到主分支时会自动触发发布流程（补丁版本）。

---

**更多详细信息请查看 [文档目录](#-文档)**
