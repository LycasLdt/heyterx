"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import {
  Bot,
  Brain,
  ChevronRight,
  Copy,
  Check,
  Download,
  FileText,
  Music,
  RefreshCw,
  Trash2,
  User,
  Video,
  Wrench,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { cn, date } from "@/lib/utils";
import {
  HIDDEN_TOOLS,
  SYSTEM_TRIGGER_PREFIX,
  TOOL_LABELS,
} from "@/lib/home/constants";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

/**
 * 推理过程区块：与工具调用相似的胶囊样式，使用 Brain icon，
 * hover 时切换为「>」icon，点击展开推理文本。
 */
function ReasoningBlock({ text, state }: { text: string; state?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const prevStateRef = useRef(state);

  // 思考完成（streaming → done）时自动折叠
  useEffect(() => {
    if (prevStateRef.current === "streaming" && state === "done") {
      setExpanded(false);
    }
    prevStateRef.current = state;
  }, [state]);

  const isStreaming = state === "streaming";

  return (
    <Collapsible
      open={expanded}
      className="group flex flex-col gap-2 rounded-lg border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-[width]"
      onOpenChange={(open) => setExpanded(open)}
    >
      <CollapsibleTrigger
        className="inline-flex gap-1.5 w-full self-start hover:text-foreground"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hovered ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
        ) : (
          <Brain className="size-3 shrink-0" />
        )}
        {isStreaming ? (
          <span
            className="font-medium"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--muted-foreground) 0%, var(--primary) 50%, var(--muted-foreground) 100%)",
              backgroundSize: "200% auto",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
              animation: "thinking-shimmer 2s linear infinite",
            }}
          >
            思考中
          </span>
        ) : (
          <span className="font-medium">思考完成</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) whitespace-pre-wrap overflow-hidden transition-[height] data-ending-style:h-0 data-starting-style:h-0">
        {text || (isStreaming ? "…" : "（无内容）")}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 单条对话消息的纯展示组件。
 * 用 React.memo 包裹：流式过程中 useChat 的 messages 每个 token 都更新，
 * 但旧消息的 msg 引用不变 → memo 跳过重渲染，只有正在流式的那条消息重渲染。
 * 这是解决「agent 工具调用 input 庞大时浏览器卡死」的关键优化。
 */
export const MessageItem = memo(function MessageItem({
  msg,
  dateStr,
  showDivider,
  today,
  deleteMode = false,
  isSelected = false,
  onToggleSelect,
}: {
  msg: UIMessage;
  dateStr: string;
  showDivider: boolean;
  today: string;
  deleteMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  return (
    <>
      {showDivider && (
        <div className="my-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>{date.formatDateDivider(dateStr, today)}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      <div
        className={cn(
          "flex gap-2.5",
          msg.role === "user" ? "flex-row-reverse" : "flex-row",
          deleteMode && "cursor-pointer",
        )}
        onClick={
          deleteMode && onToggleSelect
            ? () => onToggleSelect(msg.id)
            : undefined
        }
      >
        {deleteMode && (
          <div
            className={cn(
              "flex size-5 shrink-0 items-center justify-center self-center rounded border-2 transition-colors",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40 bg-background",
            )}
          >
            {isSelected && <Check className="size-3" />}
          </div>
        )}
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full",
            msg.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
            deleteMode && isSelected && "opacity-50",
          )}
        >
          {msg.role === "user" ? (
            <User className="size-3.5" />
          ) : (
            <Bot className="size-3.5" />
          )}
        </div>
        <div
          className={cn(
            "flex max-w-[80%] flex-col gap-1.5",
            msg.role === "user" ? "items-end" : "items-start",
          )}
        >
          {msg.parts.map((part, i) => {
            const key = `${msg.id}-${i}`;
            if (part.type === "reasoning") {
              const reasoningPart = part as {
                type: string;
                text: string;
                state?: string;
              };
              // 思考刚开始时 text 可能为空，但 streaming 状态仍需显示「思考中」
              if (!reasoningPart.text && reasoningPart.state !== "streaming") {
                return null;
              }
              return (
                <ReasoningBlock
                  key={key}
                  text={reasoningPart.text}
                  state={reasoningPart.state}
                />
              );
            }
            if (part.type === "text") {
              if (!part.text) return null;
              // 系统触发消息（如新一天问候）不向用户展示
              if (
                msg.role === "user" &&
                part.text.startsWith(SYSTEM_TRIGGER_PREFIX)
              ) {
                return null;
              }
              const isStreaming = part.state === "streaming";
              const isAssistant = msg.role === "assistant";
              return (
                <div
                  key={key}
                  className={cn(
                    "max-w-full rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    isAssistant
                      ? "bg-muted text-foreground"
                      : "bg-primary text-primary-foreground",
                  )}
                >
                  {isAssistant && !isStreaming ? (
                    <Markdown content={part.text} />
                  ) : (
                    <span className="whitespace-pre-wrap wrap-break-word">
                      {part.text}
                    </span>
                  )}
                </div>
              );
            }
            // 多模态附件（图片 / 音频 / 视频 / 文件）
            if (part.type === "file") {
              const mt = part.mediaType ?? "";
              const top = mt.split("/")[0];
              if (top === "image") {
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={key}
                    src={part.url}
                    alt={part.filename ?? "图片"}
                    className="max-h-60 max-w-[80%] rounded-2xl border object-contain"
                  />
                );
              }
              const Icon =
                top === "audio" ? Music : top === "video" ? Video : FileText;
              return (
                <div
                  key={key}
                  className="flex max-w-[80%] items-center gap-2 rounded-2xl border bg-muted px-3 py-2 text-xs text-muted-foreground"
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">
                    {part.filename ?? `${top || "文件"} 附件`}
                  </span>
                </div>
              );
            }
            if (
              typeof part.type === "string" &&
              part.type.startsWith("tool-") &&
              part.type !== "tool-dynamic-tool"
            ) {
              const toolName = part.type.slice(5);
              // 记忆系统相关工具调用对用户不可见
              if (HIDDEN_TOOLS.has(toolName)) return null;
              const toolPart = part as {
                type: string;
                state?: string;
                input?: unknown;
                output?: {
                  pathname?: string;
                  filename?: string;
                  count?: number;
                  error?: string;
                };
              };
              const label = TOOL_LABELS[toolName] ?? toolName;
              const stateLabel =
                toolPart.state === "output-available"
                  ? "完成"
                  : toolPart.state === "output-error"
                    ? "出错"
                    : toolName === "askQuestions"
                      ? "等待回答…"
                      : "调用中…";

              // exportTasks 工具输出特殊渲染：文件下载卡片
              if (
                toolName === "exportTasks" &&
                toolPart.state === "output-available" &&
                toolPart.output
              ) {
                const out = toolPart.output;
                if (out.error) {
                  return (
                    <div
                      key={key}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive"
                    >
                      <Wrench className="size-3" />
                      <span>导出失败</span>
                      <span className="text-destructive/70">· {out.error}</span>
                    </div>
                  );
                }
                if (out.pathname) {
                  // 私有 Blob：经 /api/export 中转下载（带鉴权 + 跨用户隔离）
                  const downloadUrl = `/api/export?path=${encodeURIComponent(out.pathname)}&filename=${encodeURIComponent(out.filename ?? "任务计划.pdf")}`;
                  return (
                    <a
                      key={key}
                      href={downloadUrl}
                      download={out.filename}
                      className="flex max-w-[80%] items-center gap-3 rounded-2xl border bg-muted px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/70"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {out.filename ?? "任务计划.pdf"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          PDF · {out.count ?? 0} 项任务 · 点击下载
                        </div>
                      </div>
                      <Download className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                  );
                }
              }

              return (
                <div
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                >
                  <Wrench className="size-3" />
                  <span>{label}</span>
                  <span className="text-muted-foreground/70">
                    · {stateLabel}
                  </span>
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </>
  );
});
