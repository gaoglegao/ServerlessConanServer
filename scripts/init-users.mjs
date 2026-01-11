#!/usr/bin/env node
/**
 * 初始化用户脚本
 * 用于创建默认管理员用户
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "crypto";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const USERS_TABLE = process.env.USERS_TABLE_NAME;

if (!USERS_TABLE) {
    console.error("Error: USERS_TABLE_NAME environment variable not set");
    process.exit(1);
}

async function initUsers() {
    try {
        // 创建默认管理员用户
        const defaultUser = {
            username: "admin",
            password: "admin123", // 实际应用中应该加密
            token: randomBytes(32).toString("hex"),
            role: "admin",
            createdAt: Date.now(),
        };

        await dynamo.send(
            new PutCommand({
                TableName: USERS_TABLE,
                Item: defaultUser,
            })
        );

        console.log("✅ Default user created successfully");
        console.log("Username:", defaultUser.username);
        console.log("Password:", defaultUser.password);
        console.log("Token:", defaultUser.token);
        console.log("\n⚠️  Please change the password after first login!");
    } catch (error) {
        console.error("❌ Error creating default user:", error);
        process.exit(1);
    }
}

initUsers();
