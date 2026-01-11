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

1.  **零固定成本**: 采用完全的按量计费模式。如果不使用，成本几乎为零；相比长期运行的 EC2 或 Artifactory 实例，可节省 90% 以上的费用。
2.  **极致易用**:
    *   `deploy.sh`: 一键部署，自动配置环境、数据库、存储桶和账户。
    *   `remove.sh`: 一键彻底销毁，不留任何残留资源。
3.  **针对 Conan 深入优化**:
    *   解决了 Serverless 环境下典型的**二进制数据损坏**问题（自动处理 Base64 编解码与流式上传）。
    *   修复了 Conan 客户端对 `package_snapshot` 校验的严格要求。
4.  **高可用与自动缩放**: 天然具备多可用区容灾能力，能够自动应对并发请求，无需担心服务器宕机或带宽瓶颈。

---

## 🛠 兼容性说明 (重要)

*   **Conan 1.x (完美支持)**: 本项目针对 Conan 1.x 协议（推荐版本 **1.60.0及以上**，演示测试使用的是 **1.66.0**）进行了深度适配，支持完整的上传、下载、搜索工作流。
*   **Conan 2.x (基础支持)**: 支持基本的 Ping 和 API 发现，但由于 2.x 的修订版本（Revisions）机制更复杂，目前建议在 Conan 1.x 环境下使用。

---

## 🚀 快速开始

### 1. 前置要求
*   安装了 [Node.js](https://nodejs.org/) (v18+)
*   配置了 [AWS CLI](https://aws.amazon.com/cli/) 凭证 (具有 AdministratorAccess 权限)
*   本地已安装 [Conan](https://conan.io/) 1.x

### 2. 一键部署
```bash
chmod +x deploy.sh
./deploy.sh
```
部署完成后，请记录输出的 **API Endpoint** 和 **管理员密码**（默认：`admin` / `admin123`）。

### 3. 一键功能验证
项目包含一个完整的端到端演示脚本，它会自动创建一个测试包 -> 上传 -> 删除缓存 -> 下载 -> 本地编译：
```bash
# 不需要参数，脚本会自动发现刚部署的端点
./tests/run-conan1-demo.sh
```

### 4. 客户端配置
在你的开发机上执行：
```bash
# 添加远程仓库
conan remote add my-server <你的_API_ENDPOINT>

# 登录账户
conan user admin -p admin123 -r my-server
```

---

## 📂 项目结构

```text
.
├── functions/          # Lambda 业务逻辑 (TypeScript)
│   └── api.ts          # 路由处理器（支持文件流代理、身份验证、元数据管理）
├── stacks/             # 基础设施定义 (SST/CDK)
├── tests/              # 自动化演示脚本
├── deploy.sh           # 自动化部署辅助脚本
├── remove.sh           # 自动化销毁脚本
├── docs/               # 深入架构与配置文档
└── sst.config.ts       # SST 核心配置文件
```

---

## 🧹 清理资源
如果你不再需要该服务器，请务必运行以下脚本以避免 S3 或 DynamoDB 的潜在残留计费：
```bash
./remove.sh
```

## 🛡️ 安全限制
*   本项目目前为演示与私有团队协作设计，身份验证采用 SHA256 哈希匹配。
*   默认不启用 HTTPS 证书绑定，建议在生产环境通过 SST 配置自定义域名。
