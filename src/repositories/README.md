# 用户仓储工厂使用指南

UserRepositoryFactory 提供了一个统一的接口来创建不同类型的用户仓储实例，支持配置驱动的仓储选择。

## 支持的仓储类型

- memory: 内存仓储，用于开发和测试
- database: SQLite 数据库仓储，用于生产环境
- pgsql: PostgreSQL 数据库仓储，用于生产环境
- config: 配置式仓储（预留扩展）

## 配置示例

### 内存仓储（默认）

```typescript
{
  userRepository: {
    type: 'memory',
    config: {}
  }
}
```

### SQLite 数据库仓储

```typescript
{
  userRepository: {
    type: 'sqlite',
    config: {
      uri: './data/users.db'  // 数据库文件路径，默认为 ':memory:'
    }
  }
}
```

### PostgreSQL 数据库仓储

```typescript
{
  userRepository: {
    type: 'pgsql',
    config: {
      uri: 'postgresql://username:password@localhost:5432/gitea_oidc'  // 连接字符串
    }
  }
}
```

## 使用方式

```typescript
import { UserRepositoryFactory } from './repositories/UserRepositoryFactory';

const config = { type: 'database', config: { path: './users.db' } };
const repository = UserRepositoryFactory.create(config);
```
