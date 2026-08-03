import type { Task, TaskSegment, TasksByDate } from "@/lib/db/queries";
import { formatDate } from "@/lib/utils/date";

/**
 * chat-panel 输入框「@」引用的解析与上下文构建。
 *
 * 支持的引用格式：
 * - `@<任务段名>`        → 引用任务段中所有任务
 * - `@<日期>`            → 引用日期当天的任务（格式：2026-07-24 / 2026年7月24日 / 7月24日 / 第30周（年内周数））
 * - `@<日期-日期>`       → 引用日期段内的任务（分隔符支持 - ~ 到）
 * - `@<任务名>`          → 引用特定一项任务
 */

export type MentionTaskEntry = { task: Task; date: string };

export type MentionCtx = {
  tasksByDate: TasksByDate;
  segments: TaskSegment[];
  today: string;
};

/** 解析成功的单个引用 */
export type ResolvedMention =
  | {
      kind: "segment";
      mention: string;
      segment: TaskSegment;
      tasks: MentionTaskEntry[];
    }
  | {
      kind: "date";
      mention: string;
      start: string;
      end: string;
      tasks: MentionTaskEntry[];
    }
  | { kind: "task"; mention: string; task: Task; date: string };

/** autocomplete 的单个推荐项 */
export type MentionSuggestion =
  | {
      kind: "segment";
      segment: TaskSegment;
      count: number;
      insertText: string;
    }
  | {
      kind: "date";
      label: string;
      start: string;
      end: string;
      count: number;
      insertText: string;
    }
  | { kind: "task"; task: Task; date: string; insertText: string };

/** 每个引用最多展开的任务条数（防止上下文爆炸） */
const MAX_TASKS_PER_REF = 50;
/** 各类推荐的最大条数 */
const MAX_SEGMENT_SUGGESTIONS = 5;
const MAX_TASK_SUGGESTIONS = 8;

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 解析单日期表达式：YYYY-MM-DD / YYYY年M月D日 / M月D日（年份默认今年） */
function singleDate(expr: string, year: number): string | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(expr);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/.exec(expr);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})月(\d{1,2})日?$/.exec(expr);
  if (m) return ymd(year, +m[1]!, +m[2]!);
  return null;
}

/** 解析「第N周」：该年包含 1月1日 的周一为第 1 周起点，取第 N 个周一~周日 */
function weekRange(expr: string, year: number): {
  start: string;
  end: string;
} | null {
  const m = /^第?(\d{1,2})周$/.exec(expr);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (n < 1 || n > 53) return null;
  const jan1 = new Date(year, 0, 1);
  const monday = new Date(jan1);
  monday.setDate(jan1.getDate() - ((jan1.getDay() + 6) % 7) + (n - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatDate(monday), end: formatDate(sunday) };
}

/**
 * 解析日期/时间段表达式，返回 { start, end }（单日期时两者相同）。
 * 支持：单日期、第N周、日期段（- ~ 到 分隔，ISO-ISO 也可用短横线连接）。
 */
export function parseDateExpr(
  expr: string,
  today: string,
): { start: string; end: string } | null {
  const e = expr.trim();
  if (!e) return null;
  const year = Number(today.slice(0, 4));

  const single = singleDate(e, year);
  if (single) return { start: single, end: single };

  const week = weekRange(e, year);
  if (week) return week;

  // 时间段：ISO-ISO 短横线连接（如 2026-07-20-2026-07-26）
  let parts: string[] | null = null;
  const isoRange = /^(\d{4}-\d{1,2}-\d{1,2})-(\d{4}-\d{1,2}-\d{1,2})$/.exec(e);
  if (isoRange) {
    parts = [isoRange[1]!, isoRange[2]!];
  } else {
    // ~ / 到 分隔；或非 ISO 开头时用 - 分隔（如 7月20日-7月26日）
    let sepIdx = -1;
    const tilde = e.indexOf("~");
    const dao = e.indexOf("到");
    if (tilde > 0) sepIdx = tilde;
    else if (dao > 0) sepIdx = dao;
    else if (!/^\d{4}-/.test(e)) sepIdx = e.indexOf("-");
    if (sepIdx > 0) {
      parts = [e.slice(0, sepIdx), e.slice(sepIdx + 1)];
    }
  }
  if (parts) {
    const s = singleDate(parts[0]!.trim(), year);
    const t = singleDate(parts[1]!.trim(), year);
    if (s && t) return s <= t ? { start: s, end: t } : { start: t, end: s };
  }
  return null;
}

/** 收集任务段内所有任务（按日期升序） */
function segmentTasks(
  segment: TaskSegment,
  tasksByDate: TasksByDate,
): MentionTaskEntry[] {
  const entries: MentionTaskEntry[] = [];
  for (const [d, list] of Object.entries(tasksByDate)) {
    for (const task of list) {
      if (task.segmentId === segment.id) entries.push({ task, date: d });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

/** 收集日期范围内的任务（按日期升序） */
function rangeTasks(
  start: string,
  end: string,
  tasksByDate: TasksByDate,
): MentionTaskEntry[] {
  const entries: MentionTaskEntry[] = [];
  for (const [d, list] of Object.entries(tasksByDate)) {
    if (d < start || d > end) continue;
    for (const task of list) entries.push({ task, date: d });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

/** 日期片段的起始字符集（用于从候选文本中截取日期表达式） */
const DATE_PREFIX_RE = /^[\d年月日周第~到-]{2,}/;

/** 解析候选文本（@ 后到下一个 @ 或换行之前）的最长可解析前缀 */
function resolveChunk(chunk: string, ctx: MentionCtx): ResolvedMention | null {
  // 1) 任务段名：精确前缀匹配，取最长段名
  const segs = [...ctx.segments].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const s of segs) {
    if (chunk.startsWith(s.name)) {
      return {
        kind: "segment",
        mention: s.name,
        segment: s,
        tasks: segmentTasks(s, ctx.tasksByDate),
      };
    }
  }

  // 2) 日期/时间段：截取开头的日期字符，尝试逐步缩短解析
  const dateRun = DATE_PREFIX_RE.exec(chunk)?.[0];
  if (dateRun) {
    for (let len = dateRun.length; len >= 2; len--) {
      const candidate = dateRun.slice(0, len);
      const dr = parseDateExpr(candidate, ctx.today);
      if (dr) {
        return {
          kind: "date",
          mention: candidate,
          start: dr.start,
          end: dr.end,
          tasks: rangeTasks(dr.start, dr.end, ctx.tasksByDate),
        };
      }
    }
  }

  // 3) 任务名：标题是候选文本的前缀，取最长标题
  let best: { task: Task; date: string } | null = null;
  for (const [d, list] of Object.entries(ctx.tasksByDate)) {
    for (const task of list) {
      if (!task.title) continue;
      if (
        chunk.startsWith(task.title) &&
        (best === null || task.title.length > best.task.title.length)
      ) {
        best = { task, date: d };
      }
    }
  }
  if (best) {
    return { kind: "task", mention: best.task.title, task: best.task, date: best.date };
  }
  return null;
}

function dedupeKey(ref: ResolvedMention): string {
  if (ref.kind === "segment") return `segment:${ref.segment.id}`;
  if (ref.kind === "date") return `date:${ref.start}|${ref.end}`;
  return `task:${ref.task.id}`;
}

/**
 * 从消息文本中提取所有可解析的 @ 引用。
 * 无法解析的 @ 片段按普通文本处理（不产生引用）。
 */
export function extractMentions(
  text: string,
  ctx: MentionCtx,
): ResolvedMention[] {
  const refs: ResolvedMention[] = [];
  const seen = new Set<string>();
  // 按 @ 切分，每段候选到下一个 @ 或换行为止
  for (const rawChunk of text.split("@").slice(1)) {
    const chunk = rawChunk.split("\n", 1)[0]!;
    if (!chunk.trim()) continue;
    const ref = resolveChunk(chunk, ctx);
    if (ref) {
      const key = dedupeKey(ref);
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(ref);
      }
    }
  }
  return refs;
}

/** 单个引用在文本中的位置区间 */
export type MentionRange = {
  ref: ResolvedMention;
  /** @ 字符在原文中的索引 */
  start: number;
  /** mention 文本结束位置（不含 @ 后的 mention 字符长度已含在内） */
  end: number;
};

/**
 * 扫描文本中所有可解析的 @ 引用，返回每个引用的位置区间（不去重）。
 * 用于 contenteditable editor 渲染：将 `@xxx` 文本替换为不可编辑的 mention chip。
 */
export function findAllMentionRanges(
  text: string,
  ctx: MentionCtx,
): MentionRange[] {
  const ranges: MentionRange[] = [];
  let i = 0;
  while (i < text.length) {
    const atIdx = text.indexOf("@", i);
    if (atIdx < 0) break;
    // @ 必须在行首或前面是空白
    if (atIdx > 0 && !/\s/.test(text[atIdx - 1]!)) {
      i = atIdx + 1;
      continue;
    }
    // 取 @ 后到下一个 @ 或换行的文本作为候选（允许空格，因任务名可含空格）
    let end = atIdx + 1;
    while (
      end < text.length &&
      text[end] !== "@" &&
      text[end] !== "\n"
    ) {
      end++;
    }
    const chunk = text.slice(atIdx + 1, end);
    if (chunk.trim()) {
      const ref = resolveChunk(chunk, ctx);
      if (ref) {
        ranges.push({
          ref,
          start: atIdx,
          end: atIdx + 1 + ref.mention.length,
        });
      }
    }
    i = end;
  }
  return ranges;
}

/** 把解析出的引用构建为给模型看的上下文前缀 */
export function buildMentionContext(refs: ResolvedMention[]): string {
  const lines: string[] = ["【参考任务】（用户通过 @ 引用的上下文）"];
  const pushTasks = (tasks: MentionTaskEntry[]) => {
    const shown = tasks.slice(0, MAX_TASKS_PER_REF);
    for (const e of shown) {
      lines.push(`  - ${e.task.title}（日期: ${e.date}，ID: ${e.task.id}）`);
    }
    if (tasks.length > shown.length) {
      lines.push(`  - …（其余 ${tasks.length - shown.length} 项略）`);
    }
  };
  for (const ref of refs) {
    if (ref.kind === "segment") {
      lines.push(
        `- [任务段] ${ref.segment.name}（${ref.segment.startDate} ~ ${ref.segment.endDate}，共 ${ref.tasks.length} 项）:`,
      );
      pushTasks(ref.tasks);
    } else if (ref.kind === "date") {
      const label =
        ref.start === ref.end ? ref.start : `${ref.start} ~ ${ref.end}`;
      lines.push(`- [日期] ${label}（共 ${ref.tasks.length} 项）:`);
      pushTasks(ref.tasks);
    } else {
      lines.push(
        `- [任务] ${ref.task.title}（日期: ${ref.date}，ID: ${ref.task.id}）`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * 构建 autocomplete 推荐列表：
 * - 任务段：按名称包含匹配（空 query 时列出全部，上限 MAX_SEGMENT_SUGGESTIONS）
 * - 日期/时间段：query 可解析为日期表达式时给出对应项
 * - 任务：按标题包含匹配，未完成优先、今天及以后优先、日期升序
 */
export function buildMentionSuggestions(
  query: string,
  ctx: MentionCtx,
): MentionSuggestion[] {
  const q = query.trim().toLowerCase();
  const out: MentionSuggestion[] = [];

  // 任务段
  let segCount = 0;
  for (const s of ctx.segments) {
    if (segCount >= MAX_SEGMENT_SUGGESTIONS) break;
    if (q && !s.name.toLowerCase().includes(q)) continue;
    out.push({
      kind: "segment",
      segment: s,
      count: segmentTasks(s, ctx.tasksByDate).length,
      insertText: s.name,
    });
    segCount++;
  }

  // 日期/时间段（query 可完整解析时）
  const dr = q ? parseDateExpr(query.trim(), ctx.today) : null;
  if (dr) {
    out.push({
      kind: "date",
      label: dr.start === dr.end ? dr.start : `${dr.start} ~ ${dr.end}`,
      start: dr.start,
      end: dr.end,
      count: rangeTasks(dr.start, dr.end, ctx.tasksByDate).length,
      insertText: query.trim(),
    });
  }

  // 任务
  const all: MentionTaskEntry[] = [];
  for (const [d, list] of Object.entries(ctx.tasksByDate)) {
    for (const task of list) {
      if (!task.title) continue;
      if (q && !task.title.toLowerCase().includes(q)) continue;
      all.push({ task, date: d });
    }
  }
  all.sort((a, b) => {
    // 未完成优先 → 今天及以后优先 → 日期升序
    if (a.task.done !== b.task.done) return a.task.done ? 1 : -1;
    const aFuture = a.date >= ctx.today ? 0 : 1;
    const bFuture = b.date >= ctx.today ? 0 : 1;
    if (aFuture !== bFuture) return aFuture - bFuture;
    return a.date.localeCompare(b.date);
  });
  for (const e of all.slice(0, MAX_TASK_SUGGESTIONS)) {
    out.push({ kind: "task", task: e.task, date: e.date, insertText: e.task.title });
  }

  return out;
}
