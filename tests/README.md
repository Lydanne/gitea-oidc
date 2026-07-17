# Docker 测试脚本

这个目录包含用于测试 X OIDC Docker 镜像的 shell 脚本。

## 🎯 统一入口脚本

项目根目录提供了统一的入口脚本 `docker-test.sh`，可以从任何位置运行：

```bash
# 从项目根目录运行
./docker-test.sh test     # 运行完整测试
./docker-test.sh build    # 构建镜像
./docker-test.sh run      # 运行容器
./docker-test.sh clean    # 清理资源
./docker-test.sh help     # 显示帮助

# 或者从任何位置运行（需要指定完整路径）
/path/to/project/docker-test.sh test
```

## 📋 脚本说明

### build.sh

构建 Docker 镜像

```bash
./build.sh
```

### run.sh

运行 Docker 容器（会自动挂载配置文件）

```bash
./run.sh
```

### test.sh

运行完整的集成测试（构建 + 运行 + 测试 + 清理）

```bash
./test.sh
```

### clean.sh

清理 Docker 资源（停止容器、删除镜像）

```bash
./clean.sh
```

## 🚀 快速开始

### 完整测试流程

```bash
# 方法1: 使用统一入口脚本（推荐）
./docker-test.sh test

# 方法2: 直接运行测试脚本
./tests/test.sh
```

### 手动测试流程

```bash
# 方法1: 使用统一入口脚本
./docker-test.sh build
./docker-test.sh run
# 手动测试完成后
./docker-test.sh clean

# 方法2: 直接运行脚本
./tests/build.sh
./tests/run.sh
# 手动测试完成后
./tests/clean.sh
```

## ⚙️ 技术特性

- **智能路径检测**：自动查找项目根目录，支持从任何位置运行
- **自动配置挂载**：智能检测和挂载配置文件、密码文件、静态资源
- **健康检查**：多层次的服务验证（端口、HTTP响应、OIDC端点）
- **错误处理**：完善的错误提示和自动清理机制
- **彩色输出**：友好的终端彩色显示
