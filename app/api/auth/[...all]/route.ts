import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// better-auth 路由处理器，挂在 /api/auth/* 下
export const { GET, POST } = toNextJsHandler(auth);
