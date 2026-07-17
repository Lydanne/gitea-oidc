# 生产部署指南

本文是 X OIDC 的生产部署主入口，面向部署者和运维人员。推荐先按本文完成单实例
SQLite 部署，再根据容量和可用性要求评估多实例 Redis 方案。

生产进程会执行严格配置校验。缺少配置文件、使用 HTTP 公网地址、使用默认密钥、使用
`memory` 持久化或错误配置反向代理时，服务会拒绝启动。

## 选择部署拓扑

| 场景 | 用户仓储 | OIDC 数据 | 短期状态 | 应用管理 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 单实例 | SQLite 或 PostgreSQL | SQLite | memory | 可启用 SQLite | 当前推荐 |
| 多实例 | PostgreSQL | Redis | Redis | 必须关闭 | 需要额外基础设施 |
| 开发测试 | memory 或 SQLite | memory 或 SQLite | memory | 可选 | 禁止用于生产 |

单实例模式支持内置应用管理、Gitea 模板、Client Secret 轮换和完整后台能力。SQLite 文件必须
位于本地持久化磁盘，不能由多个实例并发访问，也不要放在 NFS 上。

多实例模式必须同时使用 Redis OIDC Adapter 和 Redis `auth.stateStore`。当前
`applications.clientSource: "database"` 只支持单实例 SQLite，因此多实例部署必须使用静态
`clients`，并关闭应用管理。

## 上线前准备

至少准备以下资源：

- 一个只用于身份服务的 HTTPS 域名，例如 `https://id.example.com`。
- 一个反向代理，由它终止 TLS，并把流量转发到服务的 `3000` 端口。
- Docker 及 Docker Compose，或者 Node.js `22.13+` 与 pnpm `10+`。
- 单实例部署所需的持久化数据目录和备份目录。
- 可安全保存环境变量和密钥的 Secret Manager；没有时使用权限为 `0600` 的独立文件。
- 稳定的时间同步。OIDC 授权码和令牌依赖各节点时钟基本一致。

生产环境固定使用以下 URL 关系：

```text
服务根地址: https://id.example.com
Issuer:      https://id.example.com/oidc
发现文档:   https://id.example.com/oidc/.well-known/openid-configuration
用户门户:   https://id.example.com/portal
门户回调:   https://id.example.com/portal/callback
门户退出:   https://id.example.com/portal/signed-out
管理后台:   https://id.example.com/admin
```

`server.url` 不能包含末尾业务路径、query 或 fragment；`oidc.issuer` 必须等于
`${server.url}/oidc`。

## 准备目录和密钥

以下目录结构适用于 Docker 部署：

```text
/srv/x-oidc/
├── compose.yaml
├── x-oidc.config.js
├── .env.production
├── data/
├── secrets/
│   └── .htpasswd
└── backup/
```

创建目录并限制访问权限：

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0750 /srv/x-oidc
sudo install -d -o 10001 -g 10001 -m 0700 /srv/x-oidc/data
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0700 /srv/x-oidc/secrets
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0700 /srv/x-oidc/backup
```

生产镜像固定以 UID/GID `10001:10001` 运行。Linux bind mount 不会自动转换宿主权限，因此数据目录、
配置文件和密码文件必须允许该 UID 访问；不要为了省事改成全局可读写权限。源码或 systemd 部署使用后文
独立的 `x-oidc` 系统用户，不套用这里的数值 UID。

每类密钥必须独立生成，不能互相复用：

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 32
```

前四个结果可分别作为两个 Cookie Key、后台 Client Secret 和门户 Client Secret。最后一个结果是
恰好 32 字节随机值的 Base64 表示，可作为 `applications.secretEncryption.masterKey`。门户、后台和
业务应用必须使用不同的 Client Secret。

如果使用本地密码认证，在已安装项目依赖的源码目录中生成 bcrypt 密码文件：

```bash
read -r -s ADMIN_PASSWORD
export ADMIN_PASSWORD
node -e "const bcrypt = require('bcrypt'); console.log('admin:' + bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12));" > /srv/x-oidc/secrets/.htpasswd
unset ADMIN_PASSWORD
sudo chown 10001:10001 \
  /srv/x-oidc/secrets \
  /srv/x-oidc/secrets/.htpasswd
sudo chmod 0600 /srv/x-oidc/secrets/.htpasswd
```

不要把明文密码直接写进命令历史。本地认证适合作为首次上线的后台入口；外部认证管理员完成
验收后，可以再评估是否关闭本地认证。

## 创建生产配置

生产环境推荐使用 `x-oidc.config.js`，由配置文件显式读取环境变量。这里使用单实例 SQLite、
本地管理员、用户门户和数据库应用管理作为完整基线：

```javascript
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
};

const publicUrl = requiredEnv("X_OIDC_PUBLIC_URL").replace(/\/+$/, "");
const trustedProxyIps = requiredEnv("X_OIDC_TRUSTED_PROXY_IPS")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export default {
  server: {
    host: "0.0.0.0",
    port: 3000,
    url: publicUrl,
    trustProxy: true,
    trustedProxyIps,
    corsOrigins: []
  },
  logging: {
    enabled: true,
    level: "info"
  },
  audit: {
    enabled: true,
    retentionDays: 30
  },
  oidc: {
    issuer: `${publicUrl}/oidc`,
    cookieKeys: [
      requiredEnv("X_OIDC_COOKIE_KEY_CURRENT"),
      requiredEnv("X_OIDC_COOKIE_KEY_PREVIOUS")
    ],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400
    },
    claims: {
      openid: ["sub"],
      profile: [
        "name",
        "preferred_username",
        "email",
        "email_verified",
        "picture",
        "groups",
        "groups_tree",
        "roles",
        "status"
      ],
      email: ["email", "email_verified"],
      provider_api: []
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true }
    }
  },
  clients: [
    {
      client_id: "x-oidc-admin",
      client_secret: requiredEnv("X_OIDC_ADMIN_CLIENT_SECRET"),
      redirect_uris: [`${publicUrl}/admin/callback`],
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "client_secret_basic"
    },
    {
      client_id: "x-oidc-portal",
      client_secret: requiredEnv("X_OIDC_PORTAL_CLIENT_SECRET"),
      redirect_uris: [`${publicUrl}/portal/callback`],
      post_logout_redirect_uris: [`${publicUrl}/portal/signed-out`],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_basic"
    }
  ],
  auth: {
    userRepository: {
      type: "sqlite",
      sqlite: { dbPath: "/app/data/users.db" }
    },
    providers: {
      local: {
        enabled: true,
        displayName: "本地密码",
        priority: 1,
        config: {
          passwordFile: "/app/secrets/.htpasswd",
          passwordFormat: "bcrypt",
          adminUsers: ["admin"],
          lockoutPolicy: {
            enabled: true,
            maxAttempts: 5,
            lockoutDuration: 900
          }
        }
      }
    },
    stateStore: { type: "memory" }
  },
  admin: {
    enabled: true,
    basePath: "/admin",
    allowedGroups: ["x-oidc-admins"],
    sessionTtlSeconds: 3600
  },
  portal: {
    enabled: true,
    basePath: "/portal",
    clientId: "x-oidc-portal",
    sessionTtlSeconds: 3600
  },
  providerApi: {
    enabled: false
  },
  applications: {
    enabled: true,
    clientSource: "database",
    repository: {
      type: "sqlite",
      sqlite: { dbPath: "/app/data/applications.db" }
    },
    secretEncryption: {
      keyId: "applications-v1",
      masterKey: requiredEnv("X_OIDC_APPLICATION_MASTER_KEY")
    }
  },
  adapter: {
    type: "sqlite",
    sqlite: { dbPath: "/app/data/oidc.db" }
  },
  jwks: {
    filePath: "/app/data/jwks.json",
    keyId: "production-signing-key"
  }
};
```

配置文件只读取环境变量，不应包含真实密钥。`auth.providers` 是认证安全边界：配置文件一旦声明
它，就只启用明确列出的 Provider，不会隐式带入默认本地认证。

身份审计复用 `auth.userRepository` 后端。上述 SQLite 配置会把 `audit_logs` 表写入
`/app/data/users.db`；`retentionDays: 30` 表示自动删除超过 30 天的记录。生产环境不要关闭审计，
也不要使用 `memory` 用户仓储，否则重启后无法追溯登录、退出和用户资料变更。

创建 `/srv/x-oidc/.env.production`：

```dotenv
X_OIDC_VERSION=x.y.z
X_OIDC_PUBLIC_URL=https://id.example.com
X_OIDC_TRUSTED_PROXY_IPS=replace-with-proxy-ip-or-cidr
X_OIDC_COOKIE_KEY_CURRENT=replace-with-first-random-value
X_OIDC_COOKIE_KEY_PREVIOUS=replace-with-second-random-value
X_OIDC_ADMIN_CLIENT_SECRET=replace-with-independent-random-value
X_OIDC_PORTAL_CLIENT_SECRET=replace-with-another-independent-random-value
X_OIDC_APPLICATION_MASTER_KEY=replace-with-base64-encoded-32-byte-key
```

将 `x.y.z` 替换为准备上线的已发布版本，不要在生产环境使用 `latest`。将代理地址替换为服务实际
看到的反向代理来源 IP 或最小 CIDR，而不是任意公网地址范围。

生产镜像已经包含门户静态资源，不需要单独部署前端。源码部署必须使用 `pnpm build:prod`，该命令
会同时构建并装配管理后台与用户门户产物。

```bash
chmod 0600 /srv/x-oidc/.env.production
sudo chown 10001:10001 /srv/x-oidc/x-oidc.config.js
sudo chmod 0600 /srv/x-oidc/x-oidc.config.js
```

## 使用 Docker Compose 启动

创建 `/srv/x-oidc/compose.yaml`：

```yaml
services:
  idp:
    image: lydamirror/x-oidc:${X_OIDC_VERSION:?set X_OIDC_VERSION}
    container_name: x-oidc
    restart: unless-stopped
    environment:
      NODE_ENV: production
    env_file:
      - ./.env.production
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - ./x-oidc.config.js:/app/x-oidc.config.js:ro
      - ./data:/app/data
      - ./secrets:/app/secrets:ro
    stop_grace_period: 20s
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:3000/oidc/.well-known/openid-configuration')
          .then((response) => process.exit(response.ok ? 0 : 1))
          .catch(() => process.exit(1))
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging:
      options:
        max-size: "10m"
        max-file: "5"
```

只把端口发布到 `127.0.0.1`，避免客户端绕过 HTTPS 反向代理直接访问服务。如果反向代理运行在
另一个容器或节点，需要改用受控的内部网络，并将 `trustedProxyIps` 设置为实际代理地址。

先验证 Compose 展开结果，再启动：

```bash
cd /srv/x-oidc
docker compose --env-file .env.production config
docker compose --env-file .env.production pull
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=200 idp
```

首次启动会在持久化目录中创建 SQLite 数据库和 `jwks.json`。`jwks.json` 包含签名私钥，服务会
在 Linux/Unix 上将其权限收紧为 `0600`。该文件必须和数据库一起持久化并备份。

## 使用源码和 systemd 启动

不使用 Docker 时，在固定发布目录安装并构建：

```bash
cd /opt/x-oidc/current
corepack enable
corepack prepare pnpm@10.0.0 --activate
pnpm install --frozen-lockfile
pnpm build:prod
```

把前面的生产配置保存在 `/srv/x-oidc/x-oidc.config.js`，并将所有 `/app/data` 和
`/app/secrets` 路径替换为宿主机上的 `/srv/x-oidc/data` 和
`/srv/x-oidc/secrets`。进程工作目录必须包含配置文件。

创建 `/etc/systemd/system/x-oidc.service`：

```ini
[Unit]
Description=X OIDC Identity Provider
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=x-oidc
Group=x-oidc
WorkingDirectory=/srv/x-oidc
Environment=NODE_ENV=production
EnvironmentFile=/srv/x-oidc/.env.production
ExecStart=/usr/bin/node /opt/x-oidc/current/apps/idp-server/dist/main.js
Restart=on-failure
RestartSec=5s
TimeoutStopSec=20s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/x-oidc/data

[Install]
WantedBy=multi-user.target
```

确认 `/usr/bin/node` 是 Node.js 22，并让 `x-oidc` 用户拥有数据和配置：

```bash
sudo chown -R x-oidc:x-oidc /srv/x-oidc/data
sudo chown -R root:x-oidc /srv/x-oidc/secrets
sudo chown root:x-oidc \
  /srv/x-oidc/x-oidc.config.js \
  /srv/x-oidc/.env.production
sudo chmod 0750 /srv/x-oidc/secrets
sudo chmod 0640 \
  /srv/x-oidc/secrets/.htpasswd \
  /srv/x-oidc/x-oidc.config.js \
  /srv/x-oidc/.env.production
```

然后启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now x-oidc
sudo systemctl status x-oidc
sudo journalctl -u x-oidc -n 200 --no-pager
```

systemd 和 Docker 只能选择一种运行方式，不能让两个实例同时访问同一组 SQLite 文件。

## 配置 HTTPS 反向代理

反向代理至少需要传递 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto` 和
`X-Forwarded-Host`。Nginx 示例：

```nginx
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
    }
}
```

完整说明和容器网络注意事项见[反向代理 HTTPS 配置指南](./REVERSE_PROXY_HTTPS.md)。

## 首次启动验收

先检查发现文档和 JWKS：

```bash
curl --fail --silent --show-error \
  https://id.example.com/oidc/.well-known/openid-configuration | jq '{issuer, authorization_endpoint, token_endpoint, end_session_endpoint, jwks_uri}'

curl --fail --silent --show-error \
  https://id.example.com/oidc/jwks | jq '.keys | length'
```

验收结果必须满足：

- `issuer` 精确等于 `https://id.example.com/oidc`。
- 所有公开端点均为 HTTPS，且域名正确。
- JWKS 至少包含一个签名公钥。
- `https://id.example.com/` 重定向到用户门户，普通用户能够完成登录和退出。
- `https://id.example.com/admin` 可以打开，并能使用初始化管理员登录。
- 容器健康状态为 `healthy`，日志没有配置校验错误或持续重启。

登录后台后，使用 Gitea 模板创建业务 Client，并启用“显示在用户门户”。确认普通用户能看到 Gitea
卡片、卡片跳转到正确的 HTTPS 地址，管理员能够看到后台入口；门户退出后应回到
`/portal/signed-out`，且 `/portal/api/me` 再次返回 `401`。完整步骤见
[Gitea 接入指南](./GITEA_INTEGRATION.md)和[用户门户部署与使用指南](./USER_PORTAL.md)。

## 多实例 Redis 部署

只有在确实需要多实例时才使用该模式。配置至少需要满足：

```json
{
  "auth": {
    "userRepository": {
      "type": "pgsql",
      "pgsql": {
        "connectionString": "postgresql://x_oidc:your-password@postgres:5432/x_oidc"
      }
    },
    "stateStore": {
      "type": "redis",
      "redis": {
        "url": "redis://:your-password@redis:6379/0",
        "keyPrefix": "x-oidc:state:"
      }
    }
  },
  "applications": {
    "enabled": false,
    "clientSource": "config"
  },
  "adapter": {
    "type": "redis",
    "redis": {
      "url": "redis://:your-password@redis:6379/0",
      "keyPrefix": "x-oidc:oidc:"
    }
  }
}
```

同时遵守以下约束：

- 所有实例必须使用完全相同的 `clients`、Cookie Keys、Provider 配置和签名 JWKS。
- 所有实例必须使用完全相同的 `portal` 与 `clients[].portal` 配置；Redis `auth.stateStore` 同时保存
  门户登录 state、登录限流计数和 BFF Session。
- 不要让每个实例首次启动时各自生成 JWKS；通过安全分发预置同一份 `jwks.json`。
- Redis 应使用独立实例或独立受控数据库，并启用认证、持久化和 `noeviction`。OIDC 键被逐出会
  造成会话、授权码或撤销状态不一致。
- Redis OIDC 数据和短期状态使用不同 `keyPrefix`。
- 滚动升级前先验证新旧版本是否允许并行；不确定时采用维护窗口整体替换。
- 当前模式不能使用数据库应用管理，业务 Client 必须来自静态 `clients` 配置。

详细参数见[OIDC 适配器配置指南](./ADAPTER_CONFIGURATION.md)和
[Redis OIDC 适配器使用指南](./REDIS_ADAPTER_GUIDE.md)。

## 生产安全基线

上线前确认以下项目：

- [ ] `NODE_ENV=production`，并且配置文件已只读挂载。
- [ ] `server.url` 和 `oidc.issuer` 使用正确的 HTTPS 公网域名。
- [ ] `trustProxy` 已开启，`trustedProxyIps` 只包含真实代理来源。
- [ ] 服务端口不能被公网绕过反向代理直接访问。
- [ ] Cookie Key、Client Secret、应用主密钥和 Provider 密钥分别生成、分别保存。
- [ ] `devInteractions` 和动态注册保持关闭。
- [ ] 用户、OIDC、应用数据和 JWKS 都位于持久化存储。
- [ ] 本地认证只使用 bcrypt，密码文件权限为 `0600`。
- [ ] `admin.allowedGroups` 使用专用管理员组。
- [ ] 门户使用独立 confidential Client，精确注册 `/portal/callback` 和
      `/portal/signed-out`，且不复用后台或业务 Client Secret。
- [ ] 所有门户 `launch_url` 和 `icon_url` 使用 HTTPS；卡片入口已逐一验收。
- [ ] `server.corsOrigins` 默认为空；确需跨域时只添加精确 HTTPS Origin。
- [ ] Provider API 默认关闭；开启时配置 Client allowlist 和最小操作集。
- [ ] 已完成备份恢复演练和明确的版本回滚步骤。
- [ ] 已使用真实 Gitea 完成登录、退出和权限映射验收。

备份、升级、回滚、监控和密钥轮换见[生产运维手册](./OPERATIONS.md)。

## 常见启动失败

### 提示生产环境必须提供配置文件

配置文件必须位于进程工作目录，文件名只能是 `x-oidc.config.js` 或
`x-oidc.config.json`。两个文件同时存在时，JS 文件优先。

### 提示 `oidc.issuer` 不匹配

将 `oidc.issuer` 设置为 `${server.url}/oidc`。不要把发现文档路径或管理后台路径写入
Issuer。

### 提示后台 Client 缺失

启用后台时，至少一个 Client 的 `redirect_uris` 必须包含
`${server.url}${admin.basePath}/callback`，并使用授权码流程和 `client_secret_basic`。

### 提示 `portal_client_required`

确认 `portal.clientId` 指向 `clients[]` 中的 confidential Client。该 Client 必须精确注册
`${server.url}${portal.basePath}/callback` 和 `${server.url}${portal.basePath}/signed-out`，并使用
`response_types=["code"]`、包含 `authorization_code` 的 `grant_types` 和
`client_secret_basic`。不要把 Gitea 首页注册成门户退出地址。

### 提示 Redis 部署缺少共享 stateStore

Redis OIDC Adapter 用于多实例时，`auth.stateStore` 也必须配置为 Redis。它保存 OAuth state、
一次性回调结果、后台会话和登录失败计数。

### 提示应用管理配置不兼容

应用管理必须同时设置 `applications.enabled: true`、`clientSource: "database"` 和 SQLite
OIDC Adapter。它当前不能和多实例 Redis 模式组合。

## 相关文档

- [Gitea 接入指南](./GITEA_INTEGRATION.md)
- [用户门户部署与使用指南](./USER_PORTAL.md)
- [生产运维手册](./OPERATIONS.md)
- [反向代理 HTTPS 配置指南](./REVERSE_PROXY_HTTPS.md)
- [管理后台与 Provider API 接入指南](./ADMIN_AND_PROVIDER_API.md)
- [应用管理接入指南](./APPLICATION_MANAGEMENT.md)
- [飞书认证插件使用指南](./FEISHU_PLUGIN_GUIDE.md)
