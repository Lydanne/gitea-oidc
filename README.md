# Gitea OIDC Identity Provider

[English README](./README.en.md) · [中文文档](./README.md)

[![CI-CHECK](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/ci-check.yml)
[![Release](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml/badge.svg)](https://github.com/Lydanne/gitea-oidc/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/gitea-oidc)](https://www.npmjs.com/package/gitea-oidc)
[![Docker pulls](https://img.shields.io/docker/pulls/lydamirror/gitea-oidc)](https://hub.docker.com/r/lydamirror/gitea-oidc)
![Node version](https://img.shields.io/badge/node-22.13.x-43853d?logo=node.js)
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
- ✅ 可选的应用管理、Gitea 版本化模板和 Client Secret 轮换
- ✅ Node SDK、Express、Fastify、NestJS 与 CLI 私有预览包
- ✅ 单机生产可用的加密 SQLite 客户端 Session Store
- ✅ OAuth State 管理（防 CSRF）
- ✅ 用户仓储抽象层
- ✅ 用户登录、退出、管理后台和资料变更结构化审计
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
# 复制本地开发示例配置
cp example.gitea-oidc.config.json gitea-oidc.config.json

# 交互输入本地管理员密码并创建 bcrypt 密码文件
read -r -s ADMIN_PASSWORD
export ADMIN_PASSWORD
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10));" > .htpasswd
unset ADMIN_PASSWORD
chmod 0600 .htpasswd
```

### 3. 启动服务器

#### 方式 1: 直接启动（推荐）

```bash
# 开发模式（热重载）
pnpm dev

# 验证生产构建
pnpm build:prod
```

服务器将在 `http://localhost:3000` 启动

`pnpm start` 会进入生产模式，本地 HTTP/memory 示例会被安全校验拒绝。正式启动方式见
[生产部署指南](./docs/PRODUCTION_SETUP.md)。

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

- **[文档目录](./docs/README.md)** - 使用者与开发者文档入口
- **[快速开始](./docs/QUICK_START.md)** - 本地启动和 Gitea OIDC 配置
- **[Gitea 接入](./docs/GITEA_INTEGRATION.md)** - Client、登录退出和用户组映射
- **[生产部署](./docs/PRODUCTION_SETUP.md)** - 拓扑、密钥、Docker Compose 和上线验收
- **[生产运维](./docs/OPERATIONS.md)** - 健康检查、备份恢复、升级回滚和监控
- **[反向代理 HTTPS](./docs/REVERSE_PROXY_HTTPS.md)** - 代理和 HTTPS URL 配置
- **[OIDC 适配器配置](./docs/ADAPTER_CONFIGURATION.md)** - SQLite、Redis、memory 适配器选择
- **[飞书认证插件](./docs/FEISHU_PLUGIN_GUIDE.md)** - 飞书 OAuth 登录配置
- **[管理后台与 Provider API](./docs/ADMIN_AND_PROVIDER_API.md)** - 后台、审计、token 探活和 SDK 代理
- **[应用管理接入](./docs/APPLICATION_MANAGEMENT.md)** - 模板、自定义应用、SDK 与 SQLite 部署约束
- **[开发者文档](./docs/dev/README.md)** - 插件开发、架构和发布维护

## 技术栈

- **Node.js 22.13.x** - 仓库开发与构建运行时
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
│   ├── contracts/              # 应用和连接器共用的版本化 wire contract
│   ├── application-templates/  # 版本化 Gitea 应用模板
│   ├── applications/           # 应用、Client、Secret、审计和 SQLite 仓储
│   ├── oidc-client/            # @gitea-oidc/node 框架无关 OIDC 核心
│   ├── oidc-client-sqlite/     # 加密 SQLite stores 与 refresh lock
│   ├── connector-core/         # 框架连接器共享 HTTP 核心
│   ├── express/                # Express 4/5 连接器
│   ├── fastify/                # Fastify 5 连接器
│   ├── nestjs/                 # NestJS 10/11 连接器
│   ├── cli/                    # 本地接入 CLI
│   ├── connector-testkit/      # 私有连接器一致性测试
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
  "audit": {
    "enabled": true,
    "retentionDays": 30
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
  "applications": {
    "enabled": false,
    "clientSource": "config",
    "repository": {
      "type": "sqlite",
      "sqlite": { "dbPath": "./applications.db" }
    },
    "secretEncryption": {
      "keyId": "applications-v1",
      "masterKey": ""
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

#### audit

- `enabled`: 是否记录用户登录、退出、管理后台和用户资料变更事件，默认 `true`
- `retentionDays`: 审计记录保留天数，默认 `30`，范围 `1` 到 `3650`；超过期限的记录自动删除
- 存储后端与 `auth.userRepository` 相同；生产环境不要使用 `memory`

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

#### applications

默认使用 `enabled: false` 和 `clientSource: "config"`，OIDC Provider 直接读取静态
`clients[]`。启用后台应用管理时必须同时切换为 `enabled: true` 和
`clientSource: "database"`，配置独立的 32 字节 Base64/Base64URL 主密钥，并使用单实例
SQLite。完整配置和备份要求见[应用管理接入指南](./docs/APPLICATION_MANAGEMENT.md)。

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
   - **认证源名称**: `gitea`，对应 Callback URL
     `http://localhost:3001/user/oauth2/gitea/callback`
4. 保存配置

### 测试登录

1. 访问 Gitea 登录页面
2. 点击 OIDC 登录按钮
3. 使用刚才创建的 `admin` 账号和交互输入的密码登录
4. 成功后自动返回 Gitea

退出回跳 URI 必须精确注册为 `http://localhost:3001/`。生产环境的 Callback、退出回跳和排障步骤
见 **[Gitea 接入指南](./docs/GITEA_INTEGRATION.md)**。

## 🐳 Docker 使用

项目提供 `linux/amd64` 和 `linux/arm64` Docker 镜像。镜像以 `NODE_ENV=production` 启动，必须
挂载通过生产校验的配置文件；无配置直接运行会拒绝启动。

### 拉取镜像

```bash
docker pull lydamirror/gitea-oidc:<version>
```

生产环境固定版本号，不使用 `latest`。最小运行结构：

```bash
docker run -d --name gitea-oidc \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  --env-file /srv/gitea-oidc/.env.production \
  -v /srv/gitea-oidc/gitea-oidc.config.js:/app/gitea-oidc.config.js:ro \
  -v /srv/gitea-oidc/data:/app/data \
  -v /srv/gitea-oidc/secrets:/app/secrets:ro \
  --restart unless-stopped \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  lydamirror/gitea-oidc:<version>
```

完整的配置、Compose、持久化目录、HTTPS 代理和验收命令见
**[生产部署指南](./docs/PRODUCTION_SETUP.md)**。

## 🔐 生产环境

生产部署至少需要：HTTPS 公开地址、受限反向代理信任、强且分域的密钥、持久化用户/OIDC/JWKS
存储、已验证备份，以及真实 Gitea 登录和退出测试。单实例应用管理与多实例 Redis 是两种不同
拓扑，不能混用。

- **[生产部署指南](./docs/PRODUCTION_SETUP.md)**：从零部署和上线检查清单
- **[Gitea 接入指南](./docs/GITEA_INTEGRATION.md)**：Client、Callback 与退出回跳
- **[生产运维手册](./docs/OPERATIONS.md)**：备份、恢复、升级、回滚、监控和密钥轮换

## 🚀 发布流程

更多关于发布与 CI/CD 的说明已迁移至独立文档：

- **[发布与 CI/CD 指南](./docs/dev/RELEASE_AND_CI_CD.md)** - release-it 与 GitHub Actions 工作流说明

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
