#!/bin/bash

# 添加 Conan 用户脚本
set -e

USERNAME=$1
PASSWORD=$2
ROLE=${3:-readonly} # 默认为 readonly

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo "使用方法: ./add-user.sh <用户名> <密码> [角色: admin|developer|viewer]"
    echo "示例 (管理员): ./add-user.sh boss 123456 admin"
    echo "示例 (开发员): ./add-user.sh dev 123456 developer"
    echo "示例 (只读): ./add-user.sh guest 123456 viewer"
    exit 1
fi

if [[ "$ROLE" != "admin" && "$ROLE" != "developer" && "$ROLE" != "viewer" ]]; then
    echo "❌ 角色必须是 admin, developer 或 viewer"
    exit 1
fi

# 优先从 .env 加载配置
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

REGION=${AWS_REGION:-"ap-east-1"}
export AWS_PROFILE=${AWS_PROFILE:-"conanserver"}
STACK_NAME=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --region $REGION --query "StackSummaries[?contains(StackName, 'serverless-conan') && contains(StackName, 'ConanServerStack')].StackName" --output text | awk '{print $1}')

if [ -z "$STACK_NAME" ]; then
    echo "❌ 找不到部署好的 Stack，请确保已成功部署。"
    exit 1
fi

USERS_TABLE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region $REGION --query "Stacks[0].Outputs[?OutputKey=='UsersTableName'].OutputValue" --output text)

# 生成密码哈希 (SHA256)
PASSWORD_HASH=$(echo -n "$PASSWORD" | openssl dgst -sha256 | awk '{print $2}')
CREATED_AT=$(date +%s)

echo "👤 正在为用户 [$USERNAME] 创建账号 (角色: $ROLE)..."

aws dynamodb put-item \
    --table-name "$USERS_TABLE" \
    --item "{
        \"username\": {\"S\": \"$USERNAME\"},
        \"passwordHash\": {\"S\": \"$PASSWORD_HASH\"},
        \"role\": {\"S\": \"$ROLE\"},
        \"createdAt\": {\"N\": \"$CREATED_AT\"}
    }" \
    --region $REGION

# 如果是 admin 角色，同步更新本地 .env 文件
if [ "$ROLE" == "admin" ]; then
    echo "📝 正在同步管理员凭证到本地 .env..."
    if [ ! -f .env ]; then
        cp .env.example .env 2>/dev/null || touch .env
    fi
    # 清除旧的行政配置并追加新的
    grep -v "CONAN_ADMIN_USER" .env | grep -v "CONAN_ADMIN_PASS" > .env.tmp || true
    echo "CONAN_ADMIN_USER=$USERNAME" >> .env.tmp
    echo "CONAN_ADMIN_PASS=$PASSWORD" >> .env.tmp
    mv .env.tmp .env
    echo "✅ 本地 .env 已更新"
fi

echo "✅ 用户 [$USERNAME] 添加成功！"
echo "该用户可以使用以下命令登录:"
echo "conan user $USERNAME -p $PASSWORD -r <YOUR_REMOTE_NAME>"
