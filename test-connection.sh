#!/bin/bash

# Conan 服务器连接测试脚本

API_ENDPOINT="https://pu9tefmfrg.execute-api.ap-east-1.amazonaws.com"
USERNAME="admin"
PASSWORD="gaoweiliang"

echo "=========================================="
echo "🧪 Conan 服务器连接测试"
echo "=========================================="
echo ""

echo "📍 API 端点: $API_ENDPOINT"
echo "👤 用户名: $USERNAME"
echo ""

# 测试 1: Ping
echo "1️⃣ 测试 Ping..."
PING_RESULT=$(curl -s "$API_ENDPOINT/v1/ping")
echo "   结果: $PING_RESULT"
echo ""

# 测试 2: Basic Auth 认证
echo "2️⃣ 测试 Basic Auth 认证..."
TOKEN=$(curl -s -u "$USERNAME:$PASSWORD" "$API_ENDPOINT/v1/users/authenticate")
if [ -n "$TOKEN" ] && [ "$TOKEN" != *"error"* ]; then
    echo "   ✅ 认证成功"
    echo "   Token: ${TOKEN:0:20}..."
else
    echo "   ❌ 认证失败: $TOKEN"
    exit 1
fi
echo ""

# 测试 3: JSON 认证
echo "3️⃣ 测试 JSON 认证..."
JSON_RESULT=$(curl -s -X POST "$API_ENDPOINT/v1/users/authenticate" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"$USERNAME\", \"password\": \"$PASSWORD\"}")
echo "   结果: $JSON_RESULT"
echo ""

# 测试 4: Token 验证
echo "4️⃣ 测试 Token 验证..."
CHECK_RESULT=$(curl -s "$API_ENDPOINT/v1/users/check_credentials" \
    -H "Authorization: Bearer $TOKEN")
echo "   结果: $CHECK_RESULT"
echo ""

# 测试 5: 搜索包
echo "5️⃣ 测试搜索包..."
SEARCH_RESULT=$(curl -s "$API_ENDPOINT/v1/conans/search?q=*" \
    -H "Authorization: Bearer $TOKEN")
echo "   结果: $SEARCH_RESULT"
echo ""

echo "=========================================="
echo "✅ 所有测试完成！"
echo "=========================================="
echo ""
echo "📝 Conan 客户端配置命令:"
echo "   conan remote add my-conan $API_ENDPOINT"
echo "   conan user $USERNAME -p $PASSWORD -r my-conan"
echo ""
