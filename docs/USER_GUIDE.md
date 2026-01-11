# Serverless Conan Server 用户指南 📖

## 1. 项目简介
**Serverless Conan Server** 是一个专为 C++ 开发者设计的私人软件包仓库解决方案。不同于传统的 Artifactory 或 JFrog 方案，它完全运行在 AWS 的 Serverless 环境（Lambda、S3、DynamoDB）中。

### 核心亮点
- **零维护**: 无需管理操作系统、补丁或扩容。
- **极低成本**: 存储按 GB 计费，调用按次计费（100万次请求约 $0.20-3.50），非常适合中小团队。
- **高性能**: 结合 S3 的全球存储能力与 Lambda 的并发处理能力，上传下载无速度瓶颈。

---

## 2. 版本兼容性 (Conan Compatibility)

本项目对 Conan 的支持情况如下：

| 特性         | Conan 1.x (推荐) | Conan 2.x        |
| :----------- | :--------------- | :--------------- |
| **测试版本** | 1.66.0 (及以上)  | 2.0.x (基础可用) |
| **上传包**   | ✅ 完全支持       | ⚠️ 部分支持       |
| **下载包**   | ✅ 完全支持       | ⚠️ 基础模型支持   |
| **搜索包**   | ✅ 支持           | ✅ 支持           |
| **认证方式** | Token 认证       | Token 认证       |

**特别说明**: 在 Conan 1.x 环境下，我们解决了 "Binary package not found" 和二进制上传损坏的问题，确保了生产级别的稳定性。

---

## 3. 安装与部署教程

### 第一步：一键部署基础设施
在项目根目录下运行部署脚本：
```bash
./deploy.sh
```
**该脚本会自动执行：**
1. 安装所有 Node.js 依赖。
2. 通过 SST 将 Lambda、S3 和 DynamoDB 部署到 AWS `ap-east-1` 区域（默认）。
3. 自动在数据库中创建管理员账户：
   - **用户名**: `admin`
   - **默认密码**: `admin123`

### 第二步：配置本地 Conan 客户端
```bash
# 添加远程仓库 (将 <API_URL> 替换为部署后的 ApiEndpoint)
conan remote add my-server <API_URL>

# 登录
conan user admin -p admin123 -r my-server
```

---

## 4. 核心功能测试

我们提供了一个全流程自动化测试脚本，位于 `tests/run-conan1-demo.sh`。

**该脚本模拟了以下真实场景：**
1. 编译一个自定义的数学库 `mymath/1.0.0`。
2. 将其上传到部署好的 Serverless Server。
3. 清空本地缓存，强制 Conan 从云端仓库重新获取包。
4. 运行一个新的消费项目，链接并验证数学库。

**运行测试：**
```bash
./tests/run-conan1-demo.sh
```

---

## 5. 项目结构与维护

### 资源清理
如果你想销毁所有云端资源（省钱或重置环境），请运行：
```bash
./remove.sh
```
*注意：这会永久删除 S3 中存储的所有二进制包。*

### 项目文件说明
- `functions/`: 核心 Node.js 源码，处理 Conan 协议。
- `stacks/`: 定义 AWS 资源结构。
- `tests/`: 包含所有功能验证脚本。
- `deploy.sh`: 入口部署。
- `remove.sh`: 彻底清除。

### 故障排除
如果在上传大文件时遇到超时，请修改 `stacks/ConanServerStack.ts` 中的 `timeout` 设置。
如果遇到权限问题，请确保你的 `aws configure` 配置了具有 `AdministratorAccess` 或相应权限的 IAM 用户。
