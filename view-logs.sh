#!/bin/bash

# 查看 Conan 审计日志脚本
set -e

# 优先从 .env 加载配置
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

REGION=${AWS_REGION:-"ap-east-1"}
export AWS_PROFILE=${AWS_PROFILE:-"conanserver"}

# 自动获取 AuditLogs 表名
STACK_NAME=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --region $REGION --query "StackSummaries[?contains(StackName, 'serverless-conan') && contains(StackName, 'ConanServerStack')].StackName" --output text | awk '{print $1}')

if [ -z "$STACK_NAME" ]; then
    echo "❌ 找不到部署好的 Stack，请确保已成功部署。"
    exit 1
fi

AUDIT_TABLE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region $REGION --query "Stacks[0].Outputs[?OutputKey=='AuditLogsTableName'].OutputValue" --output text)

echo "📜 正在获取最近 20 条审计日志..."
echo "--------------------------------------------------------------------------------"
printf "%-20s | %-15s | %-20s | %s\n" "时间" "用户" "动作" "详情"
echo "--------------------------------------------------------------------------------"

# 查询 DynamoDB 并格式化输出
# 注意：DynamoDB 扫描性能有限，生产环境建议查询索引，此处为演示方便使用 scan + sort
aws dynamodb scan \
    --table-name "$AUDIT_TABLE" \
    --region $REGION \
    --query "Items | sort_by(@, &timestamp.N) | [-20:]" \
    --output json | jq -r '.[] | "\(.timestamp.N | tonumber | strftime("%Y-%m-%d %H:%M:%S")) | \(.username.S) | \(.action.S) | \(.details.S)"' | while IFS=" | " read -r time user action details; do
        printf "%-20s | %-15s | %-20s | %s\n" "$time" "$user" "$action" "$details"
    done

if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "⚠️  无法获取日志，请确保机器上安装了 jq。"
fi
