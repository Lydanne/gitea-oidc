# 飞书 SDK 迁移说明

## 概述

已将飞书认证提供商从手动 HTTP 请求迁移到使用官方飞书 Node.js SDK (`@larksuiteoapi/node-sdk`)。

## 主要改进

### 1. 自动 Token 管理

- ✅ SDK 自动获取和刷新 `tenant_access_token`
- ✅ 无需手动管理 token 过期时间
- ✅ 内置 token 缓存机制

### 2. 类型安全

- ✅ 完整的 TypeScript 类型定义
- ✅ IDE 自动补全支持
- ✅ 编译时类型检查

### 3. 错误处理

- ✅ 统一的错误处理机制
- ✅ 降级处理:获取完整用户信息失败时使用基本信息
- ✅ 详细的日志记录

### 4. API 调用简化

```typescript
// 之前:手动构造 HTTP 请求
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` }
});

// 现在:使用 SDK
const result = await this.larkClient.contact.v3.user.get({
  path: { user_id: openId },
  params: { user_id_type: "open_id" }
});
```

## 安装依赖

```bash
pnpm install @larksuiteoapi/node-sdk
```

## 代码变更

### 移除的代码

- ❌ `appAccessToken` 属性
- ❌ `tenantAccessToken` 属性
- ❌ `tokenExpiresAt` 属性
- ❌ `tenantTokenExpiresAt` 属性
- ❌ `refreshAppAccessToken()` 方法
- ❌ `isTokenValid()` 方法

### 新增的代码

- ✅ `larkClient: lark.Client` - SDK 客户端实例
- ✅ 在 `initialize()` 中初始化 SDK 客户端
- ✅ 使用 SDK 获取完整用户信息

### 修改的方法

- `getFeishuUserInfo()` - 使用 SDK 替代手动 HTTP 请求
- `exchangeCodeForToken()` - 简化,移除 token 刷新逻辑
- `destroy()` - 简化,SDK 自动清理资源

## 配置说明

SDK 客户端配置:

```typescript
this.larkClient = new lark.Client({
  appId: this.config.appId,
  appSecret: this.config.appSecret,
  disableTokenCache: false,  // 启用 token 自动管理
});
```

## 问题修复

### 原问题

部分用户登录时报错:

```
Invalid access token for authorization (code: 99991663)
```

### 根本原因

使用了 `app_access_token` 而非 `tenant_access_token` 调用通讯录 API。

### 解决方案

1. SDK 自动使用正确的 `tenant_access_token`
2. 添加降级处理:如果获取完整用户信息失败,使用基本信息继续登录
3. 详细的日志记录,便于调试

## 测试步骤

1. 安装依赖:

```bash
pnpm install
```

1. 构建项目:

```bash
pnpm run build
```

1. 重启服务并测试登录

2. 检查日志,应该看到:

```
[FeishuAuth] Lark SDK client initialized
[FeishuAuth] Got basic user info: ...
[FeishuAuth] SDK full user info response: ...
```

## 注意事项

1. **飞书应用权限**:确保应用有以下权限
   - `contact:user:read` - 读取通讯录用户信息
   - `contact:department:read` - 读取部门信息

2. **Token 缓存**:SDK 默认启用 token 缓存,无需手动管理

3. **错误处理**:即使获取完整用户信息失败,也会降级使用基本信息,不会阻止登录

## 参考文档

- [飞书 Node.js SDK 文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/server-side-sdk/nodejs-sdk/preparation-before-development)
- [飞书通讯录 API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/contact-v3/user/get)
