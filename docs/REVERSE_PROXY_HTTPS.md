# 反向代理 HTTPS 配置指南

当你在反向代理（如 Nginx、Traefik、Caddy）后部署 gitea-oidc 时，需要正确配置以确保 OIDC 发现文档中的所有 URL 都使用 HTTPS。

## 问题现象

如果配置不正确，访问 `https://your-domain.com/oidc/.well-known/openid-configuration` 会看到：

```json
{
  "issuer": "https://your-domain.com",
  "authorization_endpoint": "http://your-domain.com/oidc/auth",  // ❌ 错误：应该是 https
  "token_endpoint": "http://your-domain.com/oidc/token",         // ❌ 错误：应该是 https
  ...
}
```

## 解决方案

### 1. 配置文件设置

在你的 `gitea-oidc.config.json` 或 `gitea-oidc.config.js` 中：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "https://your-domain.com",
    "trustProxy": true  // ⭐ 关键配置：启用代理信任
  },
  "oidc": {
    "issuer": "https://your-domain.com",  // ⭐ 使用 HTTPS
    ...
  }
}
```

**关键配置说明：**

- `server.url`: 设置为公网访问的 HTTPS 地址
- `oidc.issuer`: 必须与 `server.url` 一致，使用 HTTPS
- `server.trustProxy`: **必须设置为 `true`**，这样应用才能识别反向代理传递的协议信息

### 2. 反向代理配置

确保你的反向代理正确转发了 `X-Forwarded-*` 头信息。

#### Nginx 配置示例

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        
        # ⭐ 关键：转发原始请求信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;  # 告诉应用原始协议是 HTTPS
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

#### Traefik 配置示例（docker-compose.yml）

```yaml
services:
  gitea-oidc:
    image: your-image
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.oidc.rule=Host(`your-domain.com`)"
      - "traefik.http.routers.oidc.entrypoints=websecure"
      - "traefik.http.routers.oidc.tls.certresolver=letsencrypt"
      - "traefik.http.services.oidc.loadbalancer.server.port=3000"
```

Traefik 会自动添加 `X-Forwarded-*` 头。

#### Caddy 配置示例

```caddy
your-domain.com {
    reverse_proxy localhost:3000
}
```

Caddy 会自动处理 HTTPS 和转发头信息。

## 工作原理

1. **客户端** → HTTPS 请求 → **反向代理**（Nginx/Traefik）
2. **反向代理** → HTTP 请求 + `X-Forwarded-Proto: https` 头 → **gitea-oidc**
3. **gitea-oidc** 检测到 `trustProxy: true`，识别 `X-Forwarded-Proto` 头
4. **oidc-provider** 生成 HTTPS 的端点 URL

### 技术细节

- `trustProxy: true` 会同时配置 Fastify 和 oidc-provider（Koa）
- Fastify 的 `trustProxy` 让它能识别 `X-Forwarded-*` 头
- oidc-provider 的 `proxy` 属性（Koa 特性）让它能正确生成 HTTPS URL

## 验证配置

配置完成后，重启服务并验证：

```bash
# 检查发现文档
curl https://your-domain.com/oidc/.well-known/openid-configuration | jq

# 确认所有端点都是 HTTPS
```

正确的输出应该是：

```json
{
  "issuer": "https://your-domain.com",
  "authorization_endpoint": "https://your-domain.com/oidc/auth",  // ✅ 正确
  "token_endpoint": "https://your-domain.com/oidc/token",         // ✅ 正确
  "userinfo_endpoint": "https://your-domain.com/oidc/me",         // ✅ 正确
  ...
}
```

## 常见问题

### Q: 我已经设置了 `issuer` 为 HTTPS，为什么其他端点还是 HTTP？

A: 仅设置 `issuer` 不够，必须同时设置 `trustProxy: true`。oidc-provider 会根据**实际请求的协议**生成端点 URL，而不是仅依赖 issuer 配置。

### Q: 本地开发时需要设置 `trustProxy` 吗？

A: 不需要。本地开发直接访问应用时，设置为 `false` 即可。只有在反向代理后才需要启用。

### Q: 我使用的是 Docker，需要特别配置吗？

A: 配置方式相同。确保：
1. 容器内的配置文件设置了 `trustProxy: true`
2. 反向代理正确转发了 `X-Forwarded-*` 头
3. 容器可以被反向代理访问（网络配置正确）

### Q: 飞书登录的回调 URL 也需要改吗？

A: 是的。如果启用了飞书登录，`redirectUri` 也要使用 HTTPS：

```json
{
  "auth": {
    "providers": {
      "feishu": {
        "enabled": true,
        "config": {
          "redirectUri": "https://your-domain.com/auth/feishu/callback"
        }
      }
    }
  }
}
```

## 安全建议

1. **生产环境必须使用 HTTPS**
2. **使用有效的 SSL 证书**（Let's Encrypt 免费证书即可）
3. **定期更新 `cookieKeys`**
4. **启用 HSTS**（在反向代理层配置）

```nginx
# Nginx HSTS 配置
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```
