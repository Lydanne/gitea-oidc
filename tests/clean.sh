#!/bin/bash

# Docker 资源清理脚本
# 用于清理 gitea-oidc 相关的 Docker 资源
# 可以从任何位置运行

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 找到项目根目录（可选，用于显示信息）
find_project_root() {
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local current_dir="$script_dir"

    # 向上查找项目根目录（包含 Dockerfile 和 package.json 的目录）
    while [ "$current_dir" != "/" ]; do
        if [ -f "$current_dir/Dockerfile" ] && [ -f "$current_dir/package.json" ]; then
            echo "$current_dir"
            return 0
        fi
        current_dir="$(dirname "$current_dir")"
    done

    return 1
}

# 获取项目根目录（用于显示）
PROJECT_ROOT="$(find_project_root)" || PROJECT_ROOT=""

if [ -n "$PROJECT_ROOT" ]; then
    echo -e "${BLUE}📍 找到项目根目录: ${PROJECT_ROOT}${NC}"
fi

# 配置
IMAGE_NAME="gitea-oidc"
CONTAINER_NAME="gitea-oidc-test"

echo -e "${BLUE}🧹 开始清理 Docker 资源${NC}"

# 停止并删除容器
if docker ps -a --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${YELLOW}停止容器: ${CONTAINER_NAME}${NC}"
    docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    echo -e "${YELLOW}删除容器: ${CONTAINER_NAME}${NC}"
    docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    echo -e "${GREEN}✅ 容器清理完成${NC}"
else
    echo -e "${BLUE}ℹ️  容器 ${CONTAINER_NAME} 不存在${NC}"
fi

# 删除镜像
if docker images "${IMAGE_NAME}" | grep -q "${IMAGE_NAME}"; then
    echo -e "${YELLOW}删除镜像: ${IMAGE_NAME}${NC}"
    docker rmi "${IMAGE_NAME}:latest" >/dev/null 2>&1 || true
    echo -e "${GREEN}✅ 镜像清理完成${NC}"
else
    echo -e "${BLUE}ℹ️  镜像 ${IMAGE_NAME} 不存在${NC}"
fi

# 显示当前 Docker 资源状态
echo -e "${BLUE}📊 当前 Docker 资源状态:${NC}"
echo -e "${YELLOW}运行中的容器:${NC}"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"

echo -e "${YELLOW}所有容器:${NC}"
docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

echo -e "${YELLOW}本地镜像:${NC}"
docker images "${IMAGE_NAME}"

echo -e "${GREEN}🎉 Docker 资源清理完成!${NC}"
