"use client";

import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bot,
  Check,
  Copy,
  Layers,
  Mic,
  Paperclip,
  RefreshCw,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { MessageItem } from "@/components/home/message-item";
import { useHomeStore } from "@/lib/home/store";
import { Button } from "@/components/ui/button";
import { cn, fetcher } from "@/lib/utils";
import {
  HISTORY_LOAD_BATCH,
  SYSTEM_TRIGGER_PREFIX,
  type TasksResponse,
} from "@/lib/home/constants";
import type {
  ConversationRow,
  TaskSegment,
  TasksByDate,
} from "@/lib/db/queries";
import type { UserPreferences } from "@/lib/db/schema";
import { idbGet, idbSet, idbDelete } from "@/lib/idb";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRecording } from "@/hooks/use-recording";
import { useDroppable } from "@dnd-kit/react";

type ConversationResponse = { conversation: ConversationRow | null };

/**
 * AI 对话面板：从 app/page.tsx 抽离的全部对话逻辑。
 *
 * 私有状态（仅 ChatPanel 内部使用，不进 store）：
 * - useChat（messages / sendMessage / status / stop / setMessages）
 * - input（输入框文本）
 * - conversationId（当前对话 ID）
 * - hiddenCount（折叠的旧消息数量，上滑加载更多时释放）
 * - messageDates（每条消息对应的日期，用于日期分割线）
 * - 各类滚动 ref
 *
 * 从 store 读取：today、clearConversationNonce（外部清空信号）
 * SWR：/api/conversations（历史对话加载）
 * 全局 mutate：/api/tasks（工具输出同步到任务缓存）
 */
export function ChatPanel() {
  const today = useHomeStore((s) => s.today);
  const clearNonce = useHomeStore((s) => s.clearConversationNonce);
  const chatTaskRefs = useHomeStore((s) => s.chatTaskRefs);
  const removeChatTaskRef = useHomeStore((s) => s.removeChatTaskRef);
  const clearChatTaskRefs = useHomeStore((s) => s.clearChatTaskRefs);
  const addChatTaskRef = useHomeStore((s) => s.addChatTaskRef);
  const { mutate: globalMutate } = useSWRConfig();

  // 对话输入区作为拖拽放置目标：拖入任务可添加为 agent 参考（dnd-kit）
  const { ref: chatDropRef, isDropTarget: isChatDropTarget } = useDroppable({
    id: "chat-input",
    accept: "task",
  });

  // --- useChat ---
  // 仅发送最后一条 message（含 createdAt 元数据），服务端从 DB 加载历史消息
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1]!;
          // 为用户消息补充 createdAt（assistant 消息由服务端 messageMetadata 注入）
          const messageWithMeta = {
            ...last,
            metadata: {
              ...(last.metadata ?? {}),
              createdAt: new Date().toISOString(),
            },
          };
          return {
            body: {
              ...body,
              message: messageWithMeta,
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
  } = useChat({ transport });

  // useDeferredValue：工具调用流式时 parsePartialJson 每 token 阻塞主线程，
  // 用 deferred 延迟渲染让浏览器在 token 间隙能响应用户输入。
  // 保存对话的 effect 用 rawMessages 确保数据实时性。
  const messages = useDeferredValue(rawMessages);

  // --- 私有状态 ---
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  // 删除模式：显示 checkbox 供用户选择要删除的 message
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 复制成功反馈
  const [copied, setCopied] = useState(false);
  const foldKey = `heyterx:fold:${today}`;
  const [hiddenCount, setHiddenCount] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = window.localStorage?.getItem(`heyterx:fold:${today}`);
    const n = stored ? parseInt(stored, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  // 防止新一天问候在 sendMessage 与 setMessages 竞态下重复触发
  const greetingInFlightRef = useRef(false);

  // --- 滚动 ref ---
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoStickRef = useRef(true);
  const pendingScrollRestoreRef = useRef<{
    prevScrollHeight: number;
    prevScrollTop: number;
  } | null>(null);
  const loadingMoreRef = useRef(false);

  // --- 消息日期 ---
  const messageDatesRef = useRef<Record<string, string>>({});
  const [messageDates, setMessageDates] = useState<Record<string, string>>({});

  // --- SWR：历史对话 ---
  const { data: convData, mutate: mutateConv } = useSWR<ConversationResponse>(
    "/api/conversations",
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  // --- SWR：用户偏好（用于判断当前默认模型是否多模态） ---
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

  // --- 附件管理 ---
  type PendingAttachment = {
    id: string;
    file: File;
    dataUrl: string; // object URL for preview
    mediaType: string;
  };
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const next: PendingAttachment[] = arr.map((f) => ({
      id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      dataUrl: URL.createObjectURL(f),
      mediaType: f.type || "application/octet-stream",
    }));
    setAttachments((prev) => [...prev, ...next]);
  };
  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found) URL.revokeObjectURL(found.dataUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  // --- 语音输入 ---
  const [transcribing, setTranscribing] = useState(false);
  const {
    recording,
    start: startRecording,
    stop: stopRecording,
  } = useRecording({
    onStop: async (blob) => {
      setTranscribing(true);

      try {
        const form = new FormData();
        form.append("file", blob, "voice.wav");
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (data?.text) {
          setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
        }
      } catch {
        // 静默失败，不影响输入
      } finally {
        setTranscribing(false);
      }
    },
  });

  useEffect(() => {
    return () => {
      // 卸载时释放资源
      attachments.forEach((a) => URL.revokeObjectURL(a.dataUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setHiddenCount(0);
    setDeleteMode(false);
    setSelectedIds(new Set());
    greetingInFlightRef.current = false;
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(foldKey);
    }
    messageDatesRef.current = {};
    setMessageDates({});
    autoStickRef.current = true;
    pendingScrollRestoreRef.current = null;
    loadingMoreRef.current = false;
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
    // 已展示相同版本 → 跳过（indexedDB 缓存已足够）
    if (displayedUpdatedAtRef.current === serverUpdatedAt) return;
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
  }, [convData, setMessages, sendMessage, today]);

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

  // --- 自动吸底 ---
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoStickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // --- 内容尺寸变化时跟随吸底 ---
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (autoStickRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // --- 上滑加载更多后还原视口位置 ---
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const restore = pendingScrollRestoreRef.current;
    if (!restore) return;
    pendingScrollRestoreRef.current = null;
    const added = el.scrollHeight - restore.prevScrollHeight;
    el.scrollTop = restore.prevScrollTop + added;
    loadingMoreRef.current = false;
  }, [hiddenCount]);

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
            (t) =>
              t.importance === undefined ||
              t.category === undefined ||
              !Array.isArray(t.tags),
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

  // --- 滚动事件 ---
  const handleConversationScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    autoStickRef.current = atBottom;
    if (el.scrollTop < 50 && hiddenCount > 0 && !loadingMoreRef.current) {
      loadingMoreRef.current = true;
      pendingScrollRestoreRef.current = {
        prevScrollHeight: el.scrollHeight,
        prevScrollTop: el.scrollTop,
      };
      setHiddenCount((c) => Math.max(0, c - HISTORY_LOAD_BATCH));
      if (typeof window !== "undefined") {
        const remain = Math.max(0, hiddenCount - HISTORY_LOAD_BATCH);
        if (remain > 0) {
          window.localStorage?.setItem(foldKey, String(remain));
        } else {
          window.localStorage?.removeItem(foldKey);
        }
      }
    }
  };

  const busy = status === "submitted" || status === "streaming";

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

  const submit = () => {
    const text = input.trim();
    const hasAttachments = attachments.length > 0;
    const hasTaskRefs = chatTaskRefs.length > 0;
    if ((!text && !hasAttachments && !hasTaskRefs) || busy) return;
    // 多模态附件：转 FileUIPart 传给 sendMessage 的 files
    const files = attachments.map((a) => ({
      type: "file" as const,
      mediaType: a.mediaType,
      filename: a.file.name,
      url: a.dataUrl,
    }));
    // 任务参考：作为前缀拼入消息文本，让 agent 知道用户引用了哪些任务
    let messageText = text;
    if (hasTaskRefs) {
      const refList = chatTaskRefs
        .map((r) => `- ${r.title}（日期: ${r.date}，ID: ${r.taskId}）`)
        .join("\n");
      messageText = `【参考任务】\n${refList}\n\n${
        text || "请参考以上任务信息来处理我的请求"
      }`;
    }
    sendMessage(
      {
        text: messageText || (hasAttachments ? "（请查看附件）" : ""),
        ...(hasAttachments ? { files } : {}),
      },
      {},
    );
    setInput("");
    // 清理附件 object URL
    attachments.forEach((a) => URL.revokeObjectURL(a.dataUrl));
    setAttachments([]);
    if (hasTaskRefs) clearChatTaskRefs();
  };

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    submit();
  };

  // Enter 发送，Shift+Enter 换行；输入法组合中（composing）不触发
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Bot className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Agent</h2>
      </div>
      <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col px-6 py-4">
        <div
          ref={scrollRef}
          onScroll={handleConversationScroll}
          className="min-h-0 flex-1 overflow-y-auto pr-2"
        >
          <div ref={contentRef} className="space-y-3">
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

        {error && (
          <p className="mt-2 text-xs text-destructive">
            出错了：{error.message}
          </p>
        )}

        <form ref={chatDropRef} className="mt-3" onSubmit={handleSubmit}>
          <InputGroup
            className={cn(
              isChatDropTarget && "border-ring ring-3 ring-ring/50",
            )}
          >
            <InputGroupTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如「把今天的 t3 标记为完成」或「明天加一个任务：买菜」"
              rows={1}
              className="max-h-40 min-h-9 resize-none rounded-2xl bg-background py-2.5 pr-12 text-sm leading-snug"
            />
            {/* 拖入的任务参考预览 */}
            {chatTaskRefs.length > 0 && (
              <InputGroupAddon align="block-start" className="px-2 pt-2">
                <div className="flex flex-wrap gap-2">
                  {chatTaskRefs.map((ref) => (
                    <div
                      key={ref.id}
                      className="group flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-[11px]"
                    >
                      <Layers className="size-3 shrink-0 text-muted-foreground" />
                      <span className="max-w-32 truncate">{ref.title}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {ref.date}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeChatTaskRef(ref.id)}
                        className="ml-0.5 text-muted-foreground hover:text-foreground"
                        aria-label="移除任务参考"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </InputGroupAddon>
            )}
            {/* 多模态附件预览 */}
            {attachments.length > 0 && (
              <InputGroupAddon align="block-start" className="px-2 pt-2">
                <div className="flex flex-wrap gap-2">
                  {attachments.map((a) => {
                    const top = a.mediaType.split("/")[0];
                    return (
                      <div
                        key={a.id}
                        className="group relative size-16 overflow-hidden rounded-md border bg-muted"
                      >
                        {top === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.dataUrl}
                            alt={a.file.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full flex-col items-center justify-center gap-0.5 p-1 text-[10px] text-muted-foreground">
                            <Paperclip className="size-3.5" />
                            <span className="w-full truncate text-center">
                              {a.file.name}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.id)}
                          className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label="移除附件"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </InputGroupAddon>
            )}
            <InputGroupAddon align="block-end" className="justify-between pt-1">
              <div className="flex items-center gap-1">
                {/* 附件按钮（非多模态模型禁用） */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={
                          currentModelMultimodal
                            ? "上传附件"
                            : "当前模型不支持多模态附件"
                        }
                        disabled={!currentModelMultimodal}
                        onClick={() => fileInputRef.current?.click()}
                        className="size-7 disabled:pointer-events-auto"
                      />
                    }
                  >
                    <Paperclip className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {currentModelMultimodal
                      ? "上传附件"
                      : "当前模型不支持多模态附件"}
                  </TooltipContent>
                </Tooltip>
                {/* 语音输入按钮 */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="button"
                        variant={recording ? "destructive" : "ghost"}
                        size="icon-sm"
                        aria-label={recording ? "停止录音" : "语音输入"}
                        onClick={() =>
                          recording ? stopRecording() : startRecording()
                        }
                        disabled={transcribing || busy}
                        className="size-7"
                      />
                    }
                  >
                    {transcribing ? (
                      <span className="size-3.5 animate-pulse">…</span>
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    {transcribing
                      ? "识别中…"
                      : recording
                        ? "停止录音"
                        : "语音输入"}
                  </TooltipContent>
                </Tooltip>
              </div>
              {busy ? (
                <InputGroupButton
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="停止"
                  onClick={() => stop()}
                  className="size-7"
                >
                  <Square className="size-3.5" />
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  aria-label="发送"
                  disabled={
                    !input.trim() &&
                    attachments.length === 0 &&
                    chatTaskRefs.length === 0
                  }
                  className="size-7"
                >
                  <Send className="size-3.5" />
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,audio/*,video/*"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </form>
      </div>
    </section>
  );
}
