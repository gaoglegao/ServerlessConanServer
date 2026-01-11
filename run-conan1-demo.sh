#!/bin/bash

# Conan 1.x 端到端演示脚本
set -e

# 激活虚拟环境
source venv/bin/activate

API_ENDPOINT="https://48g7e6izq5.execute-api.ap-east-1.amazonaws.com"
export CONAN_TRACE_FILE="/tmp/conan_trace.log"

echo "========================================="
echo "🛠️  配置 Conan 1.x ..."
echo "========================================="
conan --version

# 禁用 SSL 验证
conan config set general.verify_ssl=False

# 添加远程仓库
conan remote clean
conan remote add my-serverless "${API_ENDPOINT}"
conan config set general.verify_ssl=False

# 禁用 Revisions（因为我们的轻量级服务器不支持 Revision API）
conan config set general.revisions_enabled=0
conan config set general.verify_ssl=False

# 登录
echo "🔑 登录到 Serverless Server..."
conan user admin -p admin123 -r my-serverless

echo "========================================="
echo "📦 步骤 1: 创建 Conan 包 (mymath/1.0.0)"
echo "========================================="
cd demo/mymath-library
conan create . demo/stable

echo ""
echo "========================================="
echo "⬆️  步骤 2: 上传包到云端"
echo "========================================="
conan upload "mymath/1.0.0@demo/stable" -r my-serverless --all --confirm

echo ""
echo "========================================="
echo "🗑️  步骤 3: 删除本地缓存"
echo "========================================="
conan remove "mymath/1.0.0@demo/stable" -f
echo "✅ 本地缓存已清除"

echo ""
echo "========================================="
echo "⬇️  步骤 4: 从云端下载并使用"
echo "========================================="

# 创建消费项目目录
mkdir -p ../consumer
cd ../consumer

# 创建消费代码
cat > main.cpp << 'EOF'
#include <iostream>
#include "mymath.h"

int main() {
    int sum = mymath::add(10, 20);
    int prod = mymath::multiply(5, 6);
    
    std::cout << "10 + 20 = " << sum << std::endl;
    std::cout << "5 * 6 = " << prod << std::endl;
    
    if (sum == 30 && prod == 30) {
        std::cout << "✅ Math library works correctly!" << std::endl;
        return 0;
    } else {
        std::cout << "❌ Math library calculation error!" << std::endl;
        return 1;
    }
}
EOF

# 创建 CMakeLists.txt
cat > CMakeLists.txt << 'EOF'
cmake_minimum_required(VERSION 3.5)
project(Consumer)

include(${CMAKE_BINARY_DIR}/conanbuildinfo.cmake)
conan_basic_setup()

add_executable(app main.cpp)
target_link_libraries(app ${CONAN_LIBS})
EOF

# 创建 conanfile.txt
cat > conanfile.txt << 'EOF'
[requires]
mymath/1.0.0@demo/stable

[generators]
cmake
EOF

echo "📥 安装依赖 (从 my-serverless 下载)..."
mkdir -p build && cd build
conan install .. -r my-serverless --build=missing

echo "🔨 编译项目..."
cmake .. -DCONAN_DISABLE_CHECK_COMPILER=ON
cmake --build .

echo ""
echo "========================================="
echo "🏃 步骤 5: 运行应用程序"
echo "========================================="
./bin/app

echo ""
echo "🎉 演示成功完成！"
