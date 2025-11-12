# 飞书认证插件使用指南

本指南详细介绍如何配置和使用飞书（Lark/Feishu）OAuth 2.0 认证插件，让用户可以通过飞书账号登录 Gitea。

## 目录

- [功能特性](#功能特性)
- [前置准备](#前置准备)
- [配置步骤](#配置步骤)
- [配置说明](#配置说明)
- [认证流程](#认证流程)
- [用户字段映射](#用户字段映射)
- [故障排查](#故障排查)
- [安全建议](#安全建议)

---

## 功能特性

✅ **完全插件化架构**：飞书认证逻辑完全封装在插件内部  
✅ **OAuth 2.0 标准**：符合飞书开放平台 OAuth 2.0 规范  
✅ **自动用户创建**：首次登录自动创建本地用户账号  
✅ **灵活字段映射**：支持自定义用户信息字段映射  
✅ **Token 自动刷新**：App Access Token 自动管理和刷新  
✅ **Webhook 支持**：可接收飞书事件回调（用户信息变更等）  
✅ **安全可靠**：State 参数验证、签名校验、一次性使用  

---

## 前置准备

### 1. 创建飞书应用

1. 登录 [飞书开放平台](https://open.feishu.cn/)
2. 进入「开发者后台」→「企业自建应用」
3. 点击「创建企业自建应用」
4. 填写应用信息：
   - **应用名称**：例如 "Gitea OIDC 登录"
   - **应用描述**：描述应用用途
   - **应用图标**：上传应用图标

### 2. 配置应用权限

在应用管理页面：

1. **权限管理** → 添加以下权限：
   - `contact:contact.base:readonly` - 获取用户基本信息

```json
{
  "scopes": {
    "tenant": [
      "contact:user.base:readonly",
      "contact:user.email:readonly"
    ],
    "user": [
      "contact:contact.base:readonly",
      "contact:department.organize:readonly",
      "contact:user.base:readonly",
      "contact:user.department:readonly",
      "contact:user.department_path:readonly",
      "contact:user.dotted_line_leader_info.read",
      "contact:user.email:readonly",
      "contact:user.employee:readonly",
      "contact:user.employee_id:readonly",
      "contact:user.employee_number:read",
      "contact:user.gender:readonly",
      "contact:user.job_family:readonly",
      "contact:user.job_level:readonly",
      "contact:user.phone:readonly",
      "contact:user.user_geo",
      "directory:employee.base.email:read"
    ]
  }
}
```

2. **安全设置** → 配置重定向 URL：

   ```
   http://your-server:3000/auth/feishu/callback
   ```

   ⚠️ **重要**：必须使用实际的外网地址，不能使用 `localhost`

3. 获取凭证：
   - **App ID**：在「凭证与基础信息」页面获取
   - **App Secret**：在「凭证与基础信息」页面获取


### 3. 发布应用

1. 完成配置后，点击「版本管理与发布」
2. 创建版本并提交审核
3. 审核通过后，在企业内发布应用

---

## 配置步骤

### 方式一：使用 JavaScript 配置文件（推荐）

编辑 `gitea-oidc.config.js`：

```javascript
export default {
  server: {
    host: '0.0.0.0',
    port: 3000,
    url: 'http://your-server:3000'  // ⚠️ 使用实际外网地址
  },
  
  oidc: {
    issuer: 'http://your-server:3000/oidc',
    cookieKeys: ['your-random-secret-key-32-chars-min'],
    // ... 其他 OIDC 配置
  },
  
  clients: [
    {
      client_id: 'gitea',
      client_secret: 'your-gitea-client-secret',
      redirect_uris: ['http://your-gitea:3001/user/oauth2/oidc/callback'],
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_basic',
    }
  ],
  
  auth: {
    userRepository: { 
      type: 'memory', 
      config: {} 
    },
    providers: {
      // 本地密码认证（可选）
      local: {
        enabled: false,
        displayName: '本地密码',
        priority: 1,
        config: {
          passwordFile: '.htpasswd',
          passwordFormat: 'bcrypt'
        }
      },
      
      // 飞书认证配置
      feishu: {
        enabled: true,                    // 启用飞书认证
        displayName: '飞书登录',          // 登录按钮显示文本
        priority: 2,                      // 显示优先级（数字越小越靠前）
        config: {
          appId: 'cli_a1b2c3d4e5f6g7h8',           // 飞书应用 App ID
          appSecret: 'your_app_secret_here',        // 飞书应用 App Secret
          redirectUri: 'http://your-server:3000/auth/feishu/callback',  // 回调地址
          scope: 'contact:contact.base:readonly',      // 权限范围
          autoCreateUser: true,                     // 自动创建用户
          
          // 用户字段映射（可选）
          userMapping: {
            username: 'en_name',    // 使用飞书英文名作为用户名
            name: 'name',           // 使用飞书姓名
            email: 'email'          // 使用飞书邮箱
          }
        }
      }
    }
  }
}
```

### 方式二：使用 JSON 配置文件

编辑 `gitea-oidc.config.json`：

```json
{
  "auth": {
    "providers": {
      "feishu": {
        "enabled": true,
        "displayName": "飞书登录",
        "priority": 2,
        "config": {
          "appId": "cli_a1b2c3d4e5f6g7h8",
          "appSecret": "your_app_secret_here",
          "redirectUri": "http://your-server:3000/auth/feishu/callback",
          "scope": "contact:contact.base:readonly",
          "autoCreateUser": true,
          "userMapping": {
            "username": "en_name",
            "name": "name",
            "email": "email"
          }
        }
      }
    }
  }
}
```

---

## 配置说明

### 必填字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `enabled` | boolean | 是否启用飞书认证 | `true` |
| `displayName` | string | 登录按钮显示文本 | `"飞书登录"` |
| `config.appId` | string | 飞书应用 App ID | `"cli_a1b2c3d4e5f6g7h8"` |
| `config.appSecret` | string | 飞书应用 App Secret | `"your_app_secret_here"` |
| `config.redirectUri` | string | OAuth 回调地址 | `"http://your-server:3000/auth/feishu/callback"` |

### 可选字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `priority` | number | `1` | 显示优先级，数字越小越靠前 |
| `config.scope` | string | `"contact:contact.base:readonly"` | 权限范围 |
| `config.autoCreateUser` | boolean | `true` | 是否自动创建用户 |
| `config.userMapping` | object | 见下文 | 用户字段映射配置 |
| `config.apiEndpoint` | string | 飞书公有云 | 私有化部署的 API 端点 |

### redirectUri 配置规则

回调地址格式固定为：

```
http(s)://your-server:port/auth/feishu/callback
```

⚠️ **注意事项**：
- 必须与飞书开放平台配置的重定向 URL **完全一致**
- 必须使用实际的外网地址，不能使用 `localhost` 或 `127.0.0.1`
- 协议（http/https）、域名、端口、路径都必须完全匹配
- 路径固定为 `/auth/feishu/callback`，由插件自动注册

---

## 认证流程

```text
┌─────────┐                                    ┌──────────────┐
│  用户   │                                    │   Gitea      │
└────┬────┘                                    └──────┬───────┘
     │                                                │
     │  1. 访问 Gitea                                │
     ├───────────────────────────────────────────────>│
     │                                                │
     │  2. 重定向到 OIDC Provider                    │
     │<───────────────────────────────────────────────┤
     │                                                │
┌────▼────────────────────────────────────────────────────────┐
│              OIDC Provider (本系统)                         │
│                                                              │
│  3. 显示登录页面                                             │
│     ┌──────────────┐  ┌──────────────┐                     │
│     │ 本地密码登录  │  │  飞书登录    │ ← 用户点击          │
│     └──────────────┘  └──────────────┘                     │
└────┬─────────────────────────────────────────────────────────┘
     │
     │  4. 重定向到飞书授权页面
     │     (https://open.feishu.cn/open-apis/authen/v1/authorize)
     │
┌────▼────────────────────────────────────────────────────────┐
│                    飞书开放平台                              │
│                                                              │
│  5. 用户登录飞书账号并授权                                   │
│     ┌────────────────────────────────┐                      │
│     │  是否允许 "Gitea OIDC 登录"    │                      │
│     │  访问你的基本信息？             │                      │
│     │                                 │                      │
│     │  [拒绝]          [同意]        │ ← 用户点击同意       │
│     └────────────────────────────────┘                      │
└────┬─────────────────────────────────────────────────────────┘
     │
     │  6. 回调到插件 (带 code 和 state)
     │     GET /auth/feishu/callback?code=xxx&state=yyy
     │
┌────▼─────────────────────────────────────────────────────────┐
│              飞书认证插件 (FeishuAuthProvider)               │
│                                                               │
│  7. 验证 state 参数                                          │
│  8. 用 code 换取 user_access_token                           │
│  9. 获取飞书用户信息                                          │
│ 10. 创建/更新本地用户                                         │
│ 11. 调用 coordinator.finishOidcInteraction()                │
└────┬──────────────────────────────────────────────────────────┘
     │
     │  12. OIDC 交互完成，生成授权码
     │
┌────▼────────────────────────────────────────────────────────┐
│              OIDC Provider                                   │
│                                                              │
│  13. 重定向回 Gitea (带授权码)                               │
└────┬─────────────────────────────────────────────────────────┘
     │
     │  14. 返回授权码
     │<───────────────────────────────────────────────┐
     │                                                │
┌────▼────┐                                    ┌─────┴────────┐
│  用户   │                                    │   Gitea      │
│         │  15. Gitea 用授权码换取 token      │              │
│         │     完成登录                        │              │
└─────────┘                                    └──────────────┘
```

### 关键步骤说明

1. **State 参数验证**：防止 CSRF 攻击，确保回调来自合法的授权请求
2. **Code 换 Token**：使用授权码换取用户访问令牌
3. **获取用户信息**：使用访问令牌调用飞书 API 获取用户详情
4. **用户创建/更新**：首次登录自动创建用户，后续登录更新信息
5. **完成 OIDC 交互**：插件内部完成整个流程，无需额外路由

---

## 用户字段映射

### 默认映射规则

如果不配置 `userMapping`，使用以下默认规则：

| 本地字段 | 飞书字段 | 说明 |
|---------|---------|------|
| `username` | `en_name` 或 `open_id` | 优先使用英文名，否则使用 open_id |
| `name` | `name` | 飞书姓名 |
| `email` | `email` 或 `{open_id}@feishu.local` | 优先使用真实邮箱，否则生成虚拟邮箱 |
| `picture` | `avatar_url` | 头像 URL |
| `phone` | `mobile` | 手机号 |

### 自定义映射

可以通过 `userMapping` 配置自定义映射：

```javascript
userMapping: {
  username: 'open_id',      // 使用 open_id 作为用户名
  name: 'en_name',          // 使用英文名作为显示名称
  email: 'email',           // 使用飞书邮箱
  picture: 'avatar_url'     // 使用飞书头像
}
```

### 飞书可用字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `open_id` | string | 用户在应用内的唯一标识 | `"ou_a1b2c3d4e5f6g7h8"` |
| `union_id` | string | 用户在企业内的唯一标识 | `"on_a1b2c3d4e5f6g7h8"` |
| `name` | string | 用户姓名 | `"张三"` |
| `en_name` | string | 用户英文名 | `"Zhang San"` |
| `email` | string | 用户邮箱 | `"zhangsan@company.com"` |
| `mobile` | string | 用户手机号 | `"+86-13800138000"` |
| `avatar_url` | string | 用户头像 URL | `"https://..."` |

---

## 故障排查

### 1. 回调地址错误

**错误信息**：`redirect_uri_mismatch`

**原因**：配置的 `redirectUri` 与飞书开放平台配置不一致

**解决方案**：

1. 检查 `gitea-oidc.config.js` 中的 `redirectUri`
2. 检查飞书开放平台「安全设置」中的重定向 URL
3. 确保两者完全一致（协议、域名、端口、路径）
4. 不要使用 `localhost`，使用实际的外网地址

### 2. 权限不足

**错误信息**：`insufficient_scope` 或 `permission_denied` 或 `Failed to get full user info: Unauthorized`

**原因**：应用没有申请足够的权限，或者权限配置不正确

**解决方案**：

1. 进入飞书开放平台「权限管理」
2. 添加以下权限（至少需要 `contact:contact.base:readonly`）：
   - `contact:contact.base:readonly` - 获取用户基本信息
   - `contact:contact:readonly` - 获取用户完整信息（包含部门信息）
3. 重新发布应用版本
4. 用户需要重新授权

**注意**：如果只配置了基础权限，系统会自动回退到基本用户信息，不会影响登录功能

### 3. State 验证失败

**错误信息**：`Invalid or expired state`

**原因**：
- State 参数已过期（默认 10 分钟）
- State 参数被篡改
- 用户重复使用回调链接

**解决方案**：
1. 重新发起登录流程
2. 检查系统时间是否正确
3. 确保 State Store 正常工作

### 4. Token 获取失败

**错误信息**：`Failed to exchange code for token`

**原因**：
- App Secret 配置错误
- 授权码已过期或已使用
- 网络连接问题

**解决方案**：
1. 检查 `appId` 和 `appSecret` 是否正确
2. 检查服务器能否访问飞书 API（`https://open.feishu.cn`）
3. 查看详细错误日志

### 5. 用户信息获取失败

**错误信息**：`Failed to get user info`

**原因**：
- User Access Token 无效
- 权限不足
- API 调用限流

**解决方案**：
1. 确认权限配置正确
2. 检查 API 调用频率
3. 查看飞书开放平台错误码文档

### 调试技巧

1. **启用详细日志**：
   ```javascript
   logging: {
     enabled: true,
     level: 'debug'
   }
   ```

2. **查看插件状态**：

   ```bash
   curl http://localhost:3000/auth/feishu/status
   ```

   返回示例：

   ```json
   {
     "provider": "feishu",
     "configured": true,
     "tokenValid": true
   }
   ```

3. **检查路由注册**：
   启动时查看日志，确认路由已注册：

   ```
   Registered route: GET /auth/feishu/callback - 飞书 OAuth 回调
   Registered route: GET /auth/feishu/status - 获取飞书插件状态
   ```

---

## 安全建议

### 1. 保护敏感信息

❌ **不要**将 `appSecret` 提交到版本控制系统

✅ **推荐做法**：

```javascript
// gitea-oidc.config.js
export default {
  auth: {
    providers: {
      feishu: {
        config: {
          appId: process.env.FEISHU_APP_ID,
          appSecret: process.env.FEISHU_APP_SECRET,
          // ...
        }
      }
    }
  }
}
```

### 2. 使用 HTTPS

生产环境**必须**使用 HTTPS：

- 保护用户凭证传输安全
- 防止中间人攻击
- 飞书开放平台强制要求 HTTPS

### 3. 限制回调域名

在飞书开放平台只配置必要的回调 URL：

- 不要使用通配符
- 只添加实际使用的域名
- 定期审查和清理

### 4. 定期轮换密钥

建议定期更换：

- `cookieKeys`：用于 Cookie 签名
- `appSecret`：飞书应用密钥（需在飞书平台重新生成）

### 5. 监控异常登录

关注以下异常情况：

- State 验证失败次数过多
- 同一 IP 短时间内多次登录失败
- 异常的用户信息更新

### 6. 最小权限原则

只申请必要的飞书权限：

- 基础信息：`contact:contact.base:readonly`
- 邮箱（如需要）：`contact:user.email:readonly`
- 避免申请不必要的权限

---

## 高级配置

### Webhook 事件处理

飞书插件支持接收 Webhook 事件（如用户信息变更）：

1. **配置 Webhook URL**（在飞书开放平台）：

   ```
   http://your-server:3000/auth/feishu/webhook
   ```

2. **处理的事件类型**：
   - 用户信息变更
   - 部门变更
   - 员工入职/离职

3. **自定义事件处理**：
   可以修改 `FeishuAuthProvider.ts` 中的 `registerWebhooks()` 方法

### 私有化部署

如果使用飞书私有化部署版本：

```javascript
feishu: {
  config: {
    apiEndpoint: 'https://your-feishu-server.com',
    // ... 其他配置
  }
}
```

### 多租户支持

如果需要支持多个飞书企业：

可以注册多个飞书插件实例（需要修改插件代码以支持多实例）

---

## 完整配置示例

```javascript
// gitea-oidc.config.js
export default {
  server: {
    host: '0.0.0.0',
    port: 3000,
    url: 'https://oidc.example.com'
  },
  
  logging: {
    enabled: true,
    level: 'info'
  },
  
  oidc: {
    issuer: 'https://oidc.example.com/oidc',
    cookieKeys: [
      'GqNusJ6i5ZYAzchKV36xydAtAuru5VCb',
      'gSyHGRASCLersS4Saf3NWUFCYKVBa6hR'
    ],
    claims: {
      openid: ['sub'],
      profile: ['name', 'email', 'email_verified', 'picture', 'phone']
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true }
    },
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400
    }
  },
  
  clients: [{
    client_id: 'gitea',
    client_secret: 'PEwXhUvyDswaTaPPJsMDVtC7jtcaTErH',
    redirect_uris: ['https://gitea.example.com/user/oauth2/oidc/callback'],
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'client_secret_basic'
  }],
  
  auth: {
    userRepository: { 
      type: 'memory', 
      config: {} 
    },
    providers: {
      // 本地密码认证（备用）
      local: {
        enabled: true,
        displayName: '本地密码',
        priority: 2,
        config: {
          passwordFile: '.htpasswd',
          passwordFormat: 'bcrypt'
        }
      },
      
      // 飞书认证（主要方式）
      feishu: {
        enabled: true,
        displayName: '飞书企业登录',
        priority: 1,
        config: {
          appId: process.env.FEISHU_APP_ID || 'cli_a1b2c3d4e5f6g7h8',
          appSecret: process.env.FEISHU_APP_SECRET || 'your_app_secret_here',
          redirectUri: 'https://oidc.example.com/auth/feishu/callback',
          scope: 'contact:contact.base:readonly contact:user.email:readonly',
          autoCreateUser: true,
          userMapping: {
            username: 'en_name',
            name: 'name',
            email: 'email',
            picture: 'avatar_url'
          }
        }
      }
    }
  }
}
```

---

## 参考资料

- [飞书开放平台文档](https://open.feishu.cn/document/home/index)
- [飞书 OAuth 2.0 文档](https://open.feishu.cn/document/common-capabilities/sso/api/get-user-info)
- [插件系统设计文档](./AUTH_PLUGIN_DESIGN.md)
- [插件路由指南](./PLUGIN_ROUTES_GUIDE.md)

---

## 技术支持

如遇到问题，请：

1. 查看本文档的「故障排查」章节
2. 检查服务器日志（启用 debug 级别）
3. 查看飞书开放平台的错误码文档
4. 提交 Issue 并附上详细的错误信息和配置（隐藏敏感信息）

---

**最后更新**：2025-11-12  
**版本**：v1.0.0
