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


async function getFileSnapshot(packageId: string, binPackageId?: string): Promise<Record<string, string>> {
    const key = binPackageId
        ? `${packageId}/package/${binPackageId}/conanmanifest.txt`
        : `${packageId}/conanmanifest.txt`;

    try {
        const s3Result = await s3.send(new GetObjectCommand({
            Bucket: PACKAGES_BUCKET,
            Key: key
        }));
        if (s3Result.Body) {
            const content = await s3Result.Body.transformToString();
            const lines = content.trim().split('\n');
            const snapshot: Record<string, string> = {};
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(': ');
                if (parts.length >= 2) {
                    snapshot[parts[0].trim()] = parts[1].trim();
                }
            }
            // 补充自身 manifest
            if (!snapshot["conanmanifest.txt"]) snapshot["conanmanifest.txt"] = "0";
            return snapshot;
        }
    } catch (e) {
        // console.error(`Snapshot read fail for ${key}`);
    }
    // 默认兜底
    return binPackageId
        ? { "conan_package.tgz": "0", "conaninfo.txt": "0", "conanmanifest.txt": "0" }
        : { "conanfile.py": "0", "conanmanifest.txt": "0" };
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

app.use((_req, res, next) => {
    // 明确声明支持 revisions
    res.setHeader("X-Conan-Server-Capabilities", "revisions");
    next();
});

// Ping 端点

app.get("/v1/ping", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "1.0.0" });
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
        const filtered = packages.filter((pkg) => {
            if (pattern === "*") return true;
            const purePattern = pattern.replace(/\*/g, "");
            // 无论是包名包含模式，还是模式包含包名（全路径匹配），或者是 packageId 匹配
            return pkg.packageName.includes(purePattern) ||
                purePattern.includes(pkg.packageName) ||
                pkg.packageId === pattern;
        });



        const results = filtered.map((pkg) => pkg.packageId);

        res.json({ results });
    } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

app.get("/v1/conans/search", searchHandler);
// 兼容 Conan v2 搜索 (Conan 2.x 请求 /v2/conans)
app.get("/v2/conans", searchHandler);
app.get("/v2/conans/search", searchHandler);
// 兼容可能的根路径搜索请求
app.get("/search", searchHandler);

// 搜索二进制包 (Conan 1.x & 2.x)
const binarySearchHandler = async (req: Request, res: Response) => {
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
            // Conan 1.x /search 会返回 { package_id: { settings, options } }
            // 而 Conan 2.x 期望格式可能不同，但通常返回这个字典也能工作
            res.json(result.Item.packages);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error("Binary search error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// --- Conan Discovery & Metadata (V1 & V2) ---

// 1. 最新修订版 (Latest Revision) - 优先级最高，避免被基础包路径截获
app.get([
    "/v1/conans/:name/:version/:user/:channel/latest",
    "/v1/conans/:name/:version/:user/:channel/revisions/latest",
    "/v2/conans/:name/:version/:user/:channel/latest",
    "/v2/conans/:name/:version/:user/:channel/revisions/latest"
], (req, res) => {
    res.json({
        revision: "0",
        time: Math.floor(Date.now() / 1000)
    });
});

// 2. 二进制包最新修订版
app.get([
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/latest",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/latest",
    "/v1/conans/:name/:version/:user/:channel/packages/:binPackageId/revisions/latest",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/latest",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/latest"
], (req, res) => {
    res.json({
        revision: "0",
        time: Math.floor(Date.now() / 1000)
    });
});


// 3. 修订版列表 (Revisions List)
const getDynamicNow = () => Math.floor(Date.now() / 1000);

app.get([
    "/v1/conans/:name/:version/:user/:channel/revisions",
    "/v2/conans/:name/:version/:user/:channel/revisions"
], (req, res) => {
    res.json({
        revisions: [{ revision: "0", time: Math.floor(Date.now() / 1000) }]
    });
});

app.get([
    "/v1/conans/:name/:version/:user/:channel/packages/:binPackageId/revisions",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions"
], (req, res) => {
    res.json({
        revisions: [{ revision: "0", time: Math.floor(Date.now() / 1000) }]
    });
});




// 4. 二进制包搜索 (Search Binary Packages)
app.get([
    "/v1/conans/:name/:version/:user/:channel/search",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/search",
    "/v2/conans/:name/:version/:user/:channel/search",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/search"
], binarySearchHandler);



// 获取包信息
app.get([
    "/v1/conans/:name/:version/:user/:channel",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev",
    "/v2/conans/:name/:version/:user/:channel",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev"
], async (req: Request, res: Response) => {

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

// 获取修订版下的文件列表 (V2 核心接口)
app.get([
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/files",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/files"
], async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel } = req.params as { name: string; version: string; user: string; channel: string };
        const packageId = getPackageId(name, version, user, channel);
        const result = await dynamo.send(new GetCommand({ TableName: PACKAGES_TABLE, Key: { packageId } }));

        if (result.Item) {
            const snapshot = await getFileSnapshot(packageId);
            res.json({ files: snapshot });
        } else {
            res.status(404).json({ error: "Recipe not found" });
        }
    } catch (e) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 获取二进制包修订版下的文件列表
app.get([
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/:prev/files"
], async (req: Request, res: Response) => {
    const { name, version, user, channel, binPackageId } = req.params as Record<string, string>;
    const packageId = getPackageId(name, version, user, channel);
    const snapshot = await getFileSnapshot(packageId, binPackageId);
    res.json({ files: snapshot });
});



// 获取包的二进制包列表 (已经定义在上面了，这里保持逻辑一致)




// 获取包的二进制包列表
app.get([
    "/v1/conans/:name/:version/:user/:channel/packages",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages",
    "/v2/conans/:name/:version/:user/:channel/packages",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages"
], async (req: Request, res: Response) => {
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
app.get([
    "/v1/conans/:name/:version/:user/:channel/packages/:binPackageId",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/:prev",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/:prev"
], async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel, binPackageId } = req.params as Record<string, string>;
        const packageId = getPackageId(name, version, user, channel);

        const result = await dynamo.send(new GetCommand({ TableName: PACKAGES_TABLE, Key: { packageId } }));
        if (result.Item && result.Item.packages && result.Item.packages[binPackageId]) {
            const snapshot = await getFileSnapshot(packageId, binPackageId);
            res.json(snapshot);
        } else {
            res.status(404).json({ error: "Binary package not found" });
        }
    } catch (e) {
        res.status(500).json({ error: "Internal error" });
    }
});

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
app.post([
    "/v1/conans/:name/:version/:user/:channel/upload_urls",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/upload_urls",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/upload_urls"
], async (req: Request, res: Response) => {
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

        // 更新包元数据 (Recipe) - Read-Modify-Write 以保留 packages 字段
        const getParams = { TableName: PACKAGES_TABLE, Key: { packageId } };
        const oldItem = await dynamo.send(new GetCommand(getParams));
        const newItem = {
            ...(oldItem.Item || {}),
            packageId,
            packageName: name,
            version,
            user: c_user,
            channel,
            timestamp: Date.now(),
            files,
            packages: oldItem.Item?.packages || {}
        };

        await dynamo.send(
            new PutCommand({
                TableName: PACKAGES_TABLE,
                Item: newItem,
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
app.post([
    "/v1/conans/:name/:version/:user/:channel/packages/:binPackageId/upload_urls",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/:prev/upload_urls",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/:prev/upload_urls"
], async (req: Request, res: Response) => {
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

        // 更新包元数据 - 确保写入 packages 索引
        try {
            console.log(`Registering binary package: ${binPackageId} for recipe ${packageId}`);

            // 重新读取最新状态，防止并发覆盖
            const result = await dynamo.send(new GetCommand({ TableName: PACKAGES_TABLE, Key: { packageId } }));

            // 如果 Recipe 不存在，则初始化一个
            const item = result.Item || {
                packageId,
                packageName: name,
                version,
                user: c_user,
                channel,
                packages: {},
                files: []
            };

            if (!item.packages) item.packages = {};

            // 标记该二进制包存在
            // 注意：upload_urls 阶段请求体通常不包含 settings/options，只有文件列表
            // 这里我们先占位，确保 search 接口能查到它
            if (!item.packages[binPackageId]) {
                item.packages[binPackageId] = {
                    settings: {},
                    options: {}
                };
            }
            // 如果 body 里恰好有元数据（非标准但可能），则更新
            if (body.settings) item.packages[binPackageId].settings = body.settings;
            if (body.options) item.packages[binPackageId].options = body.options;

            console.log(`Writing item to DynamoDB: `, JSON.stringify(item.packages[binPackageId]));

            await dynamo.send(new PutCommand({
                TableName: PACKAGES_TABLE,
                Item: item
            }));

            // 记录审计日志
            await logAuditAction(user.username, "UPLOAD_PACKAGE", `Uploaded binary package ${binPackageId} for ${packageId}`);
        } catch (e) {
            console.error("Update binary metadata error:", e);
        }

        res.json(uploadUrls);
    } catch (error) {
        console.error("Package Upload URLs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 获取下载 URL (V1/V2 通用处理器)
const downloadUrlsHandler = async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel, packageId: binUriId, binPackageId: binParamId, filename } = req.params as Record<string, string>;
        const binPkgId = binUriId || binParamId; // 兼容不同路由下的参数名
        const recipeId = getPackageId(name, version, user, channel);

        console.log(`DownloadUrls request: ${req.path}, recipeId=${recipeId}, binPkgId=${binPkgId}, filename=${filename}`);

        const result = await dynamo.send(new GetCommand({ TableName: PACKAGES_TABLE, Key: { packageId: recipeId } }));
        if (!result.Item) return res.status(404).json({ error: "Package not found" });

        // 如果是特定文件请求 (V2 style: .../files/:filename)
        // 重要：必须重定向，否则 Conan 会把本 JSON 当做文件内容保存
        if (filename) {
            let s3Path = binPkgId ? `${recipeId}/package/${binPkgId}/${filename}` : `${recipeId}/${filename}`;
            const downloadUrl = await getPresignedDownloadUrl(PACKAGES_BUCKET, s3Path);
            console.log(`Redirecting V2 file request to S3: ${s3Path}`);
            return res.redirect(302, downloadUrl);
        }

        // 默认返回所有文件的 download_urls (V1 style)
        const files = binPkgId ? ["conan_package.tgz", "conaninfo.txt", "conanmanifest.txt"] : (result.Item.files || ["conanfile.py", "conanmanifest.txt"]);
        const urls: Record<string, string> = {};
        for (const file of files) {
            let s3Path = binPkgId ? `${recipeId}/package/${binPkgId}/${file}` : `${recipeId}/${file}`;
            urls[file] = await getPresignedDownloadUrl(PACKAGES_BUCKET, s3Path);
        }
        res.json(urls);
    } catch (e) {
        console.error("Download URL Handler error:", e);
        res.status(500).json({ error: "Internal error" });
    }
};

app.get([
    // V1 Recipe
    "/v1/conans/:name/:version/:user/:channel/download_urls",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/download_urls",
    // V1 Package
    "/v1/conans/:name/:version/:user/:channel/packages/:packageId/download_urls",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:packageId/revisions/:prev/download_urls",
    // V2 Recipe
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/download_urls",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/files/:filename",
    // V2 Package
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:packageId/revisions/:prev/download_urls",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:packageId/revisions/:prev/files/:filename"
], downloadUrlsHandler);

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
app.delete([
    "/v1/conans/:name/:version/:user/:channel",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev"
], async (req: Request, res: Response) => {
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
app.post([
    "/v1/conans/:name/:version/:user/:channel/remove_files",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/remove_files",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/remove_files"
], async (req: Request, res: Response) => {
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


app.post([
    "/v1/conans/:name/:version/:user/:channel/packages/:binPackageId/remove_files",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/:prev/remove_files",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/packages/:binPackageId/revisions/:prev/remove_files"
], async (req: Request, res: Response) => {
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
app.get([
    "/v1/conans/:name/:version/:user/:channel/digest",
    "/v1/conans/:name/:version/:user/:channel/revisions/:rrev/digest",
    "/v2/conans/:name/:version/:user/:channel/digest",
    "/v2/conans/:name/:version/:user/:channel/revisions/:rrev/digest"
], async (req: Request, res: Response) => {
    try {
        const { name, version, user, channel } = req.params as Record<string, string>;
        const packageId = getPackageId(name, version, user, channel);
        const result = await dynamo.send(new GetCommand({ TableName: PACKAGES_TABLE, Key: { packageId } }));
        if (result.Item) {
            // 返回真实的 MD5 或兜底，阻止 CAS 下载并满足 search 校验
            const snapshot = await getFileSnapshot(packageId);
            res.json(snapshot);
        } else {
            res.status(404).json({ error: "Recipe not found" });
        }
    } catch (e) {
        res.status(500).json({ error: "Internal error" });
    }
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
