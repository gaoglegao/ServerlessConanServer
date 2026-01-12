#!/bin/bash

# Serverless Conan Server - 一键部署脚本
# 支持 Conan 1.x 的完整包管理工作流

set -e

echo "=============================================="
echo "🚀 Serverless Conan Server 一键部署"
echo "=============================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 需要 Node.js。请先安装 Node.js (建议 v18+)"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 需要 npm。请先安装 npm"
    exit 1
fi
echo "✅ npm: $(npm --version)"

# 检查 AWS CLI
if ! command -v aws &> /dev/null; then
    echo "❌ 需要 AWS CLI。请先安装并配置 AWS CLI"
    exit 1
fi
echo "✅ AWS CLI: $(aws --version | cut -d' ' -f1)"

# 检查 AWS 凭证
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS 凭证未配置。请运行 'aws configure' 配置您的 AWS 凭证"
    exit 1
fi
echo "✅ AWS 凭证已配置"

echo ""
echo "📦 步骤 1: 安装依赖..."
npm install

echo ""
echo "🏗️  步骤 2: 部署到 AWS..."
npm run deploy

# 获取部署输出 (自动检测 Stack Name)
STACK_NAME=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --region ap-east-1 --query "StackSummaries[?contains(StackName, 'serverless-conan') && contains(StackName, 'ConanServerStack')].StackName" --output text | awk '{print $1}')

if [ -z "$STACK_NAME" ]; then
    echo "⚠️  无法自动检测到 Stack Name，请手动运行后续步骤"
else
    echo "🔍 检测到 Stack: $STACK_NAME"
    API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region ap-east-1 --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)
    USERS_TABLE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region ap-east-1 --query "Stacks[0].Outputs[?OutputKey=='UsersTableName'].OutputValue" --output text)
fi

if [ -z "$API_ENDPOINT" ]; then
    echo "⚠️  无法自动获取 API 端点，请从上方输出中查看"
else
    echo ""
    echo "🔧 步骤 3: 创建默认管理员用户..."
    
    # 优先从 .env 加载配置
    if [ -f .env ]; then
        export $(grep -v '^#' .env | xargs)
    fi

    ADMIN_USER=${CONAN_ADMIN_USER:-"admin"}
    ADMIN_PASS=${CONAN_ADMIN_PASS:-"admin123"}
    
    # 使用 AWS CLI 直接创建用户
    ADMIN_TOKEN=$(openssl rand -hex 32)
    PASSWORD_HASH=$(echo -n "$ADMIN_PASS" | openssl dgst -sha256 | awk '{print $2}')
    
    aws dynamodb put-item \
        --table-name "$USERS_TABLE" \
        --item "{
            \"username\": {\"S\": \"$ADMIN_USER\"},
            \"passwordHash\": {\"S\": \"$PASSWORD_HASH\"},
            \"role\": {\"S\": \"admin\"},
            \"token\": {\"S\": \"$ADMIN_TOKEN\"},
            \"createdAt\": {\"N\": \"$(date +%s)\"}
        }" \
        --region ap-east-1 2>/dev/null || echo "用户可能已存在，跳过创建"

    echo ""
    echo "=============================================="
    echo "🎉 部署完成！"
    echo "=============================================="
    echo ""
    echo "📍 API 端点: $API_ENDPOINT"
    echo ""
    echo "👤 默认管理员账户:"
    echo "   用户名: $ADMIN_USER"
    echo "   密码: $ADMIN_PASS"
    echo ""
    echo "📝 配置 Conan 1.x 客户端:"
    echo "   conan remote add my-server $API_ENDPOINT"
    echo "   conan user $ADMIN_USER -p <YOUR_PASSWORD> -r my-server"
    echo ""
    echo "📖 更多信息请参阅 README.md"
fi
