import { StackContext, Api, Bucket, Table } from "sst/constructs";

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

    // API Gateway + Lambda
    const api = new Api(stack, "ConanApi", {
        defaults: {
            function: {
                bind: [packagesBucket, packagesTable, usersTable],
                environment: {
                    PACKAGES_BUCKET_NAME: packagesBucket.bucketName,
                    PACKAGES_TABLE_NAME: packagesTable.tableName,
                    USERS_TABLE_NAME: usersTable.tableName,
                },
            },
        },
        routes: {
            // Conan v1 API 路由
            "GET /v1/ping": "functions/api.handler",

            // 包搜索和列表
            "GET /v1/conans/search": "functions/api.handler",
            "GET /v1/conans/{name}/{version}/{user}/{channel}": "functions/api.handler",

            // 包上传和下载
            "GET /v1/conans/{name}/{version}/{user}/{channel}/packages": "functions/api.handler",
            "POST /v1/conans/{name}/{version}/{user}/{channel}/upload_urls": "functions/api.handler",
            "GET /v1/conans/{name}/{version}/{user}/{channel}/download_urls": "functions/api.handler",

            // 包文件操作
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
    });

    return {
        api,
        packagesBucket,
        packagesTable,
        usersTable,
    };
}
