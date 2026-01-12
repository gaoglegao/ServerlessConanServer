# Serverless Conan Server 🚀

这是一个基于 **AWS Serverless** 架构构建的高性能、低成本 C++ 包管理服务器。它旨在为团队提供一个轻量级、零维护成本的私人 Conan 仓库，完美解决了在 Serverless 环境下处理大型二进制包的复杂性。

---

## 🏗 项目概览

本项目利用 AWS 的原生云能力，实现了符合 Conan 协议的后端 API。

-   **计算层**: AWS Lambda + API Gateway (处理业务逻辑与 REST 路由)
-   **存储层**: Amazon S3 (托管 .tgz 包文件、配方文件等)
-   **数据层**: Amazon DynamoDB (存储包元数据、版本索引与用户权限)
-   **部署工具**: SST (Serverless Stack) - 提供极简的基础设施管理

---

## 🔥 核心优势

1.  **零固定成本**: 采用完全的按量计费模式。如果不使用,成本几乎为零；相比长期运行的 EC2 或 Artifactory 实例,可节省 90% 以上的费用。
2.  **极致易用**:
    *   `deploy.sh`: 一键部署,自动配置环境、数据库、存储桶和账户。
    *   `remove.sh`: 一键彻底销毁,不留任何残留资源。
3.  **针对 Conan 深入优化**:
    *   解决了 Serverless 环境下典型的**二进制数据损坏**问题（自动处理 Base64 编解码与流式上传）。
    *   修复了 Conan 客户端对 `package_snapshot` 校验的严格要求。
    *   实现了 **Token 化 URL 认证**,解决 Conan 1.x 上传时 Authorization 头部丢失的问题。
4.  **企业级权限管理**:
    *   **三种角色**: Admin (全权限)、Developer (可上传不可删除)、Viewer (只读)。
    *   **审计日志**: 所有包的上传、删除操作都会记录在 DynamoDB 中,而非依赖昂贵的 CloudWatch 长期存储。
    *   **成本优化**: CloudWatch 日志保留时间限制为 1 天,极大程度降低云端杂项支出。

---

## 🛠 兼容性说明 (重要)

*   **Conan 1.x (完美支持)**: 本项目针对 Conan 1.x 协议（推荐版本 **1.60.0及以上**）进行了深度适配,支持完整的上传、下载、搜索工作流。
*   **Conan 2.x (基础支持)**: 支持基本的 Ping 和 API 发现,但由于 2.x 的修订版本（Revisions）机制更复杂,目前建议在 Conan 1.x 环境下使用。

---

## 🚀 快速开始

### 1. 前置要求
*   安装了 [Node.js](https://nodejs.org/) (v18+)
*   配置了 [AWS CLI](https://aws.amazon.com/cli/) 凭证 (具有 AdministratorAccess 权限)
*   本地已安装 [Conan](https://conan.io/) 1.x

### 2. 配置环境变量
复制 `.env.example` 为 `.env` 并根据需要修改：
```bash
cp .env.example .env
# 编辑 .env 文件,设置您的管理员账号和 AWS 配置
```

### 3. 一键部署
```bash
chmod +x deploy.sh
./deploy.sh
```
部署完成后,请记录输出的 **API Endpoint** 和 **管理员凭证**。

### 4. 一键功能验证
项目包含一个完整的端到端演示脚本,它会自动创建一个测试包 -> 上传 -> 删除缓存 -> 下载 -> 本地编译：
```bash
# 不需要参数,脚本会自动发现刚部署的端点
./tests/run-conan1-demo.sh
```

### 5. 客户端配置
在你的开发机上执行：
```bash
# 添加远程仓库
conan remote add my-server <你的_API_ENDPOINT>

# 登录账户 (使用部署时设置的管理员账号)
conan user <管理员用户名> -p <管理员密码> -r my-server
```

### 6. 用户管理

**添加新用户**:
```bash
# 添加开发者
./add-user.sh developer_name password developer

# 添加只读用户
./add-user.sh viewer_name password viewer
```

**修改密码**:
```bash
./change-password.sh username new_password
```

**查看操作审计**:
```bash
./view-logs.sh
```

---

## 📂 项目结构

```text
.
├── functions/          # Lambda 业务逻辑 (TypeScript)
│   └── api.ts          # 路由处理器（支持文件流代理、身份验证、元数据管理）
├── stacks/             # 基础设施定义 (SST/CDK)
├── tests/              # 自动化演示与权限测试脚本
├── docs/               # 深入架构与配置文档
├── deploy.sh           # 自动化部署辅助脚本
├── remove.sh           # 自动化销毁脚本
├── add-user.sh         # 用户管理脚本
├── change-password.sh  # 密码修改脚本
├── view-logs.sh        # 审计日志查看脚本
└── sst.config.ts       # SST 核心配置文件
```

---

## 📚 详细文档

*   [用户指南](docs/USER_GUIDE.md) - 完整的使用说明和最佳实践
*   [权限管理指南](docs/PERMISSIONS_GUIDE.md) - 角色权限详解和审计机制

---

## 🧹 清理资源
如果你不再需要该服务器,请务必运行以下脚本以避免 S3 或 DynamoDB 的潜在残留计费：
```bash
./remove.sh
```

## 🛡️ 安全说明
*   本项目采用 SHA256 密码哈希和 Token 认证机制。
*   建议在生产环境通过 `.env` 文件设置强密码。
*   支持通过 SST 配置自定义域名和 HTTPS 证书。
*   所有敏感操作都会记录审计日志。

## 📝 License

MIT License - 详见 LICENSE 文件
