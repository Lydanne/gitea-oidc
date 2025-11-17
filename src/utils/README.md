# Utils 工具函数

## userIdGenerator

### 功能

基于 `authProvider` 和 `externalId` 生成确定性的用户 ID。

### 使用方法

```typescript
import { generateUserId } from './utils/userIdGenerator';

// 生成飞书用户的 ID
const userId = generateUserId('feishu', 'ou_1234567890');
// 返回: "a1b2c3d4e5f6..." (64 字符的 SHA-256 哈希)

// 相同的输入总是生成相同的 ID
const userId2 = generateUserId('feishu', 'ou_1234567890');
console.log(userId === userId2); // true
```

### 特性

- **确定性**: 相同的输入总是生成相同的输出
- **唯一性**: 不同的输入生成不同的输出
- **安全性**: 使用 SHA-256 加密哈希算法
- **性能**: 1000 次调用在 100ms 内完成

### API

```typescript
function generateUserId(
  authProvider: string,
  externalId: string
): string
```

**参数**:

- `authProvider`: 认证提供商标识（如 'feishu', 'local', 'oauth' 等）
- `externalId`: 外部用户 ID

**返回值**:

- 64 字符的十六进制字符串（SHA-256 哈希）

### 测试

完整的单元测试位于 `src/utils/__tests__/userIdGenerator.test.ts`，包含 17 个测试用例：

- ✅ 确定性测试
- ✅ 唯一性测试
- ✅ 输出格式验证
- ✅ 边界情况处理
- ✅ 碰撞测试（10000 个输入）
- ✅ 性能测试

运行测试：

```bash
pnpm test userIdGenerator
```

### 在 Repository 中的使用

所有 UserRepository 实现都使用此工具函数：

```typescript
// MemoryUserRepository.ts
import { generateUserId } from '../utils/userIdGenerator';

async create(userData: Omit<UserInfo, 'sub'>): Promise<UserInfo> {
  const sub = userData.authProvider && userData.externalId
    ? generateUserId(userData.authProvider, userData.externalId)
    : randomUUID();
  
  // ...
}
```

### 相关文档

详细的设计文档请参考：[HASH_ID_GENERATION.md](../../docs/HASH_ID_GENERATION.md)
