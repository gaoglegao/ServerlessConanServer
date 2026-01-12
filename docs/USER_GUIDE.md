# Serverless Conan Server 用户指南 📖

## 1. 项目简介
**Serverless Conan Server** 是一个专为 C++ 开发者设计的私人软件包仓库解决方案。不同于传统的 Artifactory 或 JFrog 方案，它完全运行在 AWS 的 Serverless 环境（Lambda、S3、DynamoDB）中。

### 核心亮点
- **零维护**: 无需管理操作系统、补丁或扩容。
- **极低成本**: 存储按 GB 计费，调用按次计费（100万次请求约 $0.20-3.50），非常适合中小团队。
- **高性能**: 结合 S3 的全球存储能力与 Lambda 的并发处理能力，上传下载无速度瓶颈。
- **企业级权限**: 支持三种角色（Admin/Developer/Viewer）和完整的审计日志。

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

### 第一步：配置环境变量
复制 `.env.example` 为 `.env` 并根据需要修改：
```bash
cp .env.example .env
```

编辑 `.env` 文件，设置您的配置：
```bash
# 管理员账号（建议修改为强密码）
CONAN_ADMIN_USER=admin
CONAN_ADMIN_PASS=your_strong_password_here

# AWS 配置
AWS_PROFILE=your_aws_profile
AWS_REGION=ap-east-1
```

### 第二步：一键部署基础设施
在项目根目录下运行部署脚本：
```bash
./deploy.sh
```

**该脚本会自动执行：**
1. 安装所有 Node.js 依赖。
2. 从 `.env` 读取配置。
3. 通过 SST 将 Lambda、S3 和 DynamoDB 部署到指定的 AWS 区域。
4. 自动在数据库中创建管理员账户（使用 `.env` 中配置的凭证）。

部署完成后，请记录输出的 **API Endpoint**。

### 第三步：配置本地 Conan 客户端
```bash
# 添加远程仓库 (将 <API_URL> 替换为部署后的 ApiEndpoint)
conan remote add my-server <API_URL>

# 登录（使用 .env 中设置的管理员凭证）
conan user <your_admin_user> -p <your_admin_pass> -r my-server
```

---

## 4. 用户角色与权限管理

服务器内置了三层权限模型，确保团队协作的安全性：

| 角色          | 查看/下载 | 上传包 | 删除包 | 说明                               |
| :------------ | :-------: | :----: | :----: | :--------------------------------- |
| **admin**     |     ✅     |   ✅    |   ✅    | 超级管理员，拥有所有权利。         |
| **developer** |     ✅     |   ✅    |   ❌    | 开发人员，可以提交包，但不能删除。 |
| **viewer**    |     ✅     |   ❌    |   ❌    | 只读人员，仅用于拉取和同步包。     |

### 用户管理操作

#### 创建新用户
使用根目录下的 `add-user.sh` 脚本：
```bash
# 创建一个开发员账号
./add-user.sh developer_name password developer

# 创建一个只读账号
./add-user.sh viewer_name password viewer

# 创建管理员账号（会自动同步到 .env）
./add-user.sh new_admin password admin
```

#### 修改用户密码
```bash
# 修改任意用户密码
./change-password.sh username new_password

# 修改管理员密码（会自动同步到 .env）
./change-password.sh admin new_strong_password
```

#### 查看审计日志
所有的写操作（上传、删除）都会记录在 **Audit Logs** 中：
```bash
./view-logs.sh
```

---

## 5. 核心功能测试

### 完整流程测试
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

### 权限测试
验证不同角色的权限是否正确配置：
```bash
./tests/test-permissions.sh
```

---

## 6. 日常使用

### 上传包到服务器
```bash
# 创建包
conan create . user/channel

# 上传到服务器
conan upload package_name/version@user/channel -r my-server --all
```

### 从服务器下载包
```bash
# 安装依赖
conan install package_name/version@user/channel -r my-server
```

### 搜索包
```bash
# 搜索所有包
conan search "*" -r my-server

# 搜索特定包
conan search "package_name/*" -r my-server
```

---

## 7. 项目结构与维护

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
- `docs/`: 详细文档。
- `deploy.sh`: 入口部署。
- `remove.sh`: 彻底清除。
- `add-user.sh`: 用户管理。
- `change-password.sh`: 密码修改。
- `view-logs.sh`: 审计日志查看。

### 故障排除

**上传大文件超时**:
修改 `stacks/ConanServerStack.ts` 中的 `timeout` 设置。

**权限问题**:
确保你的 `aws configure` 配置了具有 `AdministratorAccess` 或相应权限的 IAM 用户。

**Token 认证失败**:
检查 `.env` 文件中的管理员凭证是否与数据库中的一致。

---

## 8. 安全最佳实践

1. **立即修改默认密码**: 部署后第一时间修改管理员密码。
2. **使用强密码**: 为所有用户设置复杂密码。
3. **定期审计**: 定期查看审计日志，监控异常操作。
4. **最小权限原则**: 为团队成员分配最小必要权限。
5. **备份重要包**: 定期备份 S3 中的关键包文件。

---

## 9. 成本优化建议

- **CloudWatch 日志**: 已自动设置为 1 天保留期，降低存储成本。
- **S3 生命周期**: 可配置 S3 生命周期策略，自动归档或删除旧版本包。
- **DynamoDB**: 使用按需计费模式，无需预留容量。
- **Lambda**: 优化函数内存配置，平衡性能与成本。

---

更多详细信息，请参考 [权限管理指南](PERMISSIONS_GUIDE.md)。
