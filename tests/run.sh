#!/bin/bash

# Docker 容器运行脚本
# 用于运行 gitea-oidc 容器

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

# 配置
IMAGE_NAME="gitea-oidc"
TAG="latest"
FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"
CONTAINER_NAME="gitea-oidc-test"
HOST_PORT=3000
CONTAINER_PORT=3000

# 获取项目根目录
PROJECT_ROOT="$(find_project_root)"
if [ $? -ne 0 ]; then
    exit 1
fi

echo -e "${BLUE}📍 找到项目根目录: ${PROJECT_ROOT}${NC}"

# 检查镜像是否存在
if ! docker images "${IMAGE_NAME}" | grep -q "${TAG}"; then
    echo -e "${RED}❌ Docker 镜像不存在，请先运行 ./build.sh 构建镜像${NC}"
    exit 1
fi

# 检查配置文件是否存在（支持 .js 和 .json 文件）
CONFIG_FILE="${PROJECT_ROOT}/gitea-oidc.config.js"
if [ ! -f "${CONFIG_FILE}" ]; then
    CONFIG_FILE="${PROJECT_ROOT}/gitea-oidc.config.json"
    if [ ! -f "${CONFIG_FILE}" ]; then
        echo -e "${YELLOW}⚠️  配置文件不存在，使用示例配置${NC}"
        EXAMPLE_CONFIG_FILE="${PROJECT_ROOT}/example.gitea-oidc.config.json"
        if [ -f "${EXAMPLE_CONFIG_FILE}" ]; then
            CONFIG_FILE="${EXAMPLE_CONFIG_FILE}"
        else
            echo -e "${RED}❌ 配置文件不存在${NC}"
            exit 1
        fi
    fi
fi

HTPASSWD_FILE="${PROJECT_ROOT}/.htpasswd"
PUBLIC_DIR="${PROJECT_ROOT}/public"

# 停止并删除已存在的容器
if docker ps -a --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${YELLOW}🛑 停止并删除已存在的容器...${NC}"
    docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

echo -e "${BLUE}🚀 启动 Docker 容器${NC}"
echo -e "${YELLOW}容器名称: ${CONTAINER_NAME}${NC}"
echo -e "${YELLOW}镜像: ${FULL_IMAGE_NAME}${NC}"
echo -e "${YELLOW}端口映射: ${HOST_PORT}:${CONTAINER_PORT}${NC}"
echo -e "${YELLOW}配置文件: ${CONFIG_FILE}${NC}"

# 确定容器内配置文件路径
if [[ "${CONFIG_FILE}" == *.js ]]; then
    CONTAINER_CONFIG_FILE="/app/gitea-oidc.config.js"
elif [[ "${CONFIG_FILE}" == *.json ]]; then
    CONTAINER_CONFIG_FILE="/app/gitea-oidc.config.json"
else
    echo -e "${RED}❌ 不支持的配置文件格式${NC}"
    exit 1
fi

# 运行容器
docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${HOST_PORT}:${CONTAINER_PORT}" \
    -v "${CONFIG_FILE}:${CONTAINER_CONFIG_FILE}" \
    -v "${HTPASSWD_FILE}:/app/.htpasswd" \
    -v "${PUBLIC_DIR}:/app/public" \
    -v "${PROJECT_ROOT}/gitea-server/data:/app/gitea-server/data" \
    --restart unless-stopped \
    "${FULL_IMAGE_NAME}"

echo -e "${GREEN}✅ 容器启动成功!${NC}"
echo -e "${BLUE}🌐 服务地址: http://localhost:${HOST_PORT}${NC}"
echo -e "${BLUE}📊 查看日志: docker logs -f ${CONTAINER_NAME}${NC}"
echo -e "${BLUE}🛑 停止容器: docker stop ${CONTAINER_NAME}${NC}"
echo -e "${BLUE}🧹 清理容器: ./clean.sh${NC}"

# 等待服务启动
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 3

# 检查服务是否正常运行
if docker ps | grep -q "${CONTAINER_NAME}"; then
    echo -e "${GREEN}🎉 服务运行正常!${NC}"
else
    echo -e "${RED}❌ 服务启动失败，查看日志:${NC}"
    docker logs "${CONTAINER_NAME}"
    exit 1
fi
