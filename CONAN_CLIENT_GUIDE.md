# Conan 客户端配置指南

## 在本地机器配置 Conan 使用 Serverless Server

### 1. 添加远程仓库

首先，获取您的 API 端点（部署时会显示），然后添加远程仓库：

```bash
# 格式: conan remote add <远程名称> <API端点>/v1
conan remote add my-company https://xxxxx.execute-api.ap-east-1.amazonaws.com/v1

# 查看所有远程仓库
conan remote list
```

### 2. 用户认证

```bash
# 使用管理员账户登录
conan user admin -p admin123 -r my-company

# 验证登录状态
conan user -r my-company
```

### 3. 设置为默认仓库（可选）

```bash
# 将此仓库设置为优先级最高
conan remote update my-company --index 0
```

## 使用示例

### 上传包到 Serverless Server

```bash
# 方式 1: 从现有包上传
conan upload "mylib/1.0@demo/stable" -r my-company --all --confirm

# 方式 2: 上传所有包
conan upload "*" -r my-company --all --confirm

# 方式 3: 仅上传 recipe（不包含二进制）
conan upload "mylib/1.0@demo/stable" -r my-company
```

### 从 Serverless Server 下载包

```bash
# 搜索可用的包
conan search "*" -r my-company

# 搜索特定包
conan search "mylib*" -r my-company

# 下载包到本地缓存
conan install mylib/1.0@demo/stable -r my-company

# 下载但不安装（仅下载到缓存）
conan download mylib/1.0@demo/stable -r my-company
```

### 创建并上传新包

完整的工作流程示例：

```bash
# 1. 创建项目目录
mkdir my-conan-package && cd my-conan-package

# 2. 创建 conanfile.py
cat > conanfile.py << 'EOF'
from conan import ConanFile
from conan.tools.cmake import CMake, cmake_layout

class MyLibConan(ConanFile):
    name = "mylib"
    version = "1.0"
    license = "MIT"
    description = "My awesome library"
    settings = "os", "compiler", "build_type", "arch"
    
    def layout(self):
        cmake_layout(self)
    
    def package_info(self):
        self.cpp_info.libs = ["mylib"]
EOF

# 3. 创建包
conan create . --user=mycompany --channel=stable

# 4. 上传到 serverless server
conan upload "mylib/1.0@mycompany/stable" -r my-company --all --confirm

# 5. 验证上传成功
conan search "mylib*" -r my-company
```

## 多环境配置

可以为不同环境配置不同的远程仓库：

```bash
# 开发环境
conan remote add dev https://dev-api.example.com/v1

# 生产环境
conan remote add prod https://prod-api.example.com/v1

# 查看所有仓库
conan remote list

# 输出示例:
# dev: https://dev-api.example.com/v1 [Verify SSL: True]
# prod: https://prod-api.example.com/v1 [Verify SSL: True]
```

## 团队协作工作流

### 场景 1: 库开发者发布新版本

```bash
# 1. 开发并测试库
cd my-library
# ... 进行开发 ...

# 2. 创建 Conan 包
conan create . --user=mycompany --channel=testing

# 3. 测试通过后，上传到 serverless server
conan upload "mylib/2.0@mycompany/testing" -r my-company --all --confirm

# 4. 通知团队新版本可用
echo "mylib/2.0@mycompany/testing is ready for testing"
```

### 场景 2: 应用开发者使用库

```bash
# 1. 在项目的 conanfile.txt 中添加依赖
cat > conanfile.txt << EOF
[requires]
mylib/2.0@mycompany/testing

[generators]
CMakeDeps
CMakeToolchain
EOF

# 2. 安装依赖
conan install . --output-folder=build --build=missing -r my-company

# 3. 构建项目
cmake -B build -DCMAKE_TOOLCHAIN_FILE=build/conan_toolchain.cmake
cmake --build build
```

### 场景 3: 升级到稳定版本

```bash
# 库开发者将测试版本提升到稳定版
conan copy "mylib/2.0@mycompany/testing" --user=mycompany --channel=stable
conan upload "mylib/2.0@mycompany/stable" -r my-company --all --confirm

# 应用开发者更新依赖
# 修改 conanfile.txt:
# mylib/2.0@mycompany/testing -> mylib/2.0@mycompany/stable
conan install . --update -r my-company
```

## 常见问题

### Q1: 如何切换远程仓库？

```bash
# 方法 1: 在命令中指定
conan install . -r my-company

# 方法 2: 设置优先级
conan remote update my-company --index 0
```

### Q2: 如何删除本地缓存并重新下载？

```bash
# 删除特定包
conan remove "mylib/1.0@mycompany/stable"

# 删除所有缓存
conan remove "*" --confirm

# 重新下载
conan install . -r my-company --build=missing
```

### Q3: 如何列出远程仓库的所有包？

```bash
# 搜索所有包
conan search "*" -r my-company

# 搜索特定包及其版本
conan search "mylib/*" -r my-company
```

### Q4: 认证失败怎么办？

```bash
# 重新登录
conan user admin -p admin123 -r my-company

# 清除凭证
conan user --clean

# 重新认证
conan user admin -p admin123 -r my-company
```

### Q5: 如何配置代理？

```bash
# 在 conan 配置文件中设置代理
conan config set proxies.http=http://proxy.example.com:8080
conan config set proxies.https=https://proxy.example.com:8080
```

## 最佳实践

1. **使用 Channel 管理版本稳定性**
   - `testing`: 开发和测试阶段
   - `stable`: 生产就绪版本

2. **语义化版本控制**
   - 遵循 `MAJOR.MINOR.PATCH` 格式
   - 不兼容的 API 变更增加 MAJOR 版本

3. **上传完整包**
   - 总是使用 `--all` 上传 recipe 和二进制包
   - 为不同平台构建并上传二进制包

4. **定期清理**
   - 删除旧版本或不再使用的包
   - 节省 S3 存储成本

5. **安全性**
   - 不要在代码中硬编码密码
   - 使用环境变量存储凭证
   - 定期更换访问令牌

## CI/CD 集成

### GitHub Actions 示例

```yaml
name: Build and Upload Conan Package

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Conan
        run: pip install conan
      
      - name: Configure Conan Remote
        run: |
          conan remote add my-company ${{ secrets.CONAN_SERVER_URL }}/v1
      
      - name: Authenticate
        run: |
          conan user ${{ secrets.CONAN_USER }} \
            -p ${{ secrets.CONAN_PASSWORD }} \
            -r my-company
      
      - name: Create and Upload Package
        run: |
          conan create . --user=mycompany --channel=stable
          conan upload "*" -r my-company --all --confirm
```

## 高级配置

### 自定义配置文件

创建 `~/.conan/profiles/myprofile`:

```ini
[settings]
os=Linux
arch=x86_64
compiler=gcc
compiler.version=11
compiler.libcxx=libstdc++11
build_type=Release

[options]

[build_requires]

[env]
CC=gcc-11
CXX=g++-11
```

使用自定义配置：

```bash
conan create . --profile=myprofile
conan install . --profile=myprofile
```

这样您就可以完全使用 Conan 客户端管理您的 serverless Conan Server 了！
