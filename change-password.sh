#!/bin/bash

# 修改 Conan 用户密码脚本
set -e

USERNAME=$1
NEW_PASSWORD=$2

if [ -z "$USERNAME" ] || [ -z "$NEW_PASSWORD" ]; then
    echo "使用方法: ./change-password.sh <用户名> <新密码>"
    echo "示例: ./change-password.sh admin NewStrongPass123"
    exit 1
fi

# 优先从 .env 加载配置
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

REGION=${AWS_REGION:-"ap-east-1"}
export AWS_PROFILE=${AWS_PROFILE:-"conanserver"}

# 自动获取 Users 表名
STACK_NAME=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --region "$REGION" --query "StackSummaries[?contains(StackName, 'serverless-conan') && contains(StackName, 'ConanServerStack')].StackName" --output text | awk '{print $1}')

if [ -z "$STACK_NAME" ]; then
    echo "❌ 找不到部署好的 Stack，请确保已成功部署。"
    exit 1
fi

USERS_TABLE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='UsersTableName'].OutputValue" --output text)

# 检查用户是否存在
USER_INFO=$(aws dynamodb get-item \
    --table-name "$USERS_TABLE" \
    --key "{\"username\": {\"S\": \"$USERNAME\"}}" \
    --region "$REGION" 2>/dev/null)

if [ -z "$USER_INFO" ] || [ "$USER_INFO" == "{}" ]; then
    echo "❌ 用户 [$USERNAME] 不存在"
    exit 1
fi

# 获取用户角色
USER_ROLE=$(echo "$USER_INFO" | grep -o '"role"[^}]*' | grep -o '"S"[^}]*' | cut -d'"' -f4)

# 生成新密码哈希 (SHA256)
PASSWORD_HASH=$(echo -n "$NEW_PASSWORD" | openssl dgst -sha256 | awk '{print $2}')

echo "🔐 正在为用户 [$USERNAME] 修改密码..."

# 更新密码（保留原有的 token 和其他信息）
aws dynamodb update-item \
    --table-name "$USERS_TABLE" \
    --key "{\"username\": {\"S\": \"$USERNAME\"}}" \
    --update-expression "SET passwordHash = :pwd" \
    --expression-attribute-values "{\":pwd\": {\"S\": \"$PASSWORD_HASH\"}}" \
    --region "$REGION"

echo "✅ 密码修改成功！"

# 如果是 admin 角色，同步更新本地 .env
if [ "$USER_ROLE" == "admin" ]; then
    echo "📝 检测到管理员账号，正在同步到本地 .env..."
    if [ ! -f .env ]; then
        cp .env.example .env 2>/dev/null || touch .env
    fi
    # 清除旧的管理员配置并追加新的
    grep -v "CONAN_ADMIN_USER" .env | grep -v "CONAN_ADMIN_PASS" > .env.tmp || true
    echo "CONAN_ADMIN_USER=$USERNAME" >> .env.tmp
    echo "CONAN_ADMIN_PASS=$NEW_PASSWORD" >> .env.tmp
    mv .env.tmp .env
    echo "✅ 本地 .env 已更新"
fi

echo ""
echo "用户可以使用新密码登录:"
echo "conan user $USERNAME -p $NEW_PASSWORD -r <YOUR_REMOTE_NAME>"
