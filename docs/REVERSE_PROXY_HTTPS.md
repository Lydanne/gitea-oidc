# 反向代理 HTTPS 配置指南

生产环境必须由受信任的反向代理终止 TLS。gitea-oidc 根据公开 URL 和代理转发头生成 OIDC
端点，因此代理信任边界配置错误会导致 HTTP 端点、错误回调或伪造来源地址。

## 服务端配置

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "url": "https://id.example.com",
    "trustProxy": true,
    "trustedProxyIps": ["127.0.0.1"],
    "corsOrigins": []
  },
  "oidc": {
    "issuer": "https://id.example.com/oidc"
  }
}
```

关键约束：

- `server.url` 是公开服务根地址，不包含 `/oidc`、query 或 fragment。
- `oidc.issuer` 必须精确等于 `${server.url}/oidc`。
- `trustProxy` 在生产环境必须为 `true`。
- `trustedProxyIps` 只包含应用实际看到的代理来源 IP 或最小 CIDR。
- `corsOrigins` 与反向代理无关，默认保持空数组；只有浏览器跨域调用时才添加精确 HTTPS Origin。

当代理和服务都在宿主机上时，来源通常是 `127.0.0.1`。当任一方位于容器中时，应用看到的来源
可能是容器 IP、网桥网关或内部负载均衡地址，必须按实际网络确认，不能照抄示例。

OIDC Provider 会启用代理模式读取 `X-Forwarded-*`。因此服务端口必须只对代理所在的受控网络
开放，不能同时暴露给公网客户端。Docker 映射到宿主机代理时使用：

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

## Nginx

```nginx
server {
    listen 80;
    server_name id.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name id.example.com;

    ssl_certificate /etc/letsencrypt/live/id.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/id.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }
}
```

如果代理到容器或远端节点，将 `proxy_pass` 和 `trustedProxyIps` 同时改成实际内部地址。不要使用
客户端可控制的请求头覆盖固定的 `X-Forwarded-Proto`。

## Traefik

```yaml
services:
  idp:
    image: lydamirror/gitea-oidc:${GITEA_OIDC_VERSION}
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.gitea-oidc.rule=Host(`id.example.com`)"
      - "traefik.http.routers.gitea-oidc.entrypoints=websecure"
      - "traefik.http.routers.gitea-oidc.tls=true"
      - "traefik.http.services.gitea-oidc.loadbalancer.server.port=3000"

networks:
  proxy:
    external: true
```

把 `trustedProxyIps` 设置为 Traefik 在该网络中的实际 IP 或受控子网。不要发布 IdP 的 `3000`
端口到公网。

## Caddy

```caddy
id.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 默认传递所需的反向代理头。服务端仍需设置 `trustProxy: true`，并将
`trustedProxyIps` 限制为 Caddy 的实际来源地址。

## 验证 HTTPS 边界

```bash
curl --fail --silent --show-error \
  https://id.example.com/oidc/.well-known/openid-configuration | jq \
  '{issuer, authorization_endpoint, token_endpoint, userinfo_endpoint, end_session_endpoint, jwks_uri}'
```

检查每个 URL：

- 协议都是 `https`。
- 主机都是 `id.example.com`。
- Issuer 精确等于 `https://id.example.com/oidc`。
- 没有容器名、内网 IP、错误端口或重复 `/oidc`。

确认 HTTP 入口只做重定向：

```bash
curl --head http://id.example.com/oidc/.well-known/openid-configuration
```

确认公网不能直接访问源站端口：

```bash
nc -vz id.example.com 3000
```

该连接应失败；只有反向代理所在主机或内部网络可以连接源站端口。

## Gitea 和飞书回调

公开域名变化时，同时更新：

- `server.url`
- `oidc.issuer`
- `clients[].redirect_uris`
- `clients[].post_logout_redirect_uris`
- `auth.providers.feishu.config.redirectUri`
- Gitea 或其他业务 Client 保存的发现 URL和 Client 配置
- 飞书开放平台登记的回调地址

飞书生产回调必须是：

```text
https://id.example.com/auth/feishu/callback
```

Gitea 的 Callback URL 和退出回跳见[Gitea 接入指南](./GITEA_INTEGRATION.md)。

## 常见问题

### Issuer 正确，但其他端点仍是 HTTP

确认代理传递了 `X-Forwarded-Proto: https`，服务开启了 `trustProxy`，并且请求确实经过受信任
代理。修改后重新请求发现文档，不要只查看浏览器缓存。

### 日志中的客户端 IP 是代理地址

检查 `trustedProxyIps` 是否匹配应用实际看到的代理来源。容器网络下不要假设代理是
`127.0.0.1`。

### 配置校验提示缺少 `trustedProxyIps`

生产环境禁止无边界信任转发头。填写真实代理 IP 或最小 CIDR，不能使用空数组。

### 反向代理返回 `502`

检查：

- 容器或进程是否正在监听 `server.host` 和 `server.port`。
- 代理是否能访问源站网络。
- Docker 端口是否只绑定到正确宿主地址。
- 服务是否因生产配置校验失败而退出。

### 修改域名后登录或退出失败

旧的 Redirect URI 和 Post Logout Redirect URI 不会自动迁移。同步更新所有 Client，并检查精确
匹配和末尾 `/`。

## 相关文档

- [生产部署指南](./PRODUCTION_SETUP.md)
- [生产运维手册](./OPERATIONS.md)
- [Gitea 接入指南](./GITEA_INTEGRATION.md)
