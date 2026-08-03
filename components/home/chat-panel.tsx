"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Bot, Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import { MessageItem } from "@/components/home/message-item";
import { AskQuestionsPanel } from "@/components/home/ask-questions-panel";
import { ChatInput, type SendParams } from "@/components/home/chat-input";
import { TaskDiffView } from "@/components/home/task-diff-view";
import { computeMessageTaskDiff } from "@/lib/home/task-diff";
import { useHomeStore } from "@/lib/home/store";
import { Button } from "@/components/ui/button";
import { cn, fetcher } from "@/lib/utils";
import {
  SYSTEM_TRIGGER_PREFIX,
  type TasksResponse,
} from "@/lib/home/constants";
import type {
  AskQuestionsAnswer,
  AskQuestionsInput,
  AskQuestionsOutput,
} from "@/lib/ai/ask-questions";
import type {
  ConversationRow,
  TaskSegment,
  TasksByDate,
} from "@/lib/db/queries";
import type { UserPreferences } from "@/lib/db/schema";
import { idbGet, idbSet, idbDelete } from "@/lib/idb";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMessageScroll } from "@/hooks/use-message-scroll";

type ConversationResponse = { conversation: ConversationRow | null };

/**
 * AI 对话面板：从 app/page.tsx 抽离的全部对话逻辑。
 *
 * 私有状态（仅 ChatPanel 内部使用，不进 store）：
 * - useChat（messages / sendMessage / status / stop / setMessages）
 * - conversationId（当前对话 ID）
 * - hiddenCount（折叠的旧消息数量，上滑加载更多时释放）
 * - messageDates（每条消息对应的日期，用于日期分割线）
 * - 各类滚动 ref
 *
 * 输入相关逻辑（contenteditable editor、@ 引用、附件、语音）已抽离到 ChatInput 组件。
 *
 * 从 store 读取：today、clearConversationNonce（外部清空信号）
 * SWR：/api/conversations（历史对话加载）
 * 全局 mutate：/api/tasks（工具输出同步到任务缓存）
 */
export function ChatPanel() {
  const today = useHomeStore((s) => s.today);
  const clearNonce = useHomeStore((s) => s.clearConversationNonce);
  const { mutate: globalMutate } = useSWRConfig();

  // --- useChat ---
  // 仅发送最后一条 message（含 createdAt 元数据），服务端从 DB 加载历史消息
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1]!;
          // 为用户消息补充 createdAt（assistant 消息由服务端 messageMetadata 注入；
          // 已带 createdAt 的消息——如重新生成——保持原值）
          const lastMeta = last.metadata as { createdAt?: string } | undefined;
          const messageWithMeta =
            last.role === "user" && !lastMeta?.createdAt
              ? {
                  ...last,
                  metadata: {
                    ...(last.metadata ?? {}),
                    createdAt: new Date().toISOString(),
                  },
                }
              : last;
          // 上一条 assistant 消息含 askQuestions 工具部分时随请求一并发送：
          // 用户在提问悬置期间直接发新消息，客户端已先为该提问填入「跳过」输出，
          // 服务端据此原位替换历史消息，避免遗留无结果的工具调用
          const prev =
            messages.length > 1 ? messages[messages.length - 2] : null;
          const toolContext =
            prev &&
            prev.role === "assistant" &&
            prev.parts.some((p) => p.type === "tool-askQuestions")
              ? prev
              : undefined;
          return {
            body: {
              ...body,
              message: messageWithMeta,
              toolContext,
              today,
              now: new Date().toISOString(),
            },
          };
        },
      }),
    [today],
  );

  const {
    messages: rawMessages,
    sendMessage,
    regenerate,
    status,
    stop,
    error,
    setMessages,
    addToolOutput,
  } = useChat({
    transport,
    // 提问面板提交回答（skipped=false）后自动继续对话；
    // 用户跳过提问（skipped=true）时不触发，由其发送的新消息驱动。
    // 同一条 assistant 消息可能含多个工具调用（含多次提问），
    // 必须全部有结果才自动提交，避免遗留无结果的工具调用
    sendAutomaticallyWhen: ({ messages: chatMessages }) => {
      const last = chatMessages[chatMessages.length - 1];
      if (!last || last.role !== "assistant") return false;
      let hasAnsweredAsk = false;
      for (const p of last.parts) {
        if (
          typeof p.type !== "string" ||
          !p.type.startsWith("tool-") ||
          p.type === "tool-dynamic-tool"
        )
          continue;
        const part = p as { state?: string; output?: AskQuestionsOutput };
        if (part.state !== "output-available" && part.state !== "output-error")
          return false;
        if (p.type === "tool-askQuestions" && part.output?.skipped === false) {
          hasAnsweredAsk = true;
        }
      }
      return hasAnsweredAsk;
    },
  });

  // useDeferredValue：工具调用流式时 parsePartialJson 每 token 阻塞主线程，
  // 用 deferred 延迟渲染让浏览器在 token 间隙能响应用户输入。
  // 保存对话的 effect 用 rawMessages 确保数据实时性。
  const messages = useDeferredValue(rawMessages);

  // --- 消息滚动：折叠/吸底/上滑加载更多，全部抽离到 useMessageScroll ---
  const {
    scrollRef,
    contentRef,
    hiddenCount,
    handleScroll,
    reset: resetScroll,
  } = useMessageScroll({ messages, today });

  // --- 私有状态 ---
  const [conversationId, setConversationId] = useState<string | null>(null);
  // 删除模式：显示 checkbox 供用户选择要删除的 message
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 复制成功反馈
  const [copied, setCopied] = useState(false);
  // 防止新一天问候在 sendMessage 与 setMessages 竞态下重复触发
  const greetingInFlightRef = useRef(false);

  // --- 消息日期 ---
  const messageDatesRef = useRef<Record<string, string>>({});
  const [messageDates, setMessageDates] = useState<Record<string, string>>({});

  // --- SWR：历史对话 ---
  const { data: convData, mutate: mutateConv } = useSWR<ConversationResponse>(
    "/api/conversations",
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  // --- SWR：用户偏好（用于判断当前默认模型是否多模态、问候是否开启） ---
  const { data: prefsData } = useSWR<{ preferences: UserPreferences }>(
    "/api/preferences",
    fetcher,
    { revalidateOnFocus: false },
  );
  const defaultModelId = prefsData?.preferences.models?.defaultModelId ?? "";
  const currentModelMultimodal = useMemo(() => {
    const configs = prefsData?.preferences.models?.configs ?? [];
    const cfg = configs.find((c) => c.id === defaultModelId);
    return cfg?.multimodal ?? false;
  }, [prefsData, defaultModelId]);
  // 用户偏好：新一天问候开关（默认 true）
  const greetingEnabled =
    prefsData?.preferences.agent.behavior?.greetingEnabled ?? true;

  // --- 同步 ref ---
  const wasStreamingRef = useRef(false);
  const lastSyncedTasksRef = useRef<TasksByDate | null>(null);
  const lastSyncedSegsRef = useRef<TaskSegment[] | null>(null);
  // 当前已展示的对话 updatedAt（用于 indexedDB 缓存与 SWR 数据的一致性比对）
  const displayedUpdatedAtRef = useRef<string | null>(null);
  // 工具输出扫描缓存：避免流式期间每 token 全量遍历 messages
  // AI SDK 流式时只有最后一条 message 引用变化，前面的引用稳定，
  // 故缓存「上次找到 tool output 的 message 引用」，下次扫描遇到它即停止。
  const toolScanRef = useRef<{
    lastMsg: UIMessage | null;
    tasksMsg: UIMessage | null;
    segsMsg: UIMessage | null;
    latest: TasksByDate | null;
    latestSegments: TaskSegment[] | null;
  }>({
    lastMsg: null,
    tasksMsg: null,
    segsMsg: null,
    latest: null,
    latestSegments: null,
  });

  // --- 本地重置（不含 API DELETE） ---
  const resetConversationLocal = () => {
    setMessages([]);
    setConversationId(null);
    setDeleteMode(false);
    setSelectedIds(new Set());
    greetingInFlightRef.current = false;
    messageDatesRef.current = {};
    setMessageDates({});
    resetScroll();
    lastSyncedTasksRef.current = null;
    lastSyncedSegsRef.current = null;
    displayedUpdatedAtRef.current = null;
    void idbDelete("conversation:latest");
    toolScanRef.current = {
      lastMsg: null,
      tasksMsg: null,
      segsMsg: null,
      latest: null,
      latestSegments: null,
    };
  };

  // --- 完整清空（含 API DELETE），用于历史加载失败时 ---
  const clearConversation = async () => {
    resetConversationLocal();
    mutateConv({ conversation: null }, { revalidate: false });
    await fetch("/api/conversations", { method: "DELETE" });
  };

  // --- 外部清空信号（SettingsDialog 通过 store 触发） ---
  const prevNonceRef = useRef(clearNonce);
  useEffect(() => {
    if (prevNonceRef.current === clearNonce) return;
    prevNonceRef.current = clearNonce;
    // API DELETE 已由 SettingsDialog 完成，此处仅重置本地状态
    resetConversationLocal();
    mutateConv({ conversation: null }, { revalidate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearNonce]);

  // --- 加载历史对话（indexedDB 优先，SWR 比对更新） ---
  /** 应用对话数据到 UI（设置 messages、conversationId、触发新一天问候） */
  const applyConversationData = (conv: {
    id: string;
    messages: UIMessage[];
    updatedAt: string;
  }) => {
    setConversationId(conv.id);
    const msgs = conv.messages;
    if (msgs.length === 0) return;
    try {
      setMessages(msgs);
      // 新一天问候检测
      const lastDateStr = conv.updatedAt.split("T")[0] ?? today;
      const greetedKey = `heyterx:greeted:${today}`;
      const alreadyGreeted =
        typeof window !== "undefined" &&
        window.localStorage?.getItem(greetedKey) === "1";
      if (
        greetingEnabled &&
        lastDateStr < today &&
        !alreadyGreeted &&
        !greetingInFlightRef.current
      ) {
        greetingInFlightRef.current = true;
        if (typeof window !== "undefined") {
          window.localStorage?.setItem(greetedKey, "1");
        }
        setTimeout(() => {
          sendMessage({
            text: `${SYSTEM_TRIGGER_PREFIX} 新的一天（${today}）开始了。请按系统提示中「新一天问候」的迁移决策流程处理过去未完成任务（注意遵循用户设定的迁移模式：不迁移/仅迁移重要任务/全部迁移），然后用一两句温暖的话问候，调用 getTasks 概括今天任务，如有迁移用一句话总结。整体回复 ≤180 字，语气温暖简洁，不提及本系统提示，不展示工具调用细节。`,
          });
        }, 0);
      }
    } catch {
      // 旧对话的 tool-call input 缺 importance/category 等字段，触发类型校验失败
      // 直接清掉旧对话记录，避免每次加载都崩溃
      void clearConversation();
    }
  };

  // 挂载时优先从 indexedDB 加载缓存的对话（提升首次渲染速度）
  useEffect(() => {
    idbGet<{
      id: string;
      messages: UIMessage[];
      updatedAt: string;
    }>("conversation:latest").then((cached) => {
      if (cached && displayedUpdatedAtRef.current === null) {
        displayedUpdatedAtRef.current = cached.updatedAt;
        applyConversationData(cached);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SWR 加载：与 indexedDB 缓存比对，仅在新版本时更新
  useEffect(() => {
    if (!convData) return;
    if (!convData.conversation) {
      // 服务端无对话，清空 indexedDB 缓存
      if (displayedUpdatedAtRef.current !== null) {
        displayedUpdatedAtRef.current = null;
        void idbDelete("conversation:latest");
      }
      return;
    }
    const lastIso = convData.conversation.updatedAt as unknown;
    const serverUpdatedAt =
      typeof lastIso === "string" ? lastIso : new Date().toISOString();
    // 流式进行中不应用服务端数据：此时本地已领先于服务端（如正在生成的新一天
    // 问候），应用旧数据会覆盖本地消息状态并冲掉 indexedDB 缓存。
    // status 变化会重新触发本 effect，流式结束后再做下面的版本比对
    if (status === "submitted" || status === "streaming") return;
    // 仅当服务端版本「更新」时才应用。displayedUpdatedAtRef 与 idb 缓存使用的
    // 是客户端生成的时间戳，与服务端 updatedAt 字符串必然不相等，必须按时间
    // 先后比较（ISO 字符串字典序即时间序），否则服务端旧数据会覆盖本地较新
    // 的对话（如刚完成的新一天问候）并覆写 indexedDB 缓存为旧数据
    if (
      displayedUpdatedAtRef.current !== null &&
      displayedUpdatedAtRef.current >= serverUpdatedAt
    )
      return;
    displayedUpdatedAtRef.current = serverUpdatedAt;
    applyConversationData({
      id: convData.conversation.id,
      messages: convData.conversation.messages ?? [],
      updatedAt: serverUpdatedAt,
    });
    // 更新 indexedDB 缓存
    void idbSet("conversation:latest", {
      id: convData.conversation.id,
      messages: convData.conversation.messages ?? [],
      updatedAt: serverUpdatedAt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convData, setMessages, sendMessage, today, status]);

  // --- 流式结束后同步缓存 ---
  // 对话已由服务端 onEnd 保存，前端仅需刷新任务缓存与 indexedDB 本地缓存。
  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      wasStreamingRef.current = true;
      return;
    }
    if (
      wasStreamingRef.current &&
      status === "ready" &&
      rawMessages.length > 0
    ) {
      wasStreamingRef.current = false;
      // 流式结束后重新校验任务缓存，确保 task-panel 反映工具调用的最新结果。
      // 工具直接写库，revalidate 会拉取最新数据；用 filter matcher 兼容带 range 参数的 key。
      globalMutate(
        (key) => typeof key === "string" && key.startsWith("/api/tasks"),
      );
      // 同步更新 indexedDB 缓存，下次挂载时可秒开
      const messagesWithTimestamp = rawMessages.map((m) => {
        const existing = m.metadata as { createdAt?: string } | undefined;
        if (existing?.createdAt) return m;
        return {
          ...m,
          metadata: {
            ...(m.metadata ?? {}),
            createdAt: new Date().toISOString(),
          },
        };
      });
      const updatedAt = new Date().toISOString();
      displayedUpdatedAtRef.current = updatedAt;
      void idbSet("conversation:latest", {
        id: conversationId ?? "",
        messages: messagesWithTimestamp,
        updatedAt,
      });
    }
  }, [status, rawMessages, conversationId]);

  // --- 追踪每条消息对应的日期 ---
  useEffect(() => {
    if (status === "submitted" || status === "streaming") return;
    const next: Record<string, string> = {};
    for (const msg of messages) {
      const existing = messageDatesRef.current[msg.id];
      if (existing) {
        next[msg.id] = existing;
        continue;
      }
      const meta = msg.metadata as { createdAt?: string } | undefined;
      const created = meta?.createdAt;
      next[msg.id] = created ? created.split("T")[0]! : today;
    }
    if (
      Object.keys(next).length !==
        Object.keys(messageDatesRef.current).length ||
      Object.keys(next).some((k) => next[k] !== messageDatesRef.current[k])
    ) {
      messageDatesRef.current = next;
      setMessageDates(next);
    }
  }, [messages, today, status]);

  // --- 同步工具输出到 tasks SWR 缓存 ---
  // 流式期间每 token 触发一次 messages 更新，但只有最后一条 message 引用变化。
  // 缓存「上次扫描时的最后一条 message 引用」+「上次找到 tool output 的 message 引用」，
  // 下次扫描遇到已扫描过的 message 引用立即停止 → 通常只扫描最后 1 条，O(1) 复杂度。
  useEffect(() => {
    if (messages.length === 0) {
      toolScanRef.current = {
        lastMsg: null,
        tasksMsg: null,
        segsMsg: null,
        latest: null,
        latestSegments: null,
      };
      return;
    }
    const lastMsg = messages[messages.length - 1]!;
    // 最后一条 message 引用未变 → 无新内容，跳过
    if (toolScanRef.current.lastMsg === lastMsg) return;

    const prev = toolScanRef.current;
    let latest = prev.latest;
    let latestSegments = prev.latestSegments;
    let tasksMsg = prev.tasksMsg;
    let segsMsg = prev.segsMsg;

    scan: for (let mi = messages.length - 1; mi >= 0; mi--) {
      const msg = messages[mi]!;
      // 遇到上次找到 tool output 的 message（引用相同）→ 前面已扫描过，停止
      if (msg === tasksMsg || msg === segsMsg) break scan;
      const parts = msg.parts as UIMessage["parts"];
      for (let pi = parts.length - 1; pi >= 0; pi--) {
        const part = parts[pi]!;
        if (
          typeof part.type !== "string" ||
          !part.type.startsWith("tool-") ||
          part.type === "tool-dynamic-tool"
        )
          continue;
        const toolPart = part as {
          type: string;
          state?: string;
          output?: {
            tasksByDate?: TasksByDate;
            segments?: TaskSegment[];
          };
        };
        if (toolPart.state !== "output-available" || !toolPart.output) continue;
        if (!latest && toolPart.output.tasksByDate) {
          latest = toolPart.output.tasksByDate;
          tasksMsg = msg;
        }
        if (!latestSegments && toolPart.output.segments) {
          latestSegments = toolPart.output.segments;
          segsMsg = msg;
        }
        if (latest && latestSegments) break scan;
      }
    }

    toolScanRef.current = {
      lastMsg,
      tasksMsg,
      segsMsg,
      latest,
      latestSegments,
    };

    const isStale = latest
      ? Object.values(latest).some((list) =>
          list.some(
            (t) => t.importance === undefined || t.category === undefined,
          ),
        )
      : false;
    const tasksToSync = latest && !isStale ? latest : null;
    const segsToSync = latestSegments;
    if (
      (tasksToSync && tasksToSync !== lastSyncedTasksRef.current) ||
      (segsToSync && segsToSync !== lastSyncedSegsRef.current)
    ) {
      globalMutate<TasksResponse>(
        "/api/tasks",
        (p) => {
          if (!p) return p;
          return {
            ...p,
            tasksByDate: tasksToSync ?? p.tasksByDate,
            segments: segsToSync ?? p.segments,
          };
        },
        { revalidate: false },
      );
      if (tasksToSync) lastSyncedTasksRef.current = tasksToSync;
      if (segsToSync) lastSyncedSegsRef.current = segsToSync;
    }
  }, [messages, globalMutate]);

  // --- 可见消息 ---
  const visibleMessages = useMemo(
    () =>
      messages.slice(hiddenCount).filter((msg) => {
        const isSystemTrigger =
          msg.role === "user" &&
          msg.parts.some(
            (p) =>
              p.type === "text" &&
              typeof p.text === "string" &&
              p.text.startsWith(SYSTEM_TRIGGER_PREFIX),
          );
        return !isSystemTrigger;
      }),
    [messages, hiddenCount],
  );

  // --- agent 提问（askQuestions 客户端工具） ---
  // 最后一条 assistant 消息中存在 input-available 状态的 askQuestions 调用时，
  // 在输入框上方浮动显示提问面板等待用户作答；同一条消息可能含多次提问，逐个处理
  const pendingAsks = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return [];
    const list: {
      toolCallId: string;
      questions: AskQuestionsInput["questions"];
    }[] = [];
    for (const part of last.parts) {
      if (part.type !== "tool-askQuestions") continue;
      const p = part as {
        state?: string;
        toolCallId?: string;
        input?: AskQuestionsInput;
      };
      if (
        p.state === "input-available" &&
        p.toolCallId &&
        p.input?.questions?.length
      ) {
        list.push({ toolCallId: p.toolCallId, questions: p.input.questions });
      }
    }
    return list;
  }, [messages]);
  const pendingAsk = pendingAsks[0] ?? null;

  /** 提问面板提交/超时：把回答写入工具输出，sendAutomaticallyWhen 会自动继续对话 */
  const handleAskSubmit = (
    answers: AskQuestionsAnswer[],
    timedOut: boolean,
  ) => {
    if (!pendingAsk) return;
    addToolOutput({
      tool: "askQuestions",
      toolCallId: pendingAsk.toolCallId,
      output: {
        answers,
        timedOut,
        skipped: false,
      } satisfies AskQuestionsOutput,
    });
  };

  const busy = status === "submitted" || status === "streaming";

  // --- 任务变更 diff：agent 完成回答后，展示该回答中修改/创建任务的变更 ---
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const lastTaskDiff = useMemo(() => {
    if (
      busy ||
      !lastVisibleMessage ||
      lastVisibleMessage.role !== "assistant"
    ) {
      return [];
    }
    return computeMessageTaskDiff(lastVisibleMessage, today);
  }, [busy, lastVisibleMessage, today]);

  // --- 对话操作：复制 / 删除 / 重新生成 ---
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = async () => {
    const text = visibleMessages
      .at(-1)
      ?.parts.filter(
        (p) =>
          p.type === "text" &&
          typeof p.text === "string" &&
          !p.text.startsWith(SYSTEM_TRIGGER_PREFIX),
      )
      .map((p) => (p as { text: string }).text)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默失败
    }
  };

  const handleConfirmDelete = async () => {
    if (selectedIds.size === 0) {
      setDeleteMode(false);
      return;
    }
    const remaining = rawMessages.filter((m) => !selectedIds.has(m.id));
    setMessages(remaining);
    setDeleteMode(false);
    setSelectedIds(new Set());
    // 同步到服务端
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: conversationId ?? undefined,
          messages: remaining,
        }),
      });
    } catch {
      // 保存失败不阻断 UI
    }
    // 更新 indexedDB 缓存
    const updatedAt = new Date().toISOString();
    displayedUpdatedAtRef.current = updatedAt;
    void idbSet("conversation:latest", {
      id: conversationId ?? "",
      messages: remaining,
      updatedAt,
    });
    // 刷新 SWR 对话缓存
    mutateConv();
  };

  const handleRegenerate = () => {
    if (busy) return;
    regenerate();
  };

  /**
   * ChatInput 提交回调：用户点击发送 / 按 Enter 时触发。
   * params.text 已由 ChatInput 拼入 @ 引用上下文，params.files 为多模态附件。
   * 有悬置的 agent 提问时先全部自动跳过（填入 skipped 输出），
   * 避免历史消息中遗留无结果的工具调用导致后续请求校验失败。
   */
  const handleSend = async (params: SendParams) => {
    if (busy) return;
    for (const ask of pendingAsks) {
      await addToolOutput({
        tool: "askQuestions",
        toolCallId: ask.toolCallId,
        output: {
          answers: [],
          timedOut: false,
          skipped: true,
        } satisfies AskQuestionsOutput,
      });
    }
    sendMessage(
      {
        text: params.text,
        ...(params.files.length > 0 ? { files: params.files } : {}),
      },
      {},
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Bot className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Agent</h2>
      </div>
      <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col px-6 py-4">
        {/* 消息滚动区 + 悬浮层容器（提问面板绝对定位于其上） */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto pr-2"
          >
            <div
              ref={contentRef}
              className={cn("space-y-3", pendingAsk && "pb-64")}
            >
            {visibleMessages.map((msg, idx) => {
              const dateStr = messageDates[msg.id] ?? today;
              const prevDateStr =
                idx > 0
                  ? (messageDates[visibleMessages[idx - 1]!.id] ?? today)
                  : null;
              const showDivider = prevDateStr !== dateStr;
              return (
                <MessageItem
                  key={msg.id}
                  msg={msg}
                  dateStr={dateStr}
                  showDivider={showDivider}
                  today={today}
                  deleteMode={deleteMode}
                  isSelected={selectedIds.has(msg.id)}
                  onToggleSelect={toggleSelect}
                />
              );
            })}
            {/* 任务变更 diff：agent 回答下方、消息 action 上方，可折叠（默认折叠） */}
            {lastTaskDiff.length > 0 && !deleteMode && (
              <TaskDiffView diffs={lastTaskDiff} today={today} />
            )}
            {/* Action 栏：非流式 + 有对话 + 最后一条是 assistant 时显示 */}
            {!busy &&
              visibleMessages.length > 0 &&
              visibleMessages[visibleMessages.length - 1]!.role ===
                "assistant" &&
              (deleteMode ? (
                <div className="sticky flex items-center w-full bg-background gap-2 pt-2 pl-17 -mt-2 bottom-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => {
                      setDeleteMode(false);
                      setSelectedIds(new Set());
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    disabled={selectedIds.size === 0}
                    onClick={handleConfirmDelete}
                  >
                    <Trash2 className="size-3" />
                    删除{selectedIds.size > 0 ? `（${selectedIds.size}）` : ""}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1 pl-9 -mt-2 text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={handleCopy}
                        />
                      }
                    >
                      {copied ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      {copied ? "已复制" : "复制对话内容"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => setDeleteMode(true)}
                        />
                      }
                    >
                      <Trash2 className="size-3" />
                    </TooltipTrigger>
                    <TooltipContent>选择并删除对话</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={handleRegenerate}
                        />
                      }
                    >
                      <RefreshCw className="size-3" />
                    </TooltipTrigger>
                    <TooltipContent>重新生成</TooltipContent>
                  </Tooltip>
                </div>
              ))}
            {busy && (
              <div className="flex gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <Bot className="size-3.5" />
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-muted px-3.5 py-2.5">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                  <span
                    className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                    style={{ animationDelay: "0.3s" }}
                  />
                </div>
              </div>
            )}
            </div>
          </div>

          {/* agent 提问面板：悬浮于消息滚动容器之上（不占布局宽度），
              3 分钟未答自动提交 */}
          {pendingAsk && (
            <div className="absolute inset-x-2 bottom-2 z-10 sm:left-auto sm:w-96">
              <AskQuestionsPanel
                key={pendingAsk.toolCallId}
                questions={pendingAsk.questions}
                onSubmit={handleAskSubmit}
              />
            </div>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-destructive">
            出错了：{error.message}
          </p>
        )}

        <ChatInput
          busy={busy}
          currentModelMultimodal={currentModelMultimodal}
          onSend={handleSend}
          onStop={stop}
        />
      </div>
    </section>
  );
}
