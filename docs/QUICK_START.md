# 快速开始指南

本指南帮助你在本地启动 gitea-oidc，并用本地密码认证完成一次 OIDC 登录准备。

## 前置条件

- Node.js 22+
- pnpm 10+

## 1. 安装依赖

```bash
pnpm install
```

## 2. 创建配置文件

```bash
cp example.gitea-oidc.config.json gitea-oidc.config.json
```

项目也支持 `gitea-oidc.config.js`。如果两个文件同时存在，JS 配置优先。

## 3. 创建密码文件

```bash
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync('admin123', 10));" > .htpasswd
```

生成后可以使用用户名 `admin`、密码 `admin123` 测试本地登录。

## 4. 检查关键配置

编辑 `gitea-oidc.config.json`，至少确认以下字段适合你的环境：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "http://localhost:3000",
    "trustProxy": false
  },
  "oidc": {
    "issuer": "http://localhost:3000/oidc"
  },
  "auth": {
    "providers": {
      "local": {
        "enabled": true,
        "config": {
          "passwordFile": ".htpasswd",
          "passwordFormat": "bcrypt"
        }
      }
    }
  }
}
```

生产环境请替换 `cookieKeys`、客户端密钥，并配置持久化 JWKS。详见
[生产环境配置](./PRODUCTION_SETUP.md)。

## 5. 启动服务

```bash
pnpm dev
```

生产方式：

```bash
pnpm build
pnpm start
```

## 6. 验证 OIDC 端点

```bash
curl http://localhost:3000/oidc/.well-known/openid-configuration
```

如果返回 JSON 发现文档，说明服务已正常启动。

## 7. 配置 Gitea

在 Gitea 管理后台添加 OAuth2 认证源：

- OAuth2 提供者：OpenID Connect
- 客户端 ID：`gitea`
- 客户端密钥：与你的 `clients[].client_secret` 保持一致
- 自动发现 URL：`http://localhost:3000/oidc/.well-known/openid-configuration`

回调地址需要加入 `clients[].redirect_uris`，例如：

```json
{
  "redirect_uris": ["http://localhost:3001/user/oauth2/gitea/callback"]
}
```

## 8. 常用检查

```bash
pnpm test
pnpm lint
pnpm build
```

## 常见问题

### 登录页面没有本地登录表单？

检查 `auth.providers.local.enabled` 是否为 `true`，以及 `.htpasswd` 路径是否正确。

### 本地密码认证失败？

检查 `.htpasswd` 是否存在，用户名是否匹配，bcrypt 哈希是否完整。

### 飞书登录失败？

检查飞书应用的 `appId`、`appSecret`、回调地址和权限范围。完整步骤见
[飞书认证插件使用指南](./FEISHU_PLUGIN_GUIDE.md)。

### 生产环境 URL 不对或变成 HTTP？

反向代理后需要正确设置 `server.url`、`oidc.issuer` 和 `server.trustProxy`。详见
[反向代理 HTTPS 配置指南](./REVERSE_PROXY_HTTPS.md)。

## 下一步

- 部署前阅读 [生产环境配置](./PRODUCTION_SETUP.md)
- 了解启动方式阅读 [Server 使用指南](./SERVER_USAGE.md)
- 配置存储阅读 [OIDC 适配器配置指南](./ADAPTER_CONFIGURATION.md)
- 开发认证插件阅读 [开发者文档](./dev/README.md)
