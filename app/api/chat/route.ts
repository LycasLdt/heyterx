import {
  createAgentUIStreamResponse,
  createIdGenerator,
  type UIMessage,
} from "ai";
import { getSessionUser } from "@/lib/auth";
import { createTaskAgent } from "@/lib/ai/agent";
import { userQueries, conversationQueries } from "@/lib/db/queries";
import { readCoreMemory } from "@/lib/ai/memory";
import { formatDate } from "@/lib/utils/date";

export async function POST(req: Request) {
  // 校验登录状态：better-auth 通过 cookie 中的 session 鉴权
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 客户端仅发送最后一条 message（减少传输量），服务端从 DB 加载历史
  const { message, today, now } = (await req.json()) as {
    message: UIMessage;
    today?: string;
    now?: string;
  };
  if (!message) {
    return new Response("Bad Request: missing message", { status: 400 });
  }

  // 并行加载用户偏好、核心记忆与现有对话历史
  // 使用解密版偏好：服务端调用 LLM 需要 apiKey 明文
  const [preferences, coreMemory, existingConv] = await Promise.all([
    userQueries.getPreferencesDecrypted(user.id),
    readCoreMemory(user.id),
    conversationQueries.getLatest(user.id),
  ]);

  // 合并历史消息与新消息；createAgentUIStreamResponse 内部会调用
  // validateUIMessages 对合并后的消息进行校验（含 tools 匹配）
  const previousMessages = existingConv?.messages ?? [];
  const conversationId = existingConv?.id;
  const messages = [...previousMessages, message];

  // Agent 直接读写数据库（按 userId 隔离），不再依赖客户端传入任务地图
  // 使用客户端传来的 today/now 以避免服务端时区与客户端不一致
  const agent = createTaskAgent(
    user.id,
    today ?? formatDate(new Date()),
    preferences,
    coreMemory,
    now ?? new Date().toISOString(),
  );

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,

    generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
    messageMetadata: ({ part }) => {
      if (part.type === "start") {
        return { createdAt: new Date().toISOString() };
      }
    },
    // onEnd 在流式正常结束（flush）和客户端断开（cancel）时都会触发，
    // 确保即使页面关闭对话也能保存到服务端。
    onEnd: async ({ messages: finalMessages }) => {
      await conversationQueries.save(user.id, {
        id: conversationId ?? undefined,
        messages: finalMessages,
      });
    },
  });
}
