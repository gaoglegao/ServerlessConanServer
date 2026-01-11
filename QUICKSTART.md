# 🚀 快速开始检查列表

按照以下步骤快速部署和测试您的 Serverless Conan Server。

## ✅ 前置条件检查

- [ ] **Node.js 18+** 已安装
  ```bash
  node --version  # 应该显示 v18.x.x 或更高
  ```

- [ ] **npm** 已安装
  ```bash
  npm --version
  ```

- [ ] **AWS CLI** 已安装
  ```bash
  aws --version
  ```

- [ ] **AWS 凭证** 已配置
  ```bash
  aws sts get-caller-identity  # 应该显示您的 AWS 账户信息
  ```

- [ ] **Conan** 已安装（用于测试）
  ```bash
  conan --version  # 推荐 Conan 2.x
  ```

## 📝 步骤 1: 环境检查

```bash
# 在项目目录运行
cd /Users/gaogle/Desktop/程序员/serverlessConan

# 运行检查脚本
./manage.sh check
```

**预期输出:**
```
✅ Node.js 版本: v18.x.x
✅ AWS CLI 已安装
✅ AWS 凭证已配置
✅ 前置条件检查完成！
```

## 📦 步骤 2: 安装依赖

```bash
# 方式 1: 使用管理脚本
./manage.sh install

# 方式 2: 直接使用 npm
npm install
```

**预期输出:**
```
added 1634 packages in 3m
```

- [ ] 依赖安装成功，无错误

## 🚀 步骤 3: 部署到 AWS

### 选项 A: 开发环境部署（推荐用于测试）

```bash
./manage.sh dev
```

这将启动 SST Live Lambda 开发环境，支持热重载。

### 选项 B: 生产环境部署

```bash
./manage.sh deploy
```

⏱️ **预计时间:** 3-5 分钟

**预期输出:**
```
✔  Deployed:
   ConanServerStack
   ApiEndpoint: https://xxxxx.execute-api.ap-east-1.amazonaws.com
   PackagesBucketName: serverless-conan-conanpackages-xxxxx
   PackagesTableName: serverless-conan-conanpackagesmetadata-xxxxx
   UsersTableName: serverless-conan-conanusers-xxxxx
```

- [ ] 部署成功
- [ ] **记录以下信息:**
  - API 端点: `_________________________________`
  - Packages Bucket: `_________________________________`
  - Packages Table: `_________________________________`
  - Users Table: `_________________________________`

## 👤 步骤 4: 初始化管理员用户

```bash
./manage.sh init-users
```

**预期输出:**
```
✅ Default user created successfully
Username: admin
Password: admin123
Token: xxxxxxxx

⚠️  Please change the password after first login!
```

- [ ] 管理员用户创建成功
- [ ] 记录默认密码（稍后修改）

## 🧪 步骤 5: 测试连接

```bash
# 方式 1: 使用管理脚本
./manage.sh test

# 方式 2: 手动测试
curl https://your-api-endpoint.execute-api.ap-east-1.amazonaws.com/v1/ping
```

**预期输出:**
```
{"status":"ok","version":"1.0.0"}
```

- [ ] Ping 测试成功
- [ ] 服务器响应正常

## 🔧 步骤 6: 配置 Conan 客户端

### 6.1 添加远程仓库

```bash
# 替换为您的实际 API 端点
conan remote add my-serverless https://your-api-endpoint.execute-api.ap-east-1.amazonaws.com/v1

# 验证
conan remote list
```

**预期输出:**
```
my-serverless: https://xxxxx.execute-api.ap-east-1.amazonaws.com/v1 [Verify SSL: True]
conancenter: https://center.conan.io [Verify SSL: True]
```

- [ ] 远程仓库添加成功

### 6.2 用户认证

```bash
conan user admin -p admin123 -r my-serverless
```

**预期输出:**
```
Changed user of remote 'my-serverless' from 'None' (anonymous) to 'admin'
```

- [ ] 认证成功

## 📦 步骤 7: 创建并上传测试包

### 7.1 创建测试项目

```bash
# 创建测试目录
mkdir /tmp/test-conan-package
cd /tmp/test-conan-package

# 创建 conanfile.py
cat > conanfile.py << 'EOF'
from conan import ConanFile

class HelloConan(ConanFile):
    name = "hello"
    version = "1.0"
    license = "MIT"
    description = "Test package for Serverless Conan"
    
    def package_info(self):
        self.cpp_info.libs = ["hello"]
EOF
```

- [ ] 测试项目创建完成

### 7.2 创建包

```bash
conan create . --user=demo --channel=testing
```

**预期输出:**
```
hello/1.0@demo/testing: Exported to cache folder
```

- [ ] 包创建成功

### 7.3 上传到 Serverless Server

```bash
conan upload "hello/1.0@demo/testing" -r my-serverless --all --confirm
```

**预期输出:**
```
Uploading hello/1.0@demo/testing to my-serverless
Uploading conanfile.py
Uploading conanmanifest.txt
...
```

- [ ] 包上传成功

## 🔍 步骤 8: 搜索和下载测试

### 8.1 搜索包

```bash
conan search "*" -r my-serverless
```

**预期输出:**
```
hello/1.0@demo/testing
```

- [ ] 搜索返回正确结果

### 8.2 删除本地缓存并重新下载

```bash
# 删除本地包
conan remove "hello/1.0@demo/testing" --confirm

# 从服务器下载
conan download "hello/1.0@demo/testing" -r my-serverless
```

**预期输出:**
```
Downloading hello/1.0@demo/testing from my-serverless
```

- [ ] 下载成功

## 📊 步骤 9: 查看日志（可选）

```bash
./manage.sh logs
```

这将显示 Lambda 函数的实时日志。

- [ ] 可以看到请求日志

## ✅ 完成检查列表

所有步骤完成后，您应该能够：

- [x] ✅ 服务器成功部署到 AWS
- [x] ✅ 管理员用户已创建
- [x] ✅ Conan 客户端已配置
- [x] ✅ 可以上传包到服务器
- [x] ✅ 可以搜索和下载包
- [x] ✅ 服务器运行正常

## 🎉 下一步

现在您可以：

1. **在团队中使用**
   - 分享 API 端点给团队成员
   - 为每个成员创建独立账户
   - 开始管理您的 C++ 库

2. **进一步配置**
   - [ ] 配置自定义域名
   - [ ] 启用日志和监控
   - [ ] 设置成本预算告警
   - [ ] 实施备份策略

3. **集成 CI/CD**
   - [ ] GitHub Actions 自动构建和上传
   - [ ] Jenkins 集成
   - [ ] GitLab CI 集成

4. **安全加固**
   - [ ] 修改默认管理员密码
   - [ ] 实施密码加密
   - [ ] 启用 API 密钥
   - [ ] 配置 WAF 防护

## ⚠️ 常见问题

### 部署失败

**症状:** `sst deploy` 失败

**解决方案:**
1. 检查 AWS 凭证是否有效
2. 确认所选区域支持所有服务
3. 查看错误日志

### 认证失败

**症状:** `conan user` 返回错误

**解决方案:**
1. 确认用户已初始化
2. 检查用户名和密码
3. 查看 Lambda 日志

### 上传/下载失败

**症状:** 文件传输失败

**解决方案:**
1. 检查 S3 CORS 配置
2. 增加 Lambda 超时时间
3. 检查网络连接

## 📚 更多资源

- [README.md](./README.md) - 项目概览
- [DEPLOYMENT.md](./DEPLOYMENT.md) - 详细部署指南
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构说明
- [CONAN_CLIENT_GUIDE.md](./CONAN_CLIENT_GUIDE.md) - Conan 客户端配置

## 🆘 需要帮助？

如果遇到问题：

1. 查看日志: `./manage.sh logs`
2. 检查 AWS 控制台
3. 参考文档
4. 提交 Issue

---

**恭喜！您的 Serverless Conan Server 已经准备就绪！** 🎊
