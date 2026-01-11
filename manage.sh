#!/bin/bash

# Serverless Conan Server 管理脚本

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 函数：打印带颜色的消息
print_info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 检查前置条件
check_prerequisites() {
    print_info "检查前置条件..."
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js 未安装，请先安装 Node.js 18+"
        exit 1
    fi
    
    node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_version" -lt 18 ]; then
        print_error "Node.js 版本过低（当前: $(node -v)），需要 18+"
        exit 1
    fi
    print_info "✓ Node.js 版本: $(node -v)"
    
    # 检查 AWS CLI
    if ! command -v aws &> /dev/null; then
        print_warning "AWS CLI 未安装，建议安装以便管理资源"
    else
        print_info "✓ AWS CLI 已安装"
        
        # 检查 AWS 凭证
        if ! aws sts get-caller-identity &> /dev/null; then
            print_error "AWS 凭证未配置，请运行: aws configure"
            exit 1
        fi
        print_info "✓ AWS 凭证已配置"
    fi
    
    print_info "前置条件检查完成！\n"
}

# 安装依赖
install_deps() {
    print_info "安装依赖..."
    npm install
    print_info "依赖安装完成！\n"
}

# 部署到 AWS
deploy() {
    print_info "开始部署到 AWS..."
    print_warning "这可能需要几分钟时间...\n"
    
    npm run deploy
    
    print_info "\n部署完成！"
    print_warning "请记录上面的输出信息（ApiEndpoint、表名等）"
    print_info "下一步：运行 './manage.sh init-users' 初始化管理员用户\n"
}

# 开发模式
dev() {
    print_info "启动开发模式（Live Lambda）..."
    print_warning "这将启用热重载，代码更改会立即生效"
    print_info "按 Ctrl+C 停止\n"
    
    npm run dev
}

# 初始化用户
init_users() {
    print_info "初始化管理员用户..."
    
    # 尝试从 SST 输出获取表名
    if [ -d ".sst" ]; then
        # 查找 UsersTableName
        users_table=$(grep -r "UsersTableName" .sst 2>/dev/null | head -1 | awk -F': ' '{print $2}' | tr -d '",' || echo "")
        
        if [ -n "$users_table" ]; then
            print_info "找到 Users 表: $users_table"
            USERS_TABLE_NAME="$users_table" node scripts/init-users.ts
        else
            print_error "无法自动找到 Users 表名"
            print_info "请手动运行: USERS_TABLE_NAME=<表名> node scripts/init-users.ts"
            exit 1
        fi
    else
        print_error "项目尚未部署，请先运行: ./manage.sh deploy"
        exit 1
    fi
    
    print_info "管理员用户初始化完成！"
    print_info "用户名: admin"
    print_info "密码: admin123"
    print_warning "请立即修改密码！\n"
}

# 测试连接
test() {
    print_info "测试 Conan Server 连接..."
    
    # 尝试从 .sst 获取 API 端点
    if [ -d ".sst" ]; then
        api_endpoint=$(grep -r "ApiEndpoint" .sst 2>/dev/null | head -1 | awk -F': ' '{print $2}' | tr -d '",' || echo "")
        
        if [ -n "$api_endpoint" ]; then
            print_info "API 端点: $api_endpoint"
            print_info "\n发送 ping 请求...\n"
            
            response=$(curl -s "$api_endpoint/v1/ping")
            echo "响应: $response"
            
            if echo "$response" | grep -q "ok"; then
                print_info "\n✅ 服务器运行正常！"
            else
                print_error "\n❌ 服务器响应异常"
                exit 1
            fi
        else
            print_error "无法找到 API 端点"
            exit 1
        fi
    else
        print_error "项目尚未部署"
        exit 1
    fi
}

# 查看日志
logs() {
    print_info "获取 Lambda 日志..."
    
    # 查找 Lambda 函数名
    function_name=$(aws lambda list-functions --query "Functions[?contains(FunctionName, 'serverless-conan')].FunctionName" --output text | head -1)
    
    if [ -n "$function_name" ]; then
        print_info "Lambda 函数: $function_name\n"
        aws logs tail "/aws/lambda/$function_name" --follow
    else
        print_error "找不到 Lambda 函数"
        exit 1
    fi
}

# 移除部署
remove() {
    print_warning "这将删除所有 AWS 资源和数据！"
    read -p "确定要继续吗？(yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
        print_info "开始移除部署..."
        npm run remove
        print_info "部署已移除"
    else
        print_info "操作已取消"
    fi
}

# 显示帮助
show_help() {
    cat << EOF
Serverless Conan Server 管理脚本

用法: ./manage.sh [命令]

命令:
  check         检查前置条件
  install       安装依赖
  deploy        部署到 AWS（生产）
  dev           启动开发模式（Live Lambda）
  init-users    初始化管理员用户
  test          测试服务器连接
  logs          查看 Lambda 日志
  remove        移除部署（删除所有资源）
  help          显示此帮助信息

示例:
  ./manage.sh check        # 检查环境
  ./manage.sh deploy       # 部署
  ./manage.sh init-users   # 初始化用户
  ./manage.sh test         # 测试连接

快速开始:
  1. ./manage.sh check
  2. ./manage.sh deploy
  3. ./manage.sh init-users
  4. ./manage.sh test

EOF
}

# 主逻辑
case "${1:-help}" in
    check)
        check_prerequisites
        ;;
    install)
        install_deps
        ;;
    deploy)
        check_prerequisites
        deploy
        ;;
    dev)
        check_prerequisites
        dev
        ;;
    init-users)
        init_users
        ;;
    test)
        test
        ;;
    logs)
        logs
        ;;
    remove)
        remove
        ;;
    help|*)
        show_help
        ;;
esac
