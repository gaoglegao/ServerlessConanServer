import { StackContext, Api, Bucket, Table } from "sst/constructs";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

export function ConanServerStack({ stack }: StackContext) {
    // S3 存储桶用于存储 Conan 包文件
    const packagesBucket = new Bucket(stack, "ConanPackages", {
        cors: [
            {
                allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
                allowedOrigins: ["*"],
                allowedHeaders: ["*"],
            },
        ],
    });

    // DynamoDB 表用于存储包的元数据
    const packagesTable = new Table(stack, "ConanPackagesMetadata", {
        fields: {
            // 包的唯一标识: name/version@user/channel
            packageId: "string",
            // 用于查询特定包的所有版本
            packageName: "string",
            // 时间戳
            timestamp: "number",
        },
        primaryIndex: { partitionKey: "packageId" },
        globalIndexes: {
            packageNameIndex: {
                partitionKey: "packageName",
                sortKey: "timestamp",
            },
        },
    });

    // DynamoDB 表用于存储用户/认证信息
    const usersTable = new Table(stack, "ConanUsers", {
        fields: {
            username: "string",
            token: "string",
        },
        primaryIndex: { partitionKey: "username" },
        globalIndexes: {
            tokenIndex: {
                partitionKey: "token",
            },
        },
    });

    // DynamoDB 表用于存储审计日志
    const auditLogsTable = new Table(stack, "ConanAuditLogs", {
        fields: {
            logId: "string",      // 唯一 ID
            timestamp: "number",   // 时间戳
            action: "string",     // 操作类型 (UPLOAD, DOWNLOAD, etc.)
            username: "string",   // 执行用户
            details: "string",    // 操作详情
        },
        primaryIndex: { partitionKey: "logId" },
        globalIndexes: {
            actionIndex: {
                partitionKey: "action",
                sortKey: "timestamp",
            },
        },
    });

    // 使用 CloudFront Function 强制剥离 Authorization Header
    // 即使 OriginRequestPolicy 配置不转发，有时 Viewer 请求的 Header 仍可能通过 certain configurations 泄露或冲突
    // 显式删除是最稳妥的
    const stripAuthFunction = new cf.Function(stack, "StripAuthFunction", {
        code: cf.FunctionCode.fromInline(`
            function handler(event) {
                var request = event.request;
                if (request.headers.authorization) {
                    delete request.headers.authorization;
                }
                return request;
            }
        `),
    });

    // CloudFront Distribution (用于剥离 Authorization Header 并允许超大文件通过 S3 预签名直传)
    const distribution = new cf.Distribution(stack, "ConanDist", {
        defaultBehavior: {
            // 使用 HttpOrigin 而非 S3Origin，避免 CloudFront 自动添加 OAI/OAC 导致 S3 报错 "Only one auth mechanism allowed"
            // 我们完全依赖 Presigned URL 进行鉴权
            origin: new origins.HttpOrigin(packagesBucket.cdk.bucket.bucketRegionalDomainName),
            allowedMethods: cf.AllowedMethods.ALLOW_ALL,
            cachePolicy: cf.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: new cf.OriginRequestPolicy(stack, "ConanOriginParamPolicy", {
                queryStringBehavior: cf.OriginRequestQueryStringBehavior.all(),
                // 关键配置：不转发 Header (特别是 Authorization)，避免 S3 鉴权冲突
                headerBehavior: cf.OriginRequestHeaderBehavior.none(),
                cookieBehavior: cf.OriginRequestCookieBehavior.none(),
            }),
            viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            functionAssociations: [{
                function: stripAuthFunction,
                eventType: cf.FunctionEventType.VIEWER_REQUEST,
            }],
        },
    });

    // API Gateway + Lambda
    const api = new Api(stack, "ConanApi", {
        defaults: {
            function: {
                bind: [packagesBucket, packagesTable, usersTable, auditLogsTable],
                // 限制 CloudWatch 日志保留时间为 1 天，降低历史数据成本
                logRetention: "one_day",
                environment: {
                    PACKAGES_BUCKET_NAME: packagesBucket.bucketName,
                    PACKAGES_TABLE_NAME: packagesTable.tableName,
                    USERS_TABLE_NAME: usersTable.tableName,
                    AUDIT_LOGS_TABLE_NAME: auditLogsTable.tableName,
                    CLOUDFRONT_DOMAIN: distribution.domainName,
                },
            },
        },
        routes: {
            // Conan v1 API 路由
            "GET /v1/ping": "functions/api.handler",

            // 包搜索和列表
            "GET /v1/conans/search": "functions/api.handler",
            "GET /v2/conans/search": "functions/api.handler",
            "GET /search": "functions/api.handler",
            "GET /v1/conans/{name}/{version}/{user}/{channel}": "functions/api.handler",

            // 包上传和下载
            "GET /v1/conans/{name}/{version}/{user}/{channel}/packages": "functions/api.handler",
            "POST /v1/conans/{name}/{version}/{user}/{channel}/upload_urls": "functions/api.handler",
            "POST /v1/conans/{name}/{version}/{user}/{channel}/packages/{binPackageId}/upload_urls": "functions/api.handler",
            "GET /v1/conans/{name}/{version}/{user}/{channel}/download_urls": "functions/api.handler",
            "GET /v1/conans/{name}/{version}/{user}/{channel}/packages/{packageId}/download_urls": "functions/api.handler",

            // 包文件操作 (Proxy & Redirect)
            "ANY /v1/files/redirect/{proxy+}": "functions/api.handler",
            "GET /v1/files/{key}": "functions/api.handler",
            "PUT /v1/files/{key}": "functions/api.handler",

            // 用户认证
            "POST /v1/users/authenticate": "functions/api.handler",
            "POST /v1/users/check_credentials": "functions/api.handler",

            // Conan v2 API 路由
            "GET /v2/ping": "functions/api.handler",
            "GET /v2/conans": "functions/api.handler",

            // 通用路由
            "$default": "functions/api.handler",
        },
    });

    stack.addOutputs({
        ApiEndpoint: api.url,
        PackagesBucketName: packagesBucket.bucketName,
        PackagesTableName: packagesTable.tableName,
        UsersTableName: usersTable.tableName,
        AuditLogsTableName: auditLogsTable.tableName,
    });

    return {
        api,
        packagesBucket,
        packagesTable,
        usersTable,
        auditLogsTable,
    };
}
