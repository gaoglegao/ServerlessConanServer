# 部署指南

## 前置要求

1. **Node.js**: 版本 18 或更高
2. **AWS CLI**: 已配置好凭证
3. **AWS 账户**: 需要有以下服务的权限
   - Lambda
   - API Gateway
   - S3
   - DynamoDB
   - CloudFormation
   - IAM

## 详细部署步骤

### 1. 克隆或初始化项目

```bash
cd /Users/gaogle/Desktop/程序员/serverlessConan
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 AWS 区域（可选）

默认部署到 `ap-east-1`（香港），如需更改，编辑 `sst.config.ts`：

```typescript
export default {
  config(_input) {
    return {
      name: "serverless-conan",
      region: "us-east-1", // 改为您想要的区域
    };
  },
  // ...
}
```

### 4. 首次部署

```bash
# 生产环境部署
npm run deploy

# 或使用开发模式（推荐用于测试）
npm run dev
```

部署过程大约需要 3-5 分钟。

### 5. 记录输出信息

部署成功后，您会看到类似以下输出：

```
✔  Deployed:
   ConanServerStack
   ApiEndpoint: https://abc123xyz.execute-api.ap-east-1.amazonaws.com
   PackagesBucketName: serverless-conan-conanpackages-abc123
   PackagesTableName: serverless-conan-conanpackagesmetadata-abc123
   UsersTableName: serverless-conan-conanusers-abc123
```

**请记录这些值，后续步骤需要使用！**

### 6. 初始化管理员用户

```bash
# 替换 <UsersTableName> 为实际的表名
USERS_TABLE_NAME=serverless-conan-conanusers-abc123 node scripts/init-users.ts
```

这将创建默认管理员账户：
- **用户名**: admin
- **密码**: admin123

### 7. 配置 Conan 客户端

在您的开发机器上：

```bash
# 添加远程仓库（替换 <ApiEndpoint> 为实际的 API 端点）
conan remote add my-serverless https://abc123xyz.execute-api.ap-east-1.amazonaws.com/v1

# 查看所有远程仓库
conan remote list

# 使用管理员账户登录
conan user admin -p admin123 -r my-serverless
```

### 8. 测试连接

```bash
# Ping 服务器
curl https://abc123xyz.execute-api.ap-east-1.amazonaws.com/v1/ping

# 应该返回
# {"status":"ok","version":"1.0.0"}
```

## 使用示例

### 创建并上传一个测试包

```bash
# 创建一个简单的 Conan 包
mkdir test-package && cd test-package

# 创建 conanfile.py
cat > conanfile.py << 'EOF'
from conan import ConanFile

class TestPackage(ConanFile):
    name = "hello"
    version = "1.0"
    
    def package_info(self):
        self.cpp_info.libs = ["hello"]
EOF

# 创建包
conan create . --user=mycompany --channel=stable

# 上传到 serverless server
conan upload "hello/1.0@mycompany/stable" -r my-serverless --all --confirm
```

### 搜索和下载包

```bash
# 搜索所有包
conan search "*" -r my-serverless

# 搜索特定包
conan search "hello*" -r my-serverless

# 下载到本地缓存
conan download hello/1.0@mycompany/stable -r my-serverless
```

## 更新部署

当您修改代码后，重新部署：

```bash
npm run deploy
```

SST 会自动检测变更并只更新修改的部分。

## 监控和日志

### 查看 Lambda 日志

```bash
# 使用 AWS CLI
aws logs tail /aws/lambda/serverless-conan-ConanServerStack-ConanApi --follow

# 或在 AWS 控制台
# CloudWatch > Log groups > /aws/lambda/serverless-conan-*
```

### 查看 API Gateway 日志

在 AWS 控制台：
1. 进入 API Gateway
2. 选择您的 API
3. Stages > Logs/Tracing

## 删除部署

如果需要完全删除所有资源：

```bash
npm run remove
```

⚠️ **警告**: 这将删除所有数据，包括 S3 中的包文件和 DynamoDB 中的元数据！

## 常见问题

### Q: 部署失败，提示 "Region not supported"

A: 某些 AWS 服务在特定区域不可用。尝试切换到 `us-east-1` 或 `us-west-2`。

### Q: Lambda 超时

A: 对于大文件，可能需要增加超时时间。在 `stacks/ConanServerStack.ts` 中：

```typescript
defaults: {
  function: {
    timeout: "60 seconds",
    memorySize: 1024,
  },
}
```

### Q: S3 上传失败

A: 检查 S3 存储桶的 CORS 配置是否正确。

### Q: 认证失败

A: 确保已正确初始化用户，并使用正确的用户名和密码。

### Q: 成本问题

A: 启用 AWS Cost Explorer 监控费用，设置预算警报。

## 生产环境建议

1. **启用自定义域名**: 使用友好的域名而不是 API Gateway 默认域名
2. **配置 SSL 证书**: 使用 ACM (AWS Certificate Manager)
3. **启用访问日志**: 记录所有 API 请求
4. **设置告警**: CloudWatch 告警监控错误率和延迟
5. **实施备份策略**: 定期备份 DynamoDB 数据
6. **密码加密**: 使用 bcrypt 或 AWS Secrets Manager
7. **启用 WAF**: 防止 DDoS 攻击
8. **配置 VPC**: 如需访问内部资源

## 性能优化

1. **启用 DynamoDB DAX**: 缓存热点数据
2. **CloudFront**: 添加 CDN 层加速全球访问
3. **Lambda 预留并发**: 避免冷启动
4. **S3 传输加速**: 加快跨区域上传

## 下一步

- 集成 CI/CD 流程
- 添加 Web UI 管理界面
- 实现包版本管理
- 添加使用统计和分析
- 实现多租户支持

如有问题，请查看 [AWS SST 文档](https://docs.sst.dev/) 或提交 Issue。
