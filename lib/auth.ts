import { headers } from "next/headers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";

// better-auth 实例：使用 Drizzle adapter + PostgreSQL
// secret 与 baseURL 由环境变量 BETTER_AUTH_SECRET / BETTER_AUTH_URL 自动读取
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
});

/**
 * 服务端获取当前登录用户，未登录返回 null
 * 所有需要鉴权的 API 路由共用此 helper
 */
export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
