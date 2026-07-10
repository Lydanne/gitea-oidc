# Gitea OIDC Identity Provider

[English README](./README.en.md) · [中文文档](./README.md)

[![CI-CHECK](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml)
[![Release](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/gitea-oidc)](https://www.npmjs.com/package/gitea-oidc)
[![Docker pulls](https://img.shields.io/docker/pulls/lydamirror/gitea-oidc)](https://hub.docker.com/r/lydamirror/gitea-oidc)
![Node version](https://img.shields.io/badge/node-%3E%3D22.0.0-43853d?logo=node.js)
![License](https://img.shields.io/badge/license-MIT-blue)
[![codecov](https://codecov.io/gh/Lydanne/gitea-oidc/branch/main/graph/badge.svg)](https://codecov.io/gh/Lydanne/gitea-oidc)
[![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

一个使用 Fastify + TypeScript + oidc-provider 实现的可扩展 OIDC (OpenID Connect) 身份提供者，支持多种认证方式的插件化架构。

## 📚 目录

- [✨ 功能特性](#-功能特性)
- [🚀 快速开始](#-快速开始)
- [📖 文档](#-文档)
- [🏗️ 技术栈](#技术栈)
- [📦 项目结构](#-项目结构)
- [🔧 配置说明](#-配置说明)
- [🔗 Gitea 集成](#-gitea-集成)
- [🐳 Docker 使用](#-docker-使用)
- [🔐 生产环境](#-生产环境)
- [🚀 发布流程](#-发布流程)
- [CI/CD](#cicd)

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

#### 方式 1: 直接启动（推荐）

```bash
# 开发模式（热重载）
pnpm dev

# 生产模式
pnpm build && pnpm start
```

服务器将在 `http://localhost:3000` 启动

#### 方式 2: 作为模块导入使用

如果你需要在其他项目中集成此服务器，可以作为模块导入：

```typescript
import { start } from 'gitea-oidc/server';
import type { GiteaOidcConfig } from 'gitea-oidc/config';

// 使用自定义配置启动
const customConfig: GiteaOidcConfig = {
  server: {
    host: '0.0.0.0',
    port: 4000,
    url: 'http://localhost:4000',
    trustProxy: false,
    corsOrigins: [],
  },
  // ... 其他配置
};

const app = await start(customConfig);

// 或者不传入配置，使用配置文件
const app = await start();
```

传入 `customConfig` 时同样会执行配置校验；生产环境中的非 HTTPS URL、弱密钥、
memory 存储和不完整 Provider API allowlist 会直接阻止启动。详细示例请参考
`docs/SERVER_USAGE.md`。

### 4. 测试

```bash
# 运行测试
pnpm test

# 查看覆盖率
pnpm test:coverage
```

## 📖 文档

- **[文档目录](https://github.com/Lydanne/gitea-oidc/blob/main/docs/README.md)** - 使用者与开发者文档入口
- **[快速开始](https://github.com/Lydanne/gitea-oidc/blob/main/docs/QUICK_START.md)** - 本地启动和 Gitea OIDC 配置
- **[生产环境配置](https://github.com/Lydanne/gitea-oidc/blob/main/docs/PRODUCTION_SETUP.md)** - 生产环境部署指南
- **[反向代理 HTTPS](https://github.com/Lydanne/gitea-oidc/blob/main/docs/REVERSE_PROXY_HTTPS.md)** - 代理和 HTTPS URL 配置
- **[OIDC 适配器配置](https://github.com/Lydanne/gitea-oidc/blob/main/docs/ADAPTER_CONFIGURATION.md)** - SQLite、Redis、memory 适配器选择
- **[飞书认证插件](https://github.com/Lydanne/gitea-oidc/blob/main/docs/FEISHU_PLUGIN_GUIDE.md)** - 飞书 OAuth 登录配置
- **[管理后台与 Provider API](https://github.com/Lydanne/gitea-oidc/blob/main/docs/ADMIN_AND_PROVIDER_API.md)** -
  后台、token 探活和 SDK 代理
- **[开发者文档](https://github.com/Lydanne/gitea-oidc/blob/main/docs/dev/README.md)** - 插件开发、架构和发布维护

## 技术栈

- **Node.js 22+** - JavaScript 运行时环境
- **Fastify 5.x** - 高性能 Node.js Web 框架
- **oidc-provider 9.x** - OpenID Certified™ OIDC 服务器
- **TypeScript 5.x** - 类型安全
- **Vue 3 + Vue Router + Vite + PrimeVue** - 内置管理后台构建
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
├── apps/
│   ├── admin-web/              # Vue 管理台应用
│   └── idp-server/             # 生产服务进程入口
├── packages/
│   └── server-core/            # gitea-oidc 兼容包与认证服务核心
│       ├── src/
│       │   ├── identityServer.ts # 创建 Fastify/OIDC 运行时，不监听端口
│       │   ├── server.ts       # 兼容 start() 与进程信号入口
│       │   ├── core/           # 认证核心
│       │   ├── adapters/       # OIDC 持久化适配器
│       │   ├── providers/      # 认证提供者插件
│       │   ├── repositories/   # 用户与 Provider token 仓储
│       │   └── sdk/            # 待迁移的兼容 SDK
│       └── public/             # 服务包内静态资源
├── docs/                       # 用户与开发者文档
├── example.gitea-oidc.config.json  # JSON 配置示例
├── Dockerfile                  # Docker 镜像构建
├── pnpm-lock.yaml
└── pnpm-workspace.yaml         # Workspace 边界
```

根 `package.json` 只负责编排。公开 npm 包仍名为 `gitea-oidc`，位于
`packages/server-core/`；生产镜像从 `apps/idp-server/` 启动。

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
    "issuer": "http://localhost:3000/oidc",
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
      "profile": ["name", "email", "email_verified", "picture"],
      "provider_api": []
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
      "redirect_uris": [
        "http://localhost:3001/user/oauth2/gitea/callback",
        "http://localhost:3000/admin/callback"
      ],
      "post_logout_redirect_uris": ["http://localhost:3001/"],
      "response_types": ["code"],
      "grant_types": ["authorization_code", "refresh_token"],
      "token_endpoint_auth_method": "client_secret_basic"
    }
  ],
  "auth": {
    "userRepository": {
      "type": "memory",
      "memory": {}
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

- `issuer`: OIDC 发行者 URL，必须等于 `${server.url}/oidc`，应与实际挂载路径 `/oidc`
  对应，不能包含 query 或 fragment
- `cookieKeys`: Cookie 签名密钥数组，支持密钥轮换
- `ttl`: 各种令牌的生存时间（秒）
- `claims`: OIDC 声明配置
- `features`: 功能开关

#### auth.userRepository

支持三种用户仓储类型：

##### Memory（内存）

```json
{
  "type": "memory",
  "memory": {}
}
```

##### SQLite

```json
{
  "type": "sqlite",
  "sqlite": {
    "dbPath": "./users.db"
  }
}
```

##### PostgreSQL

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

##### SQLite（推荐用于单机部署）

```json
{
  "type": "sqlite",
  "sqlite": {
    "dbPath": "./oidc.db"
  }
}
```

##### Redis（推荐用于分布式部署）

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

##### Memory（仅用于开发测试）

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
docker pull lydamirror/gitea-oidc:<version>  # 例如 1.0.22，具体以实际发布的 tag 为准
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
- `PORT`: 当前服务不会自动读取该变量，请通过配置文件 `server.port` 和容器端口映射控制实际监听端口

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
   并用 `server.trustedProxyIps` 限定实际代理的 IP/CIDR
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
    "trustProxy": true,
    "trustedProxyIps": ["127.0.0.1"]
  },
  "logging": {
    "enabled": true,
    "level": "warn"
  },
  "oidc": {
    "issuer": "https://auth.example.com/oidc",
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

## 🚀 发布流程

更多关于发布与 CI/CD 的说明已迁移至独立文档：

- **[发布与 CI/CD 指南](https://github.com/Lydanne/gitea-oidc/blob/main/docs/dev/RELEASE_AND_CI_CD.md)** -
  release-it 与 GitHub Actions 工作流说明

该文档涵盖：

- 使用 `release-it` 进行版本发布与 npm 发布
- 发布所需环境变量 / GitHub Secrets 配置
- GitHub Actions 中 `Release` / `CI-CHECK` 工作流的执行流程
- Docker 镜像构建与推送流程

## CI/CD

本项目使用 GitHub Actions 提供完整的 CI 与发布自动化，详情请参考上面的「发布与 CI/CD 指南」文档。

## 📄 许可证

MIT License

## Team

XGJ lydanne

---

**更多详细信息请查看 [文档目录](#-文档)**
