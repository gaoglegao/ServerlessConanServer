import serverless from "serverless-http";
import express, { Request, Response } from "express";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const app = express();


// AWS 客户端初始化
const s3 = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const PACKAGES_BUCKET = process.env.PACKAGES_BUCKET_NAME!;
const PACKAGES_TABLE = process.env.PACKAGES_TABLE_NAME!;
const USERS_TABLE = process.env.USERS_TABLE_NAME!;
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE_NAME!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;

// 辅助函数：生成包的唯一 ID
function getPackageId(name: string, version: string, user: string, channel: string): string {
    return `${name}/${version}@${user}/${channel}`;
}

// 辅助函数：从请求中提取认证信息
function extractAuth(req: Request): string | null {
    // 1. 优先从查询参数获取 (用于预签名 Proxy URL)
    if (req.query.auth_token) return req.query.auth_token as string;

    // 2. 从 Authorization 头部获取
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;

    if (authHeader.startsWith("Bearer ")) return authHeader.substring(7);
    if (authHeader.toLowerCase().startsWith("token ")) return authHeader.substring(6);
    return authHeader;
}

// 辅助函数：验证用户令牌并返回用户信息（用户名和角色）
async function verifyToken(token: string): Promise<{ username: string, role: string } | null> {
    if (!token) {
        console.log("No token provided");
        return null;
    }
    console.log(`Verifying token: ${token.substring(0, 5)}...`);

    try {
        const result = await dynamo.send(
            new QueryCommand({
                TableName: USERS_TABLE,
                IndexName: "tokenIndex",
                KeyConditionExpression: "#token = :token",
                ExpressionAttributeNames: { "#token": "token" },
                ExpressionAttributeValues: { ":token": token },
            })
        );

        if (result.Items && result.Items.length > 0) {
            const user = result.Items[0];
            console.log(`User found: ${user.username}, Role: ${user.role}`);
            return {
                username: user.username,
                role: user.role || "viewer"
            };
        }
        console.log("No user found for this token");
        return null;
    } catch (error) {
        console.error("Token verification error:", error);
        return null;
    }
}

// 辅助函数：记录审计日志到 DynamoDB
async function logAuditAction(username: string, action: string, details: string) {
    try {
        await dynamo.send(new PutCommand({
            TableName: AUDIT_LOGS_TABLE,
            Item: {
                logId: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                timestamp: Date.now(),
                action,
                username,
                details
            }
        }));
    } catch (error) {
        console.error("Failed to log audit action:", error);
    }
}


// ============ API 路由 ============

// 核心修复：重定向端点 (定义在 Body Parser 之前，避免大文件缓冲导致连接超时)
// 作用：接收客户端带着 Auth Header 的请求，验证后 307 重定向到 S3 预签名 URL。
app.all("/v1/files/redirect/*", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");

        // 鉴权失败
        if (!user) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const key = req.path.replace(/^\/v1\/files\/redirect\//, "");

        // 根据请求方法生成对应的 S3 预签名 URL
        let presignedUrl: string;
        if (req.method === "PUT") {
            // 上传鉴权：需要 admin 或 developer 权限
            if (user.role !== "admin" && user.role !== "developer") {
                return res.status(403).json({ error: "Forbidden: Upload access denied" });
            }
            presignedUrl = await getPresignedUploadUrl(PACKAGES_BUCKET, key);
        } else if (req.method === "GET" || req.method === "HEAD") {
            // 下载鉴权：读权限 (verifyToken 已通过)
            presignedUrl = await getPresignedDownloadUrl(PACKAGES_BUCKET, key);
        } else {
            return res.status(405).json({ error: "Method not allowed" });
        }

        // 使用 307 Temporary Redirect 保持 HTTP 方法 (PUT 仍是 PUT)
        // Express/Node 默认不会在 redirect 时去读 body，所以这会立即返回
        res.redirect(307, presignedUrl);
    } catch (error) {
        console.error("Redirect handler error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 全局中间件：Body Parsers (位置重要：必须在 redirect 路由之后)
app.use(express.json());
app.use(express.text());
// 处理二进制文件上传（如 .tgz 文件），限制提高到 200MB 兼容残留的代理请求
app.use(express.raw({ type: ["application/octet-stream", "application/gzip", "application/x-gzip", "application/x-tar", "application/x-tgz", "*/*"], limit: "200mb" }));

// Ping 端点
app.get("/v1/ping", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "1.0.0" });
});

// 添加 Conan 服务器标识头
app.use((_req, res, next) => {
    res.setHeader("X-Conan-Server-Capabilities", "checksum_deploy");
    next();
});

app.get("/v2/ping", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "2.0.0" });
});

// Basic Auth 解析
function parseBasicAuth(req: Request): { username?: string; password?: string } | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Basic ")) {
        try {
            const base64 = authHeader.substring(6);
            const decoded = Buffer.from(base64, "base64").toString("utf-8");
            const parts = decoded.split(":");
            return { username: parts[0], password: parts.slice(1).join(":") };
        } catch (e) {
            return null;
        }
    }
    return null;
}

// 通用认证处理逻辑
async function handleAuthentication(username: string, password: string, res: Response) {
    try {
        // 获取用户信息
        const result = await dynamo.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { username },
            })
        );

        const user = result.Item;
        const passwordHash = crypto.createHash("sha256").update(password).digest("hex");

        if (user && (user.passwordHash === passwordHash || user.password === password)) {
            // 生成新 token (使用简单的随机字符串模拟 JWT)
            // 在实际 JWT 实现中，这里会签名一个 payload
            const token = crypto.randomBytes(32).toString("hex");

            // 更新用户令牌
            await dynamo.send(
                new PutCommand({
                    TableName: USERS_TABLE,
                    Item: {
                        ...user,
                        token,
                        lastLogin: Date.now(),
                    },
                })
            );

            // Conan 1.x 期望直接返回 token 字符串
            res.send(token);
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (error) {
        console.error("Authentication error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}

// 用户认证 (Basic Auth for GET)
app.get("/v1/users/authenticate", async (req: Request, res: Response) => {
    const creds = parseBasicAuth(req);
    if (!creds || !creds.username || !creds.password) {
        return res.status(401).json({ error: "Missing Basic Auth" });
    }
    await handleAuthentication(creds.username, creds.password, res);
});

// 用户认证 (JSON Body for POST)
app.post("/v1/users/authenticate", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Missing username or password" });
    }
    // 注意：POST 返回可能是 json 对象
    // 但为了兼容，我们复用逻辑。Conan 2.x 一般用 login 命令。
    // Conan 1.x client.py authenticate() 会处理 response

    // 复用上面的逻辑，但这里我们可能需要稍微调整以返回 JSON 对象 { token: ... } 还是纯 string
    // Conan 1.x 似乎期望直接是 token。

    // 如果是 POST，我们按照我们之前的实现返回 JSON
    try {
        // 获取用户信息
        const result = await dynamo.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { username },
            })
        );

        const user = result.Item;
        const passwordHash = crypto.createHash("sha256").update(password).digest("hex");

        if (user && user.passwordHash === passwordHash) {
            const token = crypto.randomBytes(32).toString("hex");
            await dynamo.send(
                new PutCommand({
                    TableName: USERS_TABLE,
                    Item: {
                        ...user,
                        token,
                        lastLogin: Date.now(),
                    },
                })
            );
            res.json({ token });
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (error) {
        console.error("Authentication error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 检查凭证 (支持 GET 和 POST)
app.all("/v1/users/check_credentials", async (req: Request, res: Response) => {
    const token = extractAuth(req);
    const isValid = await verifyToken(token || "");

    if (isValid) {
        res.json({ status: "ok" });
    } else {
        res.status(401).json({ error: "Invalid token" });
    }
});

// 搜索包
const searchHandler = async (req: Request, res: Response) => {
    try {
        const pattern = (req.query.q as string) || "*";

        // 扫描所有包（实际生产环境建议使用更高效的搜索方案）
        const result = await dynamo.send(
            new ScanCommand({
                TableName: PACKAGES_TABLE,
            })
        );

        const packages = result.Items || [];

        // 简单的模式匹配
        const filtered =
            pattern === "*"
                ? packages
                : packages.filter((pkg) => pkg.packageName.includes(pattern.replace(/\*/g, "")));

        const results = filtered.map((pkg) => pkg.packageId);

        res.json({ results });
    } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

app.get("/v1/conans/search", searchHandler);
// 兼容 Conan v2 搜索
app.get("/v2/conans/search", searchHandler);
// 兼容可能的根路径搜索请求
app.get("/search", searchHandler);

// 获取包信息
app.get("/v1/conans/:name/:version/:user/:channel", async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel } = req.params as { name: string; version: string; user: string; channel: string };
        const packageId = getPackageId(name, version, user, channel);

        const result = await dynamo.send(
            new GetCommand({
                TableName: PACKAGES_TABLE,
                Key: { packageId },
            })
        );

        if (result.Item) {
            res.json(result.Item);
        } else {
            res.status(404).json({ error: "Package not found" });
        }
    } catch (error) {
        console.error("Get package error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 获取包的二进制包列表
app.get("/v1/conans/:name/:version/:user/:channel/packages", async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel } = req.params as { name: string; version: string; user: string; channel: string };
        const packageId = getPackageId(name, version, user, channel);

        const result = await dynamo.send(
            new GetCommand({
                TableName: PACKAGES_TABLE,
                Key: { packageId },
            })
        );

        if (result.Item && result.Item.packages) {
            res.json(result.Item.packages);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error("Get packages error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 获取单个二进制包的 snapshot（文件哈希映射）
// Conan 1.x 的 package_snapshot 接口，返回 {filename: md5hash} 格式
app.get("/v1/conans/:name/:version/:user/:channel/packages/:binPackageId", async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel, binPackageId } = req.params as {
            name: string;
            version: string;
            user: string;
            channel: string;
            binPackageId: string;
        };
        const packageId = getPackageId(name, version, user, channel);

        const result = await dynamo.send(
            new GetCommand({
                TableName: PACKAGES_TABLE,
                Key: { packageId },
            })
        );

        if (result.Item && result.Item.packages && result.Item.packages[binPackageId]) {
            // 从 S3 读取 conanmanifest.txt 并解析哈希
            const manifestKey = `${packageId}/package/${binPackageId}/conanmanifest.txt`;
            try {
                const s3Result = await s3.send(new GetObjectCommand({
                    Bucket: PACKAGES_BUCKET,
                    Key: manifestKey
                }));

                if (s3Result.Body) {
                    const content = await s3Result.Body.transformToString();
                    // conanmanifest.txt 格式: 第一行是时间戳，后面是 filename: hash
                    const lines = content.trim().split('\n');
                    const snapshot: Record<string, string> = {};

                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split(': ');
                        if (parts.length >= 2) {
                            snapshot[parts[0].trim()] = parts[1].trim();
                        }
                    }

                    // Conan 要求 snapshot 必须包含 conaninfo, conanmanifest, conan_package 这三个关键字
                    // conanmanifest.txt 自身不在 manifest 内容中，需要额外添加
                    // 使用占位符哈希，因为客户端主要是检查文件是否存在
                    if (!snapshot["conanmanifest.txt"]) {
                        snapshot["conanmanifest.txt"] = "0";
                    }
                    if (!snapshot["conan_package.tgz"]) {
                        snapshot["conan_package.tgz"] = "0";
                    }

                    res.json(snapshot);
                } else {
                    // 如果没有 manifest，返回空对象表示包存在但无法验证
                    res.json({});
                }
            } catch (e) {
                console.error("Error reading conanmanifest.txt:", e);
                // 如果读取失败，返回空 snapshot
                res.json({});
            }
        } else {
            res.status(404).json({ error: "Binary package not found" });
        }
    } catch (error) {
        console.error("Get binary package snapshot error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 辅助函数：生成预签名 Upload URL (PUT)
async function getPresignedUploadUrl(bucket: string, key: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: bucket, Key: key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    if (CLOUDFRONT_DOMAIN) {
        // 使用 CloudFront 域名替换 S3 域名
        // 这样客户端发送请求到 CloudFront，CloudFront 会剥离 Auth Header 再转发给 S3
        // S3 只验证签名（签名是针对 S3 原始域名的，但只要 Host Header 被 CloudFront 还原为 S3 域名，验证通过）
        return signedUrl.replace(/https:\/\/[^/]+/, `https://${CLOUDFRONT_DOMAIN}`);
    }
    return signedUrl;
}

// 辅助函数：生成预签名 Download URL (GET)
async function getPresignedDownloadUrl(bucket: string, key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    if (CLOUDFRONT_DOMAIN) {
        return signedUrl.replace(/https:\/\/[^/]+/, `https://${CLOUDFRONT_DOMAIN}`);
    }
    return signedUrl;
}





// 获取上传 URL (Recipe)
app.post("/v1/conans/:name/:version/:user/:channel/upload_urls", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");
        if (!user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (user.role !== "admin" && user.role !== "developer") {
            return res.status(403).json({ error: "Forbidden: Admin or Developer role required for uploads" });
        }

        const { name, version, user: c_user, channel } = req.params as { name: string; version: string; user: string; channel: string };
        const packageId = getPackageId(name, version, c_user, channel);

        const body = req.body || {};
        const files = Array.isArray(body.files) ? body.files : Object.keys(body).filter(k => typeof body[k] === 'number' || typeof body[k] === 'string');

        const uploadUrls: Record<string, string> = {};

        for (const file of files) {
            const key = `${packageId}/${file}`;
            uploadUrls[file] = await getPresignedUploadUrl(PACKAGES_BUCKET, key);
        }

        // 更新包元数据 (Recipe)
        await dynamo.send(
            new PutCommand({
                TableName: PACKAGES_TABLE,
                Item: {
                    packageId,
                    packageName: name,
                    version,
                    user: c_user,
                    channel,
                    timestamp: Date.now(),
                    files,
                },
            })
        );

        // 记录审计日志
        await logAuditAction(user.username, "UPLOAD_RECIPE", `Uploaded recipe for ${packageId}`);

        res.json(uploadUrls);
    } catch (error) {
        console.error("Upload URLs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 获取二进制包上传 URL
app.post("/v1/conans/:name/:version/:user/:channel/packages/:binPackageId/upload_urls", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");
        if (!user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (user.role !== "admin" && user.role !== "developer") {
            return res.status(403).json({ error: "Forbidden: Admin or Developer role required for uploads" });
        }

        const { name, version, user: c_user, channel, binPackageId } = req.params as {
            name: string;
            version: string;
            user: string;
            channel: string;
            binPackageId: string;
        };
        const packageId = getPackageId(name, version, c_user, channel);

        const body = req.body || {};
        const files = Array.isArray(body.files) ? body.files : Object.keys(body).filter(k => typeof body[k] === 'number' || typeof body[k] === 'string' || k !== 'packageId');

        const uploadUrls: Record<string, string> = {};

        for (const file of files) {
            const key = `${packageId}/package/${binPackageId}/${file}`;
            uploadUrls[file] = await getPresignedUploadUrl(PACKAGES_BUCKET, key);
        }

        // 更新包元数据，记录此二进制包存在及其配置
        try {
            const result = await dynamo.send(new GetCommand({ TableName: PACKAGES_TABLE, Key: { packageId } }));
            const item = result.Item || { packageId, packageName: name, version, user: c_user, channel, packages: {} };
            if (!item.packages) item.packages = {};

            // 存储该二进制包的配置信息，供 Conan 客户端匹配使用
            item.packages[binPackageId] = {
                settings: body.settings || {},
                options: body.options || {}
            };

            await dynamo.send(new PutCommand({
                TableName: PACKAGES_TABLE,
                Item: item
            }));

            // 记录审计日志
            await logAuditAction(user.username, "UPLOAD_PACKAGE", `Uploaded binary package ${binPackageId} for ${packageId}`);
        } catch (e) {
            console.error("Update metadata error:", e);
        }

        res.json(uploadUrls);
    } catch (error) {
        console.error("Package Upload URLs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 获取下载 URL
app.get("/v1/conans/:name/:version/:user/:channel/download_urls", async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel } = req.params as { name: string; version: string; user: string; channel: string };
        const packageId = getPackageId(name, version, user, channel);

        const result = await dynamo.send(
            new GetCommand({
                TableName: PACKAGES_TABLE,
                Key: { packageId },
            })
        );

        if (!result.Item) {
            return res.status(404).json({ error: "Package not found" });
        }

        const downloadUrls: Record<string, string> = {};
        const files = result.Item.files || [];

        for (const file of files) {
            const key = `${packageId}/${file}`;
            downloadUrls[file] = await getPresignedDownloadUrl(PACKAGES_BUCKET, key);
        }

        res.json(downloadUrls);
    } catch (error) {
        console.error("Download URLs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 获取二进制包下载 URL
app.get("/v1/conans/:name/:version/:user/:channel/packages/:packageId/download_urls", async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel, packageId: binPackageId } = req.params as {
            name: string;
            version: string;
            user: string;
            channel: string;
            packageId: string;
        };
        const packageId = getPackageId(name, version, user, channel);

        // 我们这里假定二进制包包含固定的几个文件：conan_package.tgz, conaninfo.txt, conanmanifest.txt
        const files = ["conan_package.tgz", "conaninfo.txt", "conanmanifest.txt"];
        const downloadUrls: Record<string, string> = {};

        for (const file of files) {
            const key = `${packageId}/package/${binPackageId}/${file}`;
            downloadUrls[file] = await getPresignedDownloadUrl(PACKAGES_BUCKET, key);
        }

        res.json(downloadUrls);
    } catch (error) {
        console.error("Package Download URLs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 文件代理 - 下载 (GET)
app.get("/v1/files/*", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        const key = req.path.replace(/^\/v1\/files\//, "");
        const command = new GetObjectCommand({ Bucket: PACKAGES_BUCKET, Key: key });
        const result = await s3.send(command);

        if (result.Body) {
            res.setHeader("Content-Type", result.ContentType || "application/octet-stream");
            // @ts-ignore
            result.Body.pipe(res);
        } else {
            res.status(404).send("File not found");
        }
    } catch (e) {
        res.status(404).send("File not found");
    }
});

// 文件代理 - 上传 (PUT)
app.put("/v1/files/*", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");

        if (!user || (user.role !== "admin" && user.role !== "developer")) {
            return res.status(403).json({ error: "Forbidden: Upload access denied" });
        }

        const key = req.path.replace(/^\/v1\/files\//, "");

        // 转换 body 为 Buffer
        let body: Buffer;
        if (Buffer.isBuffer(req.body)) {
            body = req.body;
        } else {
            body = Buffer.from(req.body);
        }

        await s3.send(new PutObjectCommand({
            Bucket: PACKAGES_BUCKET,
            Key: key,
            Body: body,
            ContentType: req.headers["content-type"] as string || "application/octet-stream"
        }));
        res.send("OK");
    } catch (error) {
        console.error("File upload error:", error);
        res.status(500).send("Upload failed");
    }
});

// 处理删除全包 (DELETE)
app.delete("/v1/conans/:name/:version/:user/:channel", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");
        if (user && user.role === "admin") {
            const { name, version, user: c_user, channel } = req.params as Record<string, string>;
            const packageId = getPackageId(name, version, c_user, channel);
            await logAuditAction(user.username, "DELETE_PACKAGE", `Deleted package ${packageId}`);
            res.json({ status: "ok" });
        } else {
            res.status(403).json({ error: "Forbidden: Admin required for deletion" });
        }
    } catch (e) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 删除包中的文件 (Conan 1.x 上传流程一部分)
app.post("/v1/conans/:name/:version/:user/:channel/remove_files", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");
        if (user && (user.role === "admin" || user.role === "developer")) {
            const { name, version, user: c_user, channel } = req.params as Record<string, string>;
            await logAuditAction(user.username, "REMOVE_FILES", `Removed recipe files for ${name}/${version}@${c_user}/${channel}`);
        } else if (user) {
            return res.status(403).json({ error: "Forbidden: Admin or Developer role required" });
        }
    } catch (e) { }
    res.json({ status: "ok" });
});

app.post("/v1/conans/:name/:version/:user/:channel/packages/:binPackageId/remove_files", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        const user = await verifyToken(token || "");
        if (user && (user.role === "admin" || user.role === "developer")) {
            const { name, version, user: c_user, channel, binPackageId } = req.params as Record<string, string>;
            await logAuditAction(user.username, "REMOVE_PACKAGE_FILES", `Removed binary files for ${name}/${version}@${c_user}/${channel} (Package: ${binPackageId})`);
        } else if (user) {
            return res.status(403).json({ error: "Forbidden: Admin or Developer role required" });
        }
    } catch (e) { }
    res.json({ status: "ok" });
});

// 获取包的 digest（用于检查更新）
// Conan 1.x 上传时会调用此接口
app.get("/v1/conans/:name/:version/:user/:channel/digest", async (req: Request, res: Response) => {
    // 改回 404，这是"包不存在"的标准信号
    res.status(404).json({ error: "Package not found" });
});

// 默认处理器
app.use((req: Request, res: Response) => {
    console.log(`Unhandled route: ${req.method} ${req.path}`);
    res.status(404).json({
        error: "Route not found",
        method: req.method,
        path: req.path,
    });
});

export const handler = serverless(app, {
    binary: ["application/octet-stream", "application/gzip", "application/x-gzip", "application/x-tar", "application/x-tgz", "*/*"]
});
