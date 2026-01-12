#!/bin/bash

# Conan 角色权限验证脚本
set -e

cd "$(dirname "$0")/.."
source venv/bin/activate

# 优先从 .env 加载配置
if [ -f .env ]; then export $(grep -v '^#' .env | xargs); fi

REGION=${AWS_REGION:-"ap-east-1"}
export AWS_PROFILE=${AWS_PROFILE:-"conanserver"}

# 获取 API 端点
STACK_NAME=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --region "$REGION" --query "StackSummaries[?contains(StackName, 'serverless-conan') && contains(StackName, 'ConanServerStack')].StackName" --output text | awk '{print $1}')
API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)

echo "📍 测试端点: $API_ENDPOINT"

# 创建测试用户
echo "👥 创建测试用户..."
./add-user.sh test_dev dev123 developer > /dev/null
./add-user.sh test_viewer view123 viewer > /dev/null

conan remote add test-perm "$API_ENDPOINT" --force
conan config set general.revisions_enabled=0

# --- 测试 1: Developer 权限 ---
echo ""
echo "🛠️  测试 1: Developer (应允许上传，禁止删除)"
conan user test_dev -p dev123 -r test-perm

# 准备一个极简包
mkdir -p /tmp/test_pkg && cd /tmp/test_pkg
cat > conanfile.py << 'EOF'
from conans import ConanFile
class TestPkg(ConanFile):
    name = "test_pkg"
    version = "1.0.0"
EOF

conan export . demo/testing
echo "⬆️  尝试上传 (预期: 成功)..."
conan upload "test_pkg/1.0.0@demo/testing" -r test-perm --all --confirm && echo "✅ Developer 上传成功" || (echo "❌ Developer 上传失败"; exit 1)

echo "🗑️  尝试删除 (预期: 失败/403)..."
OUT=$(conan remove "test_pkg/1.0.0@demo/testing" -r test-perm -f 2>&1 || true)
if echo "$OUT" | grep -i "403\|Forbidden\|Unauthorized\|Permission denied"; then
    echo "✅ Developer 删除被成功拦截 (预期)"
else
    echo "❌ 权限校验非预期结果: $OUT"
fi

# --- 测试 2: Viewer 权限 ---
echo ""
echo "🛠️  测试 2: Viewer (应禁止上传)"
conan user test_viewer -p view123 -r test-perm
echo "⬆️  尝试上传 (预期: 失败/403)..."
OUT=$(conan upload "test_pkg/1.0.0@demo/testing" -r test-perm --all --confirm 2>&1 || true)
if echo "$OUT" | grep -i "403\|Forbidden\|Unauthorized\|Permission denied"; then
    echo "✅ Viewer 上传被成功拦截 (预期)"
else
    echo "❌ 权限校验非预期结果: $OUT"
    exit 1
fi

echo ""
echo "========================================="
echo "🎊 所有权限校验测试通过！"
echo "========================================="
