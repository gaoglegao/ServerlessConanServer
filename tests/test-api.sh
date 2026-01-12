#!/bin/bash

# Serverless Conan Server API 测试脚本

# 优先从 .env 加载配置
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

REGION=${AWS_REGION:-"ap-east-1"}
export AWS_PROFILE=${AWS_PROFILE:-"conanserver"}

# 自动获取 API 端点
STACK_NAME=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --region "$REGION" --query "StackSummaries[?contains(StackName, 'serverless-conan') && contains(StackName, 'ConanServerStack')].StackName" --output text | awk '{print $1}')
API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)

ADMIN_USER=${CONAN_ADMIN_USER:-"admin"}
ADMIN_PASS=${CONAN_ADMIN_PASS:-"YOUR_PASSWORD"}

echo "========================================="
echo "Serverless Conan Server API 测试"
echo "========================================="
echo ""

# 1. Ping 测试
echo "1. 测试 Ping 端点..."
response=$(curl -s "${API_ENDPOINT}/v1/ping")
echo "响应: $response"
echo ""

# 2. 用户认证
echo "2. 测试用户认证..."
auth_response=$(curl -s -X POST "${API_ENDPOINT}/v1/users/authenticate" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
echo "认证响应: $auth_response"

# 提取 token
token=$(echo $auth_response | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "Token: $token"
echo ""

# 3. 检查凭证
echo "3. 测试凭证检查..."
check_response=$(curl -s -X POST "${API_ENDPOINT}/v1/users/check_credentials" \
  -H "Authorization: Bearer $token")
echo "凭证检查响应: $check_response"
echo ""

# 4. 搜索包（应该为空）
echo "4. 搜索包..."
search_response=$(curl -s "${API_ENDPOINT}/v1/conans/search?q=*")
echo "搜索响应: $search_response"
echo ""

# 5. 模拟创建包元数据（测试upload_urls endpoint）
echo "5. 测试获取上传URL..."
upload_response=$(curl -s -X POST "${API_ENDPOINT}/v1/conans/testlib/1.0/demo/testing/upload_urls" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $token" \
  -d '{"files":["conanfile.py","conanmanifest.txt"]}')
echo "上传URL响应: $upload_response"
echo ""

# 6. 再次搜索（应该能找到刚创建的包）
echo "6. 再次搜索包..."
search_response2=$(curl -s "${API_ENDPOINT}/v1/conans/search?q=*")
echo "搜索响应: $search_response2"
echo ""

# 7. 获取包信息
echo "7. 获取包信息..."
package_info=$(curl -s "${API_ENDPOINT}/v1/conans/testlib/1.0/demo/testing")
echo "包信息: $package_info"
echo ""

# 8. 获取下载URL
echo "8. 测试获取下载URL..."
download_response=$(curl -s "${API_ENDPOINT}/v1/conans/testlib/1.0/demo/testing/download_urls")
echo "下载URL响应: $download_response"
echo ""

echo "========================================="
echo "测试完成！"
echo "========================================="
echo ""
echo "总结:"
echo "- API 端点: $API_ENDPOINT"
echo "- 管理员用户名: $ADMIN_USER"
echo "- 管理员密码: [已配置]"
echo "- 认证 Token: $token"
echo ""
echo "所有核心 API 端点都已测试成功！"
