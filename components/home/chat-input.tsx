"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/react";
import {
  CalendarRange,
  Layers,
  Mic,
  Paperclip,
  Send,
  Square,
  SquareCheck,
  X,
} from "lucide-react";
import { MentionAutocomplete } from "@/components/home/mention-autocomplete";
import {
  buildMentionContext,
  buildMentionSuggestions,
  extractMentions,
  findAllMentionRanges,
  type MentionCtx,
  type MentionSuggestion,
  type ResolvedMention,
} from "@/lib/home/mentions";
import { useHomeStore } from "@/lib/home/store";
import { useTasks } from "@/lib/home/use-tasks";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRecording } from "@/hooks/use-recording";
import { cn } from "@/lib/utils";

/** 附件预览项 */
export type PendingAttachment = {
  id: string;
  file: File;
  dataUrl: string;
  mediaType: string;
};

/** 发送给 ChatPanel 的文件参数（ai-sdk FileUIPart 格式） */
type SendFile = {
  type: "file";
  mediaType: string;
  filename: string;
  url: string;
};

export type SendParams = {
  text: string;
  files: SendFile[];
};

/**
 * 对话输入区：contenteditable editor + @ 引用 chip + autocomplete + 附件 + 语音。
 *
 * 从 chat-panel 抽离，避免父组件过于复杂。所有输入相关状态、editor DOM 管理、
 * autocomplete 浮层、拖拽放置、附件与录音均在此组件内部闭环。
 *
 * 对外接口：
 * - onSend：用户提交（Enter / 点击发送）时调用，接收最终消息文本与附件
 * - onStop：流式中点击停止按钮
 */
export function ChatInput({
  busy,
  currentModelMultimodal,
  onSend,
  onStop,
}: {
  busy: boolean;
  currentModelMultimodal: boolean;
  onSend: (params: SendParams) => Promise<void>;
  onStop: () => void;
}) {
  const today = useHomeStore((s) => s.today);
  const chatMention = useHomeStore((s) => s.chatMention);
  const clearChatMention = useHomeStore((s) => s.clearChatMention);
  const { data: tasksData } = useTasks();

  // 对话输入区作为拖拽放置目标
  const { ref: chatDropRef, isDropTarget: isChatDropTarget } = useDroppable({
    id: "chat-input",
    accept: "task",
  });

  // --- contenteditable editor refs ---
  const editorRef = useRef<HTMLDivElement | null>(null);
  const iconTemplateRef = useRef<HTMLDivElement | null>(null);
  // 本地输入标志：onInput 触发的 setInput 跳过 renderEditor，避免光标跳动
  const localInputRef = useRef(false);
  // renderEditor 后需要恢复的光标位置（selectMention / 拖拽插入时设置）
  const pendingCursorRef = useRef<number | null>(null);

  // --- input state ---
  const [input, setInput] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionQuery, setMentionQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const mentionOpen = mentionStart >= 0;
  // editor 是否为空（用于 placeholder 显示）。input 同步自 parseEditor，
  // 零宽空格已剥离，故空字符串即代表 editor 无可见内容
  const isEmpty = input.length === 0;

  const mentionCtx = useMemo<MentionCtx>(
    () => ({
      tasksByDate: tasksData.tasksByDate,
      segments: tasksData.segments,
      today,
    }),
    [tasksData.tasksByDate, tasksData.segments, today],
  );
  const suggestions = useMemo(
    () => (mentionOpen ? buildMentionSuggestions(mentionQuery, mentionCtx) : []),
    [mentionOpen, mentionQuery, mentionCtx],
  );
  // 推荐列表变化时重置键盘导航索引
  useEffect(() => {
    setActiveIdx(0);
  }, [suggestions]);

  // --- mention chip helpers ---

  const getMentionLabel = (ref: ResolvedMention): string =>
    ref.kind === "segment"
      ? ref.segment.name
      : ref.kind === "date"
        ? ref.start === ref.end
          ? ref.start
          : `${ref.start} ~ ${ref.end}`
        : ref.task.title;

  const getMentionId = (ref: ResolvedMention): string =>
    ref.kind === "segment"
      ? ref.segment.id
      : ref.kind === "date"
        ? `${ref.start}|${ref.end}`
        : ref.task.id;

  /**
   * 创建不可编辑的 mention chip span 节点。
   * 内部包含：icon（从模板 cloneNode）+ 标签文本 + 删除按钮。
   * dataset.mentionText 存储 `@xxx` 原文，parseEditor 时还原。
   * group/mention-chip 让删除按钮在 hover 时才显示。
   */
  const createMentionSpan = (ref: ResolvedMention): HTMLSpanElement => {
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.mention = ref.kind;
    span.dataset.mentionId = getMentionId(ref);
    span.dataset.mentionText = `@${ref.mention}`;
    span.setAttribute("spellcheck", "false");
    span.className =
      "group/mention-chip inline-flex items-center gap-1 rounded-md border bg-muted/50 py-0.5 pl-1.5 pr-1 align-middle text-xs";

    // icon：从隐藏模板 cloneNode
    const iconTpl = iconTemplateRef.current?.querySelector(
      `[data-icon="${ref.kind}"]`,
    );
    if (iconTpl) {
      span.appendChild(iconTpl.cloneNode(true));
    }

    // 标签文本
    const labelEl = document.createElement("span");
    labelEl.className = "max-w-32 truncate";
    labelEl.textContent = getMentionLabel(ref);
    span.appendChild(labelEl);

    // 删除按钮（hover chip 时显示）
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/mention-chip:opacity-100";
    btn.dataset.mentionAction = "remove";
    btn.setAttribute("aria-label", "移除引用");
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    span.appendChild(btn);

    return span;
  };

  /** 将一段纯文本追加到 editor：换行符渲染为 <br>，空行保留占位 <br>。 */
  const appendTextChunk = (editor: HTMLDivElement, chunk: string) => {
    const lines = chunk.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) editor.appendChild(document.createElement("br"));
      const line = lines[i]!;
      if (line) editor.appendChild(document.createTextNode(line));
    }
  };

  /**
   * 将 input 纯文本渲染为 editor DOM。
   * 扫描所有 @xxx 引用，将有效引用替换为不可编辑的 mention chip。
   */
  const renderEditor = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const ranges = findAllMentionRanges(text, mentionCtx);

    editor.replaceChildren();
    let lastIdx = 0;
    for (const range of ranges) {
      if (range.start > lastIdx) {
        appendTextChunk(editor, text.slice(lastIdx, range.start));
      }
      const span = createMentionSpan(range.ref);
      editor.appendChild(span);
      lastIdx = range.end;
    }
    if (lastIdx < text.length) {
      appendTextChunk(editor, text.slice(lastIdx));
    }
    // 末尾放一个零宽空格，确保光标能定位在 editor 末尾
    if (editor.childNodes.length === 0) {
      editor.appendChild(document.createTextNode("\u200B"));
    }

    // 恢复光标位置
    if (pendingCursorRef.current !== null) {
      setCursorOffset(pendingCursorRef.current);
      pendingCursorRef.current = null;
    }
  };

  /** 递归将 DOM 节点还原为文本。非断空格（\u00A0）规范化为普通空格，保证含空格的任务名可匹配。 */
  const nodeToText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/\u00A0/g, " ");
    }
    if (node instanceof HTMLElement) {
      if (node.dataset.mention) {
        return node.dataset.mentionText ?? `@${node.textContent?.slice(1) ?? ""}`;
      }
      if (node.tagName === "BR") {
        return "\n";
      }
      let text = "";
      for (const child of Array.from(node.childNodes)) {
        text += nodeToText(child);
      }
      return text;
    }
    return "";
  };

  /** 将 editor DOM 解析回 input 纯文本（含零宽空格剥离） */
  const parseEditor = (): string => {
    const editor = editorRef.current;
    if (!editor) return "";
    let text = "";
    for (const node of Array.from(editor.childNodes)) {
      text += nodeToText(node);
    }
    return text.replace(/\u200B/g, "");
  };

  /** 获取光标在 editor 中的字符偏移 */
  const getCursorOffset = (): number => {
    const editor = editorRef.current;
    if (!editor) return 0;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !editor.contains(sel.anchorNode)) {
      return editor.textContent?.length ?? 0;
    }
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(sel.anchorNode!, sel.anchorOffset);
    return range.toString().length;
  };

  /** 将光标设置到 editor 中指定的字符偏移位置 */
  const setCursorOffset = (offset: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel) return;
    let remaining = offset;
    let targetNode: Node | null = null;
    let targetOffset = 0;
    const walk = (node: Node) => {
      if (targetNode) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent?.length ?? 0;
        if (remaining <= len) {
          targetNode = node;
          targetOffset = remaining;
          return;
        }
        remaining -= len;
      } else if (node instanceof HTMLElement) {
        if (node.dataset.mention) {
          const len = node.dataset.mentionText?.length ?? 0;
          if (remaining < len) {
            targetNode = node.parentNode;
            targetOffset =
              Array.from(node.parentNode!.childNodes).indexOf(node) + 1;
            return;
          }
          remaining -= len;
        } else if (node.tagName === "BR") {
          if (remaining <= 0) {
            targetNode = node.parentNode;
            targetOffset = Array.from(node.parentNode!.childNodes).indexOf(node);
            return;
          }
          remaining -= 1;
        } else {
          for (const child of Array.from(node.childNodes)) {
            walk(child);
            if (targetNode) return;
          }
        }
      }
    };
    walk(editor);
    if (!targetNode) {
      targetNode = editor;
      targetOffset = editor.childNodes.length;
    }
    const range = document.createRange();
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();
  };

  /** editor onInput：解析 DOM → setInput，设置 localInput 跳过 renderEditor */
  const handleEditorInput = () => {
    const text = parseEditor();
    localInputRef.current = true;
    setInput(text);
    detectMention(text, getCursorOffset());
  };

  /** editor onKeyUp/onPointerUp：更新光标位置（autocomplete 打开时重新检测） */
  const handleEditorSelect = () => {
    if (mentionOpen) {
      detectMention(parseEditor(), getCursorOffset());
    }
  };

  /** 扫描 input 当前光标位置，判断是否处于 @ 引用上下文 */
  const detectMention = (val: string, cursor: number) => {
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx < 0) {
      setMentionStart(-1);
      return;
    }
    // @ 必须出现在行首或前面是空白字符
    if (atIdx > 0 && !/\s/.test(val[atIdx - 1]!)) {
      setMentionStart(-1);
      return;
    }
    // query 允许含空格（任务名可含空格），规范化非断空格
    const query = val.slice(atIdx + 1, cursor).replace(/\u00A0/g, " ");
    setMentionStart(atIdx);
    setMentionQuery(query);
  };

  /**
   * 选中某条推荐：把 input 中 `@query` 替换为 `@<insertText> `。
   * 修复：正确移除原始 @query（从 mentionStart 到 mentionStart+1+mentionQuery.length），
   * 而非从 mentionStart 开始截取（否则 @query 会残留到 chip 之后）。
   */
  const selectMention = (item: MentionSuggestion) => {
    const before = input.slice(0, mentionStart);
    const after = input.slice(mentionStart + 1 + mentionQuery.length);
    const insert = `@${item.insertText} `;
    const next = before + insert + after;
    pendingCursorRef.current = (before + insert).length;
    setInput(next);
    setMentionStart(-1);
  };

  /** 从外部（拖拽 / 语音）追加 @ 引用到 input 末尾 */
  const appendMention = (mentionText: string) => {
    setInput((prev) => {
      const sep = prev && !/\s$/.test(prev) ? " " : "";
      const next = `${prev}${sep}@${mentionText} `;
      pendingCursorRef.current = next.length;
      return next;
    });
    setMentionStart(-1);
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  // --- input → editor 同步 ---
  // input 变化时渲染 editor；本地输入（onInput 触发的 setInput）跳过渲染，避免光标跳动
  useEffect(() => {
    if (localInputRef.current) {
      localInputRef.current = false;
      return;
    }
    renderEditor(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, mentionCtx]);

  // 挂载时渲染初始 editor
  useEffect(() => {
    renderEditor(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 拖拽任务到对话框 → 末尾追加 @<任务名> ---
  const prevMentionNonceRef = useRef(0);
  useEffect(() => {
    if (!chatMention) return;
    if (prevMentionNonceRef.current === chatMention.nonce) return;
    prevMentionNonceRef.current = chatMention.nonce;
    appendMention(chatMention.text);
    clearChatMention();
  }, [chatMention, clearChatMention]);

  // --- 附件管理 ---
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
  const { recording, start: startRecording, stop: stopRecording } = useRecording({
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
          setInput((prev) => {
            const next = prev ? `${prev} ${data.text}` : data.text;
            pendingCursorRef.current = next.length;
            return next;
          });
        }
      } catch {
        // 静默失败，不影响输入
      } finally {
        setTranscribing(false);
      }
    },
  });

  // 卸载时释放附件资源
  useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.dataUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 提交 ---
  const submit = async () => {
    const text = input.trim();
    const hasAttachments = attachments.length > 0;
    if ((!text && !hasAttachments) || busy) return;
    // 「@」引用：解析 input 中的所有 @ 引用，构建上下文前缀拼入消息文本
    const refs = extractMentions(text, mentionCtx);
    let messageText = text;
    if (refs.length > 0) {
      messageText = `${buildMentionContext(refs)}\n\n${
        text || "请参考以上任务信息来处理我的请求"
      }`;
    }
    const files = attachments.map((a) => ({
      type: "file" as const,
      mediaType: a.mediaType,
      filename: a.file.name,
      url: a.dataUrl,
    }));
    await onSend({
      text: messageText || (hasAttachments ? "（请查看附件）" : ""),
      files,
    });
    setInput("");
    setMentionStart(-1);
    // 清理附件 object URL
    attachments.forEach((a) => URL.revokeObjectURL(a.dataUrl));
    setAttachments([]);
  };

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    void submit();
  };

  // Enter 发送，Shift+Enter 换行；输入法组合中（composing）不触发
  // autocomplete 打开时：↑↓ 导航、Enter/Tab 选中、Esc 关闭
  // focus 始终保持在 editor 上（autocomplete 浮层用 plain div，无 focus 管理）
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (mentionOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = suggestions[activeIdx] ?? suggestions[0];
        if (item) selectMention(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionStart(-1);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form ref={chatDropRef} className="relative mt-3" onSubmit={handleSubmit}>
      {/* 「@」引用 autocomplete：绝对定位 plain div（不使用 Popover，避免 focus 跳转） */}
      {mentionOpen && suggestions.length > 0 && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <MentionAutocomplete
            items={suggestions}
            activeIndex={activeIdx}
            onSelect={selectMention}
            onHover={setActiveIdx}
          />
        </div>
      )}
      <InputGroup
        className={cn(isChatDropTarget && "border-ring ring-3 ring-ring/50")}
      >
        {/* 隐藏的 icon 模板：createMentionSpan 通过 cloneNode 复用 React 渲染的 lucide 图标 */}
        <div ref={iconTemplateRef} className="hidden" aria-hidden>
          <span data-icon="segment">
            <Layers className="size-3 shrink-0 text-sky-600 dark:text-sky-400" />
          </span>
          <span data-icon="date">
            <CalendarRange className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          </span>
          <span data-icon="task">
            <SquareCheck className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
          </span>
        </div>
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
        {/* contenteditable editor + 手动 placeholder */}
        {/* 用 relative 容器包裹，placeholder span 绝对定位覆盖在 editor 上 */}
        <div className="relative w-full min-h-9 flex-1">
          {isEmpty && (
            <span className="pointer-events-none absolute left-0 top-0 px-3 py-2.5 text-sm leading-snug text-muted-foreground">
              例如「把今天的 t3 标记为完成」或「明天加一个任务：买菜」
            </span>
          )}
          <div
            ref={editorRef}
            data-slot="input-group-control"
            role="textbox"
            aria-multiline="true"
            aria-label="对话输入"
            contentEditable
            suppressContentEditableWarning
            onInput={handleEditorInput}
            onKeyDown={handleKeyDown}
            onKeyUp={handleEditorSelect}
            onPointerUp={handleEditorSelect}
            // 点击 mention chip 删除按钮时移除对应引用
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const btn = target.closest('[data-mention-action="remove"]');
              if (btn) {
                const chip = btn.closest('[data-mention]') as HTMLElement | null;
                if (chip?.parentElement) {
                  const next = chip.nextElementSibling;
                  chip.remove();
                  handleEditorInput();
                  e.preventDefault();
                  // 如果删除后紧跟空格，也一并移除
                  if (
                    next?.nodeType === Node.TEXT_NODE &&
                    next.textContent?.startsWith(" ")
                  ) {
                    next.textContent = next.textContent.slice(1);
                    handleEditorInput();
                  }
                }
              }
            }}
            className="max-h-40 min-h-9 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-background px-3 py-2.5 pr-12 text-sm leading-snug outline-none"
          />
        </div>
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
              onClick={onStop}
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
              disabled={!input.trim() && attachments.length === 0}
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
  );
}
