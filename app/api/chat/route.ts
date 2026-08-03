import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  pruneMessages,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { getSessionUser } from "@/lib/auth";
import { createTaskAgent } from "@/lib/ai/agent";
import { userQueries, conversationQueries } from "@/lib/db/queries";
import { readCoreMemory } from "@/lib/ai/memory";
import { formatDate } from "@/lib/utils/date";

type ModelMessage = Parameters<typeof pruneMessages>[0]["messages"][number];

/**
 * 压缩早期 tool-result 的 output，减少传给模型的 token。
 *
 * 与 pruneMessages 的 toolCalls 修剪不同，本函数保留所有 tool-call 部分
 * （assistant 消息中的「调用 X 工具」），仅压缩 tool 消息中 tool-result
 * 的 output 内容（替换为简短摘要）。这样模型仍能看到「我之前调用过工具」
 * 的完整历史，不会误以为没调用工具就直接回答；同时大幅减少大返回值工具
 * （如 getTasks 返回上百项任务的 JSON）的 token 消耗。
 *
 * 策略：最近 keepLastN 条消息保持原样（确保当前工具循环上下文完整），
 *      早期 tool 消息中的 tool-result.output 替换为摘要文本。
 */
function compressEarlyToolResults(
  messages: ModelMessage[],
  keepLastN: number,
): ModelMessage[] {
  if (messages.length <= keepLastN) return messages;
  const cutoff = messages.length - keepLastN;
  return messages.map((msg, idx) => {
    if (idx >= cutoff) return msg;
    if (msg.role !== "tool" || typeof msg.content === "string") return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const summary = summarizeToolOutput(part.toolName, part.output);
        if (summary == null) return part;
        return {
          ...part,
          output: { type: "text" as const, value: summary },
        };
      }),
    };
  });
}

/**
 * 根据工具返回内容生成简短摘要。仅对大返回值工具（任务地图、搜索结果等）
 * 生成摘要；小返回值工具（updateCoreMemory、exportTasks 等）返回 null 不压缩。
 */
function summarizeToolOutput(
  toolName: string,
  output: unknown,
): string | null {
  // output 形如 { type: 'json'|'text', value: ... }，提取实际内容
  const value =
    typeof output === "object" &&
    output !== null &&
    "value" in output &&
    typeof (output as { value: unknown }).value === "object"
      ? (output as { value: Record<string, unknown> }).value
      : null;
  if (!value) return null;

  // 任务地图类工具（getTasks/addTask/updateTask/toggleTask/moveTask/deleteTask）
  if ("tasksByDate" in value && typeof value.tasksByDate === "object") {
    const tasksByDate = value.tasksByDate as Record<string, unknown[]>;
    let total = 0;
    const days = Object.keys(tasksByDate).length;
    for (const list of Object.values(tasksByDate)) {
      if (Array.isArray(list)) total += list.length;
    }
    return `（已压缩：${days} 天共 ${total} 项任务的任务地图）`;
  }
  // searchTasks 结果
  if ("results" in value && Array.isArray(value.results)) {
    return `（已压缩：${value.results.length} 项匹配任务）`;
  }
  // getPastIncompleteTasks
  if ("pastIncomplete" in value && Array.isArray(value.pastIncomplete)) {
    const fd = value.futureDays as unknown[] | undefined;
    return `（已压缩：${value.pastIncomplete.length} 项过去未完成任务${
      fd ? `，${fd.length} 天未来计数` : ""
    }）`;
  }
  // 任务段列表（createTaskSegment/updateTaskSegment）
  if ("segments" in value && Array.isArray(value.segments)) {
    return `（已压缩：${value.segments.length} 个任务段）`;
  }
  // analyzeTaskBalance
  if ("importanceCounts" in value && "categoryCounts" in value) {
    return `（已压缩：${value.total ?? 0} 项任务的平衡分析）`;
  }
  // searchConversations
  if ("count" in value && "results" in value && Array.isArray(value.results)) {
    return `（已压缩：${value.count} 条历史对话匹配）`;
  }
  // 小返回值工具（updateCoreMemory、exportTasks、askQuestions 等）不压缩
  return null;
}

export async function POST(req: Request) {
  // 校验登录状态：better-auth 通过 cookie 中的 session 鉴权
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 客户端仅发送最后一条 message（减少传输量），服务端从 DB 加载历史
  const { message, today, now, toolContext } = (await req.json()) as {
    message: UIMessage;
    today?: string;
    now?: string;
    /**
     * 可选：含客户端工具（askQuestions）输出的上一条 assistant 消息。
     * 用户在提问悬置期间直接发送新消息时，客户端先跳过该提问再发送新消息，
     * 此字段用于让服务端同步工具输出，避免出现「无结果的工具调用」。
     */
    toolContext?: UIMessage;
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
  // validateUIMessages 对合并后的消息进行校验（含 tools 匹配）。
  // 按 id 去重：消息 id 已存在时原位替换（并丢弃其后的旧消息）——
  // 覆盖三种场景：客户端工具输出回传 / 重新生成 / toolContext 同步；
  // id 不存在则追加到末尾（普通新消息）。
  const previousMessages = existingConv?.messages ?? [];
  const conversationId = existingConv?.id;
  const merged = new Map<string, UIMessage>(
    previousMessages.map((m) => [m.id, m]),
  );
  if (toolContext && merged.has(toolContext.id)) {
    merged.set(toolContext.id, toolContext);
  }
  let messages: UIMessage[];
  if (merged.has(message.id)) {
    merged.set(message.id, message);
    // 截断：被替换消息之后的旧消息（如 regenerate 前的旧回答）全部丢弃
    messages = [];
    for (const m of merged.values()) {
      messages.push(m);
      if (m.id === message.id) break;
    }
  } else {
    merged.set(message.id, message);
    messages = [...merged.values()];
  }

  // Agent 直接读写数据库（按 userId 隔离），不再依赖客户端传入任务地图
  // 使用客户端传来的 today/now 以避免服务端时区与客户端不一致
  const agent = createTaskAgent(
    user.id,
    today ?? formatDate(new Date()),
    preferences,
    coreMemory,
    now ?? new Date().toISOString(),
  );

  // 展开调用 createAgentUIStreamResponse 的内部流程，以便在 UIMessage →
  // ModelMessage 转换后压缩上下文，减少 token 消耗。
  // 1) validateUIMessages：按 agent.tools 校验消息（含 tool-call/result 匹配）
  // 2) convertToModelMessages：UIMessage → ModelMessage
  // 3) pruneMessages + compressEarlyToolResults：压缩「传给模型」的上下文
  // 4) agent.stream：以压缩后的 ModelMessage 列表驱动 agent
  // 5) toUIMessageStream：originalMessages 传入「完整」的 validatedMessages，
  //    onEnd 保存到 DB 的也是 validatedMessages + 新消息 —— 完整不变。
  //
  // 两阶段压缩策略（仅影响传给模型的 prompt，不影响 DB / UI）：
  // 阶段一 pruneMessages：
  // - reasoning: 'before-last-message' —— 保留最后一条消息的推理部分，
  //   早期推理（思考过程）已被模型消化，无需重复传回。reasoning 是模型内部
  //   思考，移除不会影响模型对工具调用历史的理解。
  // - emptyMessages: 'remove' —— reasoning 修剪后内容为空的消息移除。
  // 阶段二 compressEarlyToolResults（自定义）：
  // - 保留所有 tool-call 部分（模型知道「我之前调用过工具」，不会盲目回答）
  // - 早期 tool-result.output 替换为简短摘要（如「已压缩：30 天共 120 项任务
  //   的任务地图」），大幅减少大返回值工具的 token；最近 6 条消息保持完整，
  //   确保当前工具循环上下文不被压缩。
  const validatedMessages = await validateUIMessages<UIMessage>({
    messages,
    tools: agent.tools as unknown as Parameters<
      typeof validateUIMessages<UIMessage>
    >[0]["tools"],
  });
  let modelMessages = await convertToModelMessages(validatedMessages, {
    tools: agent.tools,
  });
  modelMessages = pruneMessages({
    messages: modelMessages,
    reasoning: "before-last-message",
    emptyMessages: "remove",
  });
  modelMessages = compressEarlyToolResults(modelMessages, 6);

  const result = await agent.stream({
    prompt: modelMessages,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      originalMessages: validatedMessages,
      stream: result.stream,
      tools: agent.tools,
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
    }),
  });
}
