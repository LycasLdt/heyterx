import { createAgentUIStreamResponse, type UIMessage } from "ai";
import { getSessionUser } from "@/lib/auth";
import { createTaskAgent } from "@/lib/agent";
import { getUserPreferences } from "@/lib/db/queries";
import { readCoreMemory } from "@/lib/memory";
import { formatDate } from "@/lib/date";

export async function POST(req: Request) {
  // 校验登录状态：better-auth 通过 cookie 中的 session 鉴权
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages, today } = (await req.json()) as {
    messages: UIMessage[];
    today?: string;
  };

  // 并行加载用户偏好与核心记忆，注入到 Agent instructions
  const [preferences, coreMemory] = await Promise.all([
    getUserPreferences(user.id),
    readCoreMemory(user.id),
  ]);

  // Agent 直接读写数据库（按 userId 隔离），不再依赖客户端传入任务地图
  // 使用客户端传来的 today 以避免服务端时区与客户端不一致
  const agent = createTaskAgent(
    user.id,
    today ?? formatDate(new Date()),
    preferences,
    coreMemory
  );

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
  });
}
