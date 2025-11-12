#!/bin/bash

# Docker 镜像构建脚本
# 用于构建 gitea-oidc 的 Docker 镜像
# 可以从任何位置运行

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 找到项目根目录
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

    echo -e "${RED}❌ 找不到项目根目录（包含 Dockerfile 和 package.json 的目录）${NC}" >&2
    return 1
}

# 获取项目根目录
PROJECT_ROOT="$(find_project_root)"
if [ $? -ne 0 ]; then
    exit 1
fi

echo -e "${BLUE}📍 找到项目根目录: ${PROJECT_ROOT}${NC}"

# 配置
IMAGE_NAME="gitea-oidc"
TAG="latest"
FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"

echo -e "${BLUE}🚀 开始构建 Docker 镜像${NC}"
echo -e "${YELLOW}镜像名称: ${FULL_IMAGE_NAME}${NC}"

# 构建镜像
echo -e "${BLUE}📦 构建 Docker 镜像...${NC}"
cd "${PROJECT_ROOT}"
docker build -t "${FULL_IMAGE_NAME}" .

echo -e "${GREEN}✅ Docker 镜像构建成功!${NC}"
echo -e "${YELLOW}镜像信息:${NC}"
docker images "${IMAGE_NAME}"

echo -e "${BLUE}🎉 构建完成! 可以使用测试脚本运行容器${NC}"
