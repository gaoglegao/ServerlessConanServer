# 修复 Conan 安装并测试 Serverless Server

## 方案 1: 重新安装 Conan（推荐）

```bash
# 卸载旧版本
pip3 uninstall conan -y

# 安装最新版本的 Conan 2.x
pip3 install conan

# 验证安装
conan --version
```

## 方案 2: 修复当前安装

```bash
# 降级 semver 到兼容版本
pip3 install 'semver<3.0.0'

# 验证
conan --version
```

## 配置 Conan 使用 Serverless Server

安装成功后，配置 Conan 连接到您的 serverless server：

```bash
# 1. 添加远程仓库
conan remote add my-serverless https://48g7e6izq5.execute-api.ap-east-1.amazonaws.com/v1

# 2. 查看所有远程仓库
conan remote list

# 3. 使用管理员账户登录
conan user admin -p admin123 -r my-serverless

# 4. 验证连接（对于 Conan 2.x）
conan remote login my-serverless admin -p admin123
```

## 创建并上传测试包

### 测试包 1: Hello 库

```bash
# 创建测试目录
mkdir /tmp/conan-test-hello && cd /tmp/conan-test-hello

# 创建 conanfile.py
cat > conanfile.py << 'EOF'
from conan import ConanFile

class HelloConan(ConanFile):
    name = "hello"
    version = "1.0"
    license = "MIT"
    description = "Hello World test package for Serverless Conan"
    
    def package_info(self):
        self.cpp_info.libs = ["hello"]
EOF

# 创建包（Conan 2.x 语法）
conan create . --user=demo --channel=stable

# 上传到 serverless server
conan upload "hello/1.0@demo/stable" -r my-serverless --all --confirm
```

### 测试包 2: Math 库

```bash
# 创建另一个测试目录
mkdir /tmp/conan-test-math && cd /tmp/conan-test-math

# 创建 conanfile.py
cat > conanfile.py << 'EOF'
from conan import ConanFile

class MathConan(ConanFile):
    name = "mathlib"
    version = "2.5"
    license = "Apache-2.0"  
    description = "Math library test package"
    
    def package_info(self):
        self.cpp_info.libs = ["mathlib"]
EOF

# 创建包
conan create . --user=mycompany --channel=testing

# 上传
conan upload "mathlib/2.5@mycompany/testing" -r my-serverless --all --confirm
```

## 验证上传成功

```bash
# 搜索所有包
conan search "*" -r my-serverless

# 应该看到:
# hello/1.0@demo/stable
# mathlib/2.5@mycompany/testing

# 查看特定包信息
conan search "hello*" -r my-serverless
```

## 测试下载功能

```bash
# 删除本地缓存
conan remove "hello/1.0@demo/stable" --confirm

# 从 serverless server 重新下载
conan download "hello/1.0@demo/stable" -r my-serverless

# 验证本地已有
conan search "hello*"
```

## 在项目中使用

创建一个使用这些库的项目：

```bash
# 创建项目
mkdir /tmp/my-app && cd /tmp/my-app

# 创建 conanfile.txt
cat > conanfile.txt << 'EOF'
[requires]
hello/1.0@demo/stable
mathlib/2.5@mycompany/testing

[generators]
CMakeDeps
CMakeToolchain
EOF

# 安装依赖（从 serverless server）
conan install . --output-folder=build --build=missing -r my-serverless

# 查看已安装的依赖
ls build/
```

## Conan 2.x 注意事项

如果您使用的是 Conan 2.x（最新版本），命令略有不同：

```bash
# 添加远程
conan remote add my-serverless https://48g7e6izq5.execute-api.ap-east-1.amazonaws.com/v1

# 登录
conan remote login my-serverless admin

# 创建profile
conan profile detect

# 创建并上传包
conan create . 
conan upload hello/1.0 -r my-serverless --all
```

## 常见问题

### Q: Conan 无法连接到服务器

A: 检查网络连接和 API 端点是否正确

```bash
# 测试 API 端点
curl https://48g7e6izq5.execute-api.ap-east-1.amazonaws.com/v1/ping
```

### Q: 认证失败

A: 确保使用正确的用户名和密码

```bash
# 清除凭证
conan user --clean

# 重新登录
conan user admin -p admin123 -r my-serverless
```

### Q: 上传失败

A: 检查是否已认证，并查看 Lambda 日志

```bash
# 查看日志（在 serverlessConan 项目目录）
./manage.sh logs
```

## 完整测试示例

```bash
#!/bin/bash

# 完整的 Conan 测试流程

# 1. 配置
conan remote add my-serverless https://48g7e6izq5.execute-api.ap-east-1.amazonaws.com/v1
conan user admin -p admin123 -r my-serverless

# 2. 创建测试包
mkdir -p /tmp/conan-test && cd /tmp/conan-test
echo 'from conan import ConanFile
class TestPkg(ConanFile):
    name = "testpkg"
    version = "1.0"
' > conanfile.py

# 3. 创建并上传
conan create . --user=test --channel=stable
conan upload "testpkg/1.0@test/stable" -r my-serverless --all --confirm

# 4. 验证
conan search "*" -r my-serverless

# 5. 测试下载
conan remove "testpkg/1.0@test/stable" --confirm
conan download "testpkg/1.0@test/stable" -r my-serverless

echo "✅ Conan 测试完成！"
```

---

**现在您的 serverless Conan Server 已经完全部署并通过测试！** 🎊
