# 确定性用户 ID 生成

## 概述

从本版本开始，所有 UserRepository 实现（MemoryUserRepository、SqliteUserRepository、
PgsqlUserRepository）都使用基于 `authProvider` 和 `externalId` 的 SHA-256 哈希来生成
确定性的用户 ID (`sub`)。

## 工作原理

### 哈希生成

当创建用户时，如果提供了 `authProvider` 和 `externalId`，系统会：

1. 将 `authProvider` 和 `externalId` 组合成字符串：`${authProvider}:${externalId}`
2. 使用 SHA-256 算法对该字符串进行哈希
3. 将哈希结果（十六进制字符串）作为用户的 `sub`

```typescript
// 示例
authProvider: "feishu"
externalId: "ou_1234567890"

// 生成的输入字符串
input = "feishu:ou_1234567890"

// SHA-256 哈希（十六进制）
sub = "a1b2c3d4e5f6..." // 64 个字符的十六进制字符串
```

### 回退机制

如果 `authProvider` 或 `externalId` 未提供（undefined），系统会回退到使用随机 UUID v4：

```typescript
// 没有 externalId
sub = "550e8400-e29b-41d4-a716-446655440000" // 随机 UUID
```

## 优势

### 1. 确定性

相同的 `authProvider` + `externalId` 组合总是生成相同的 `sub`：

```typescript
// 第一次创建
const user1 = await repository.create({
  username: 'alice',
  email: 'alice@example.com',
  authProvider: 'feishu',
  externalId: 'ou_123',
  // ...
});

// 清空数据库后重新创建
await repository.clear();

const user2 = await repository.create({
  username: 'alice',
  email: 'alice@example.com',
  authProvider: 'feishu',
  externalId: 'ou_123',
  // ...
});

// user1.sub === user2.sub ✅
```

### 2. 幂等性

在分布式环境中，即使多个实例同时尝试创建同一个外部用户，它们都会生成相同的 `sub`，避免了重复创建的问题。

### 3. 可预测性

给定 `authProvider` 和 `externalId`，可以预先计算出用户的 `sub`，便于调试和数据迁移。

## 示例

### 飞书用户

```typescript
const feishuUser = await repository.create({
  username: 'zhangsan',
  name: '张三',
  email: 'zhangsan@company.com',
  authProvider: 'feishu',
  externalId: 'ou_7dab8a3d9c4e5f6a',
  // ...
});

// sub 将始终是：
// SHA256("feishu:ou_7dab8a3d9c4e5f6a")
// = "8f3e2c1a9b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f"
```

### 本地用户

```typescript
const localUser = await repository.create({
  username: 'admin',
  name: 'Administrator',
  email: 'admin@local.com',
  authProvider: 'local',
  externalId: 'local_admin',
  // ...
});

// sub 将始终是：
// SHA256("local:local_admin")
```

### 没有 externalId 的用户（回退到 UUID）

```typescript
const legacyUser = await repository.create({
  username: 'legacy',
  name: 'Legacy User',
  email: 'legacy@example.com',
  authProvider: 'local',
  externalId: undefined,
  // ...
});

// sub 将是随机 UUID，例如：
// "550e8400-e29b-41d4-a716-446655440000"
```

## 迁移注意事项

### 现有数据

如果你已经有使用随机 UUID 的用户数据，这些用户不会受到影响。新的哈希生成逻辑只适用于新创建的用户。

### 数据库约束

确保你的数据库表中 `sub` 字段有唯一性约束（PRIMARY KEY 或 UNIQUE），以防止意外的重复。

### 测试

在测试中创建多个用户时，确保为每个用户提供不同的 `externalId`：

```typescript
// ❌ 错误：会生成相同的 sub
await repository.create({ ...baseData, username: 'user1' });
await repository.create({ ...baseData, username: 'user2' });

// ✅ 正确：每个用户有不同的 externalId
await repository.create({ ...baseData, username: 'user1', externalId: 'ext1' });
await repository.create({ ...baseData, username: 'user2', externalId: 'ext2' });
```

## 技术细节

### 哈希算法

- **算法**: SHA-256
- **输出格式**: 64 个字符的十六进制字符串
- **输入格式**: `${authProvider}:${externalId}`

### 实现位置

- **工具函数**: `src/utils/userIdGenerator.ts`
  - 导出 `generateUserId(authProvider: string, externalId: string): string` 函数
  - 可在任何需要生成确定性用户 ID 的地方使用

- **Repository 实现**:
  - `src/repositories/MemoryUserRepository.ts`
  - `src/repositories/SqliteUserRepository.ts`
  - `src/repositories/PgsqlUserRepository.ts`
  
所有 repository 都使用统一的 `generateUserId` 工具函数。

### 测试覆盖

**工具函数测试**: `src/utils/__tests__/userIdGenerator.test.ts` (17 个测试)

- 确定性测试 - 相同输入生成相同输出
- 唯一性测试 - 不同输入生成不同输出
- 输出格式验证 - 64 字符十六进制字符串
- 边界情况 - 空字符串、特殊字符、Unicode、长字符串
- 碰撞测试 - 10000 个不同输入无碰撞
- 性能测试 - 1000 次调用在 100ms 内完成

**集成测试**: `src/repositories/__tests__/hash-id-generation.test.ts` (6 个测试)

- Repository 层的确定性测试
- 不同 `externalId` 生成不同 ID
- 不同 `authProvider` 生成不同 ID
- 回退到 UUID 的测试
- `findOrCreate` 的幂等性测试

## 安全考虑

### 哈希碰撞

SHA-256 的碰撞概率极低（约 2^-256），在实际应用中可以忽略不计。

### 隐私

`sub` 是从 `authProvider` 和 `externalId` 派生的，但由于使用了单向哈希函数，无法从 `sub` 反推出原始的 `externalId`。

### 可预测性

虽然 `sub` 是确定性的，但由于使用了加密哈希函数，攻击者无法轻易预测其他用户的 `sub`（除非知道他们的 `authProvider` 和 `externalId`）。
