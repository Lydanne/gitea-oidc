#!/bin/bash

# Docker 集成测试脚本
# 用于完整测试 gitea-oidc 的 Docker 镜像
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
CONTAINER_NAME="gitea-oidc-test"
HOST_PORT=3000
CONTAINER_PORT=3000
TEST_TIMEOUT=60

echo -e "${BLUE}🧪 开始 Docker 集成测试${NC}"

# 函数：清理函数
cleanup() {
    echo -e "${YELLOW}🧹 清理测试环境...${NC}"
    docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    echo -e "${GREEN}✅ 清理完成${NC}"
}

# 函数：错误处理
error_exit() {
    echo -e "${RED}❌ 测试失败: $1${NC}"
    cleanup
    exit 1
}

# 设置错误处理
trap cleanup EXIT

# 步骤1: 构建镜像
echo -e "${BLUE}📦 步骤1: 构建 Docker 镜像${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! "${SCRIPT_DIR}/build.sh"; then
    error_exit "镜像构建失败"
fi

# 步骤2: 启动容器
echo -e "${BLUE}🚀 步骤2: 启动 Docker 容器${NC}"
if ! "${SCRIPT_DIR}/run.sh"; then
    error_exit "容器启动失败"
fi

# 步骤3: 等待服务启动
echo -e "${YELLOW}⏳ 步骤3: 等待服务启动...${NC}"
sleep 5

# 步骤4: 健康检查
echo -e "${BLUE}🏥 步骤4: 执行健康检查${NC}"

# 检查容器是否运行
if ! docker ps | grep -q "${CONTAINER_NAME}"; then
    error_exit "容器未运行"
fi

# 检查端口是否监听
if ! nc -z localhost "${HOST_PORT}"; then
    echo -e "${RED}❌ 端口 ${HOST_PORT} 未监听${NC}"
    echo -e "${YELLOW}容器日志:${NC}"
    docker logs "${CONTAINER_NAME}" | tail -20
    error_exit "端口检查失败"
fi

# 检查 HTTP 响应
echo -e "${YELLOW}测试 HTTP 响应...${NC}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${HOST_PORT}/" || echo "000")

if [ "${HTTP_STATUS}" != "200" ]; then
    echo -e "${RED}❌ HTTP 响应码: ${HTTP_STATUS} (期望: 200)${NC}"
    echo -e "${YELLOW}容器日志:${NC}"
    docker logs "${CONTAINER_NAME}" | tail -20
    error_exit "HTTP 检查失败"
fi

# 步骤5: 测试 OIDC 端点
echo -e "${BLUE}🔐 步骤5: 测试 OIDC 端点${NC}"

# 测试 .well-known 端点
OIDC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${HOST_PORT}/oidc/.well-known/openid-configuration" || echo "000")

if [ "${OIDC_STATUS}" != "200" ]; then
    echo -e "${RED}❌ OIDC 配置端点响应码: ${OIDC_STATUS} (期望: 200)${NC}"
    error_exit "OIDC 检查失败"
fi

# 步骤6: 测试认证流程
echo -e "${BLUE}🔑 步骤6: 测试认证流程${NC}"

# 测试登录页面
LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${HOST_PORT}/interaction/test123" || echo "000")

if [ "${LOGIN_STATUS}" != "200" ]; then
    echo -e "${RED}❌ 登录页面响应码: ${LOGIN_STATUS} (期望: 200)${NC}"
    error_exit "登录页面检查失败"
fi

echo -e "${GREEN}✅ 所有测试通过!${NC}"
echo -e "${BLUE}📊 测试结果:${NC}"
echo -e "${GREEN}  ✓ 镜像构建成功${NC}"
echo -e "${GREEN}  ✓ 容器启动成功${NC}"
echo -e "${GREEN}  ✓ 端口监听正常${NC}"
echo -e "${GREEN}  ✓ HTTP 服务正常${NC}"
echo -e "${GREEN}  ✓ OIDC 端点正常${NC}"
echo -e "${GREEN}  ✓ 认证页面正常${NC}"

echo -e "${BLUE}🎉 Docker 集成测试完成!${NC}"
echo -e "${YELLOW}服务仍在运行，可通过以下方式访问:${NC}"
echo -e "${YELLOW}  🌐 http://localhost:${HOST_PORT}${NC}"
echo -e "${YELLOW}  📊 日志: docker logs -f ${CONTAINER_NAME}${NC}"
echo -e "${YELLOW}  🛑 停止: docker stop ${CONTAINER_NAME}${NC}"

# 不自动清理，让用户手动清理
trap - EXIT
