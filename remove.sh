#!/bin/bash

# Serverless Conan Server - 一键删除脚本
# 完全清除所有 AWS 资源

set -e

echo "=============================================="
echo "🗑️  Serverless Conan Server 一键删除"
echo "=============================================="

REGION="ap-east-1"

# 确认删除
if [ "$1" != "-f" ]; then
    read -p "⚠️  确定要删除所有资源吗？这将删除所有数据！(y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "❌ 已取消删除"
        exit 0
    fi
fi

echo ""
echo "📦 步骤 1: 删除 SST Stack..."
npm run remove || true

echo ""
echo "🗄️  步骤 2: 删除 DynamoDB 表 (SST 默认保留表)..."
TABLES=$(aws dynamodb list-tables --region $REGION --query "TableNames[?contains(@, 'serverless-conan')]" --output text)
for table in $TABLES; do
    aws dynamodb delete-table --table-name "$table" --region $REGION 2>/dev/null && echo "   ✅ 表 $table 已删除" || echo "   ⏭️  表 $table 无法删除或已删除"
done
if [ -z "$TABLES" ]; then
    echo "   ⏭️  没有找到相关 DynamoDB 表"
fi

echo ""
echo "📁 步骤 3: 清空并删除 S3 存储桶..."
BUCKET=$(aws s3 ls --region $REGION 2>/dev/null | grep serverless-conan | awk '{print $3}')
if [ -n "$BUCKET" ]; then
    aws s3 rm s3://$BUCKET --recursive --region $REGION 2>/dev/null || true
    aws s3 rb s3://$BUCKET --region $REGION 2>/dev/null && echo "   ✅ $BUCKET 已删除" || echo "   ⏭️  无法删除存储桶"
else
    echo "   ⏭️  没有找到相关存储桶"
fi

echo ""
echo "🧹 步骤 4: 清理本地构建文件..."
rm -rf .sst .build node_modules demo/consumer/build 2>/dev/null || true
echo "   ✅ 本地构建文件已清理"

echo ""
echo "=============================================="
echo "🎉 删除完成！"
echo "=============================================="
echo ""
echo "如需重新部署，请运行: ./deploy.sh"
