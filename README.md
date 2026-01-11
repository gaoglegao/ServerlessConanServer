# Serverless Conan Server

一个基于 AWS Lambda、API Gateway、S3 和 DynamoDB 的 serverless Conan 包管理服务器。

## 架构

- **AWS Lambda + API Gateway**: 处理所有 Conan API 请求
- **Amazon S3**: 存储 Conan 包文件（.tgz、conanfile.py 等）
- **Amazon DynamoDB**: 存储包元数据和用户信息
- **SST Framework**: 基础设施即代码，简化部署

## 功能特性

✅ 完全兼容 Conan 客户端
✅ 支持包上传和下载
✅ 支持包搜索
✅ 用户认证和授权
✅ Serverless 架构，按需扩展
✅ 低成本运营

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 AWS 凭证

确保您已经配置了 AWS CLI 凭证：

```bash
aws configure
```

### 3. 部署到 AWS

```bash
# 开发环境部署（带热重载）
npm run dev

# 生产环境部署
npm run deploy
```

部署完成后，您会看到类似以下的输出：

```
✔  Deployed:
   ConanServerStack
   ApiEndpoint: https://xxxxx.execute-api.ap-east-1.amazonaws.com
   PackagesBucketName: serverless-conan-conanpackages-xxxxx
   PackagesTableName: serverless-conan-conanpackagesmetadata-xxxxx
   UsersTableName: serverless-conan-conanusers-xxxxx
```

### 4. 初始化默认用户

部署完成后，需要初始化一个默认管理员用户：

```bash
USERS_TABLE_NAME=<你的 UsersTableName> node scripts/init-users.ts
```

这将创建一个默认用户：
- Username: `admin`
- Password: `admin123`

⚠️ **请在首次登录后立即修改密码！**

### 5. 配置 Conan 客户端

在您的本地机器上配置 Conan 使用这个 serverless server：

```bash
# 添加远程仓库
conan remote add serverless-conan <你的 ApiEndpoint>/v1

# 认证（如果需要）
conan user admin -p admin123 -r serverless-conan
```

### 6. 使用示例

#### 上传包

```bash
# 在您的 Conan 项目目录中
conan create . demo/testing

# 上传到 serverless server
conan upload "*" -r serverless-conan --all
```

#### 下载包

```bash
# 搜索包
conan search "*" -r serverless-conan

# 安装包
conan install mylib/1.0@demo/testing -r serverless-conan
```

## 项目结构

```
serverlessConan/
├── functions/          # Lambda 函数代码
│   └── api.ts         # 主 API 处理器
├── stacks/            # SST 堆栈定义
│   └── ConanServerStack.ts
├── scripts/           # 工具脚本
│   └── init-users.ts  # 用户初始化脚本
├── sst.config.ts      # SST 配置
├── package.json
└── README.md
```

## API 端点

### Conan v1 API

- `GET /v1/ping` - 健康检查
- `GET /v1/conans/search` - 搜索包
- `GET /v1/conans/{name}/{version}/{user}/{channel}` - 获取包信息
- `GET /v1/conans/{name}/{version}/{user}/{channel}/packages` - 获取二进制包列表
- `POST /v1/conans/{name}/{version}/{user}/{channel}/upload_urls` - 获取上传 URL
- `GET /v1/conans/{name}/{version}/{user}/{channel}/download_urls` - 获取下载 URL
- `POST /v1/users/authenticate` - 用户认证
- `POST /v1/users/check_credentials` - 检查凭证

## 成本估算

使用 serverless 架构的优势是按使用量付费：

- **API Gateway**: $3.50 per million requests
- **Lambda**: 前 100 万次请求免费，之后 $0.20 per million requests
- **S3**: $0.023 per GB/month (首 50TB)
- **DynamoDB**: 按需定价，读写请求收费

对于小型团队（< 1000 次请求/天），每月成本约 **$1-5**。

## 开发

### 本地开发

SST 提供了出色的本地开发体验：

```bash
npm run dev
```

这将启动 SST 的 Live Lambda 开发环境，任何代码更改都会立即反映，无需重新部署。

### 移除部署

```bash
npm run remove
```

## 安全建议

1. **启用 API 密钥**: 在 API Gateway 中启用 API 密钥验证
2. **使用密码哈希**: 当前实现使用明文密码，生产环境应使用 bcrypt
3. **启用 CloudFront**: 添加 CDN 层以提高性能和安全性
4. **配置 CORS**: 根据需要限制 CORS 策略
5. **启用日志**: 配置 CloudWatch 日志进行监控

## 高级配置

### 自定义域名

在 `stacks/ConanServerStack.ts` 中添加：

```typescript
const api = new Api(stack, "ConanApi", {
  customDomain: {
    domainName: "conan.yourdomain.com",
    hostedZone: "yourdomain.com",
  },
  // ...
});
```

### 增加存储限制

修改 S3 存储桶配置以添加生命周期策略：

```typescript
const packagesBucket = new Bucket(stack, "ConanPackages", {
  cdk: {
    bucket: {
      lifecycleRules: [{
        expiration: Duration.days(365),
        transitions: [{
          storageClass: StorageClass.GLACIER,
          transitionAfter: Duration.days(90),
        }],
      }],
    },
  },
});
```

## 故障排除

### Lambda 超时

如果遇到大文件上传超时，可以增加 Lambda 超时时间：

```typescript
defaults: {
  function: {
    timeout: "30 seconds", // 默认是 10 秒
  },
}
```

### DynamoDB 限流

如果遇到读写容量限制，可以增加表的容量或启用按需计费。

## 贡献

欢迎提交 Issue 和 Pull Request！

## License

MIT
