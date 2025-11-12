#!/bin/bash

# Docker 测试统一入口脚本
# 可以从任何位置运行所有测试脚本

set -e

# 找到脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tests"

# 检查脚本是否存在
if [ ! -d "$SCRIPT_DIR" ]; then
    echo "❌ 测试脚本目录不存在: $SCRIPT_DIR"
    exit 1
fi

# 显示帮助信息
show_help() {
    echo "Docker 测试脚本统一入口"
    echo ""
    echo "用法: $0 <命令>"
    echo ""
    echo "可用命令:"
    echo "  build    构建 Docker 镜像"
    echo "  run      运行 Docker 容器"
    echo "  test     运行完整集成测试"
    echo "  clean    清理 Docker 资源"
    echo "  help     显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 test    # 运行完整测试"
    echo "  $0 build   # 仅构建镜像"
    echo "  $0 run     # 运行容器"
    echo "  $0 clean   # 清理资源"
}

# 主逻辑
case "${1:-help}" in
    build)
        echo "🚀 执行构建脚本..."
        exec "$SCRIPT_DIR/build.sh"
        ;;
    run)
        echo "🚀 执行运行脚本..."
        exec "$SCRIPT_DIR/run.sh"
        ;;
    test)
        echo "🧪 执行测试脚本..."
        exec "$SCRIPT_DIR/test.sh"
        ;;
    clean)
        echo "🧹 执行清理脚本..."
        exec "$SCRIPT_DIR/clean.sh"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "❌ 未知命令: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
