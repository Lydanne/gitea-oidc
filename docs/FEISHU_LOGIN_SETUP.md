# 飞书登录配置指南

## ⚠️ 重要：域名访问要求

飞书登录功能已经完全实现，但由于 Cookie 域名限制，**必须通过公网域名访问**。

### ✅ 正确的访问方式

1. **访问 Gitea**：`http://bore.pub:24602`
2. **OIDC Discovery URL**：`http://bore.pub:21395/oidc/.well-known/openid-configuration`

### ❌ 错误的访问方式

- `http://192.168.111.154:3000`（内网地址）
- `http://localhost:3000`（本地地址）

## 🔧 Gitea OIDC 配置

在 Gitea 管理后台配置 OIDC 认证源时，使用以下设置：

```
认证名称：OIDC
OAuth2 提供者：OpenID Connect
客户端 ID：gitea
客户端密钥：PEwXhUvyDswaTaPPJsMDVtC7jtcaTErH
自动发现 URL：http://bore.pub:21395/oidc/.well-known/openid-configuration
```

**关键**：自动发现 URL 必须使用 `bore.pub:21395`，不能使用 `192.168.111.154:3000`！

## 🎯 完整登录流程

1. 用户访问：`http://bore.pub:24602`
2. 点击「使用 OIDC 登录」
3. 跳转到 OIDC 登录页面（`bore.pub:21395`）
4. 点击「飞书登录」按钮
5. 跳转到飞书授权页面
6. 授权后飞书回调到：`http://bore.pub:21395/auth/feishu/callback`
7. 验证成功后重定向回交互页面
8. 完成登录，返回 Gitea

## 🐛 问题排查

### 问题：Cookie 丢失 / Session Not Found

**原因**：通过内网地址（`192.168.111.154:3000`）访问，导致 Cookie 在错误的域名下。

**解决**：
1. 确保始终通过 `bore.pub:24602` 访问 Gitea
2. 检查 Gitea 的 OIDC 配置，确保使用 `bore.pub:21395`
3. 清除浏览器 Cookie 后重试

### 问题：飞书回调失败

**检查**：
1. 飞书开放平台的「重定向 URL」配置：`http://bore.pub:21395/auth/feishu/callback`
2. 确保 `encryptKey` 和 `verificationToken` 配置正确

## 📝 配置文件示例

### gitea-oidc.config.js

```javascript
export default {
  server: {
    host: '0.0.0.0',
    port: 3000,
    url: 'http://bore.pub:21395'  // ← 必须是公网域名
  },
  oidc: {
    issuer: 'http://bore.pub:21395/oidc',  // ← 必须是公网域名
    // ...
  },
  auth: {
    providers: {
      feishu: {
        enabled: true,
        config: {
          appId: 'cli_a999cacbf233d901c',
          appSecret: 'QxLsSE39dJjYq6U7Migj1bYoPiKZEinV',
          redirectUri: 'http://bore.pub:21395/auth/feishu/callback',  // ← 必须是公网域名
          // ...
        }
      }
    }
  }
}
```

## ✅ 验证步骤

1. 重启服务：`docker compose up`
2. 通过 `http://bore.pub:24602` 访问 Gitea
3. 点击「使用 OIDC 登录」
4. 应该能看到飞书登录按钮
5. 点击后跳转到飞书授权页面
6. 授权后应该能成功登录

## 🎉 成功标志

如果看到以下日志，说明登录成功：

```
[FeishuAuth] Exchange code response: { code: 0, data: { ... } }
[FeishuAuth] State verification result: { interactionUid: '...', ... }
[OAuth 登录完成] 用户 xxx 通过 feishu 认证
```
