import { createAuthClient } from "better-auth/react";

// 客户端 Auth 实例，调用 /api/auth/* 下的 better-auth 端点
export const authClient = createAuthClient();
