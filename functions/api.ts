import serverless from "serverless-http";
import express, { Request, Response } from "express";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(express.text());
// 处理二进制文件上传（如 .tgz 文件）
app.use(express.raw({ type: ["application/octet-stream", "application/gzip", "application/x-gzip", "application/x-tar", "*/*"], limit: "50mb" }));

// AWS 客户端初始化
const s3 = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const PACKAGES_BUCKET = process.env.PACKAGES_BUCKET_NAME!;
const PACKAGES_TABLE = process.env.PACKAGES_TABLE_NAME!;
const USERS_TABLE = process.env.USERS_TABLE_NAME!;

// 辅助函数：生成包的唯一 ID
function getPackageId(name: string, version: string, user: string, channel: string): string {
    return `${name}/${version}@${user}/${channel}`;
}

// 辅助函数：从请求中提取认证信息
function extractAuth(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }
    return null;
}

// 辅助函数：验证用户令牌
async function verifyToken(token: string): Promise<boolean> {
    if (!token) return false;

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
        return !!(result.Items && result.Items.length > 0);
    } catch (error) {
        console.error("Token verification error:", error);
        return false;
    }
}

// ============ API 路由 ============

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

        if (user && user.password === password) {
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
app.get("/v1/conans/search", async (req: Request, res: Response) => {
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
});

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

// 辅助函数：生成本地文件代理 URL
function getProxyUrl(req: Request, key: string): string {
    const host = req.get("host");
    const protocol = req.protocol;
    return `${protocol}://${host}/v1/files/${key}`;
}

// 获取上传 URL (Recipe)
app.post("/v1/conans/:name/:version/:user/:channel/upload_urls", async (req: Request, res: Response) => {
    try {
        const token = extractAuth(req);
        if (!(await verifyToken(token || ""))) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { name, version, user, channel } = req.params as { name: string; version: string; user: string; channel: string };
        const packageId = getPackageId(name, version, user, channel);

        // 支持多种格式：{files: [...]} 或 {filename: size, ...}
        const body = req.body || {};
        const files = Array.isArray(body.files) ? body.files : Object.keys(body).filter(k => typeof body[k] === 'number' || typeof body[k] === 'string');

        if (files.length === 0 && body.files) {
            // Handle case where body.files might be an object or something else
        }

        const uploadUrls: Record<string, string> = {};

        for (const file of files) {
            const key = `${packageId}/${file}`;
            // 不再使用 S3 预签名 URL，而是使用本地代理 URL
            uploadUrls[file] = getProxyUrl(req, key);
        }

        // 更新包元数据 (Recipe)
        await dynamo.send(
            new PutCommand({
                TableName: PACKAGES_TABLE,
                Item: {
                    packageId,
                    packageName: name,
                    version,
                    user,
                    channel,
                    timestamp: Date.now(),
                    files,
                },
            })
        );

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
        if (!(await verifyToken(token || ""))) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { name, version, user, channel, binPackageId } = req.params as {
            name: string;
            version: string;
            user: string;
            channel: string;
            binPackageId: string;
        };
        const packageId = getPackageId(name, version, user, channel);

        const body = req.body || {};
        const files = Array.isArray(body.files) ? body.files : Object.keys(body).filter(k => typeof body[k] === 'number' || typeof body[k] === 'string' || k !== 'packageId');

        const uploadUrls: Record<string, string> = {};

        for (const file of files) {
            const key = `${packageId}/package/${binPackageId}/${file}`;
            // 使用本地代理 URL
            uploadUrls[file] = getProxyUrl(req, key);
        }

        // 更新包元数据，记录此二进制包存在及其配置
        try {
            const result = await dynamo.send(new GetCommand({ TableName: PACKAGES_TABLE, Key: { packageId } }));
            const item = result.Item || { packageId, packageName: name, version, user, channel, packages: {} };
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
            downloadUrls[file] = getProxyUrl(req, key);
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
            downloadUrls[file] = getProxyUrl(req, key);
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
        // 从路径中提取文件 key（移除 /v1/files/ 前缀）
        const key = req.path.replace(/^\/v1\/files\//, "");

        const command = new GetObjectCommand({
            Bucket: PACKAGES_BUCKET,
            Key: key,
        });

        const result = await s3.send(command);

        if (result.Body) {
            res.setHeader("Content-Type", result.ContentType || "application/octet-stream");
            // @ts-ignore - Body 可以是流
            result.Body.pipe(res);
        } else {
            res.status(404).json({ error: "File not found" });
        }
    } catch (error) {
        console.error("File download error:", error);
        res.status(404).json({ error: "File not found" });
    }
});

// 文件代理 - 上传 (PUT)
app.put("/v1/files/*", async (req: Request, res: Response) => {
    try {
        const key = req.path.replace(/^\/v1\/files\//, "");

        // 处理请求体：可能是 Buffer、String 或需要 base64 解码
        let body: Buffer;
        if (Buffer.isBuffer(req.body)) {
            body = req.body;
        } else if (typeof req.body === "string") {
            // 检查是否是 base64 编码的二进制数据
            // 如果是有效的 base64，尝试解码
            try {
                const decoded = Buffer.from(req.body, "base64");
                // 检查解码后是否看起来像 gzip (1f 8b)
                if (decoded.length > 2 && decoded[0] === 0x1f && decoded[1] === 0x8b) {
                    body = decoded;
                } else {
                    // 不是 gzip，可能是文本文件，直接使用
                    body = Buffer.from(req.body);
                }
            } catch {
                body = Buffer.from(req.body);
            }
        } else {
            body = Buffer.from(JSON.stringify(req.body));
        }

        const command = new PutObjectCommand({
            Bucket: PACKAGES_BUCKET,
            Key: key,
            Body: body,
            ContentType: req.headers["content-type"] as string || "application/octet-stream"
        });

        await s3.send(command);
        res.status(200).send("OK");
    } catch (error) {
        console.error("File upload error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});

// 删除包中的文件 (Conan 1.x 上传流程一部分)
app.post("/v1/conans/:name/:version/:user/:channel/remove_files", async (req: Request, res: Response) => {
    // 简化处理：对于我们的 Serverless 实现，通常覆盖上传，所以直接返回 OK
    res.json({ status: "ok" });
});

app.post("/v1/conans/:name/:version/:user/:channel/packages/:binPackageId/remove_files", async (req: Request, res: Response) => {
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
