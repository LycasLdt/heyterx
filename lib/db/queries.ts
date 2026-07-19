import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/lib/db";
import {
  task as taskTable,
  taskSegment as taskSegmentTable,
  conversation as conversationTable,
  report as reportTable,
  user as userTable,
  type ModelConfig,
  type PreferencesPatch,
  type ReportMetrics,
  type ReportPlan,
  type ReportType,
  type UserPreferences,
} from "@/lib/db/schema";

/** 默认用户偏好（数据库中 preferences 为 NULL 时使用） */
export const DEFAULT_PREFERENCES: UserPreferences = {
  general: { theme: "system", defaultTaskView: "list" },
  agent: { role: "", skills: [], behavior: { migrationMode: "important" } },
  models: { defaultModelId: "", configs: [] },
};

/** 深合并两个 UserPreferences（patch 覆盖 base，数组整体替换） */
export function mergePreferences(
  base: UserPreferences,
  patch: PreferencesPatch,
): UserPreferences {
  const baseAgent = base.agent ?? DEFAULT_PREFERENCES.agent;
  const baseBehavior = baseAgent.behavior ?? DEFAULT_PREFERENCES.agent.behavior;
  return {
    general: {
      theme: patch.general?.theme ?? base.general.theme,
      defaultTaskView:
        patch.general?.defaultTaskView ?? base.general.defaultTaskView,
    },
    agent: {
      role: patch.agent?.role ?? baseAgent.role,
      skills: patch.agent?.skills ?? baseAgent.skills,
      behavior: {
        migrationMode:
          patch.agent?.behavior?.migrationMode ?? baseBehavior.migrationMode,
      },
    },
    models: {
      defaultModelId:
        patch.models?.defaultModelId ??
        (base.models ?? DEFAULT_PREFERENCES.models).defaultModelId,
      configs:
        patch.models?.configs ??
        (base.models ?? DEFAULT_PREFERENCES.models).configs,
    },
  };
}

/** 根据模型 id 查找用户模型配置；找不到返回 null */
export function findModelConfig(
  prefs: UserPreferences,
  modelId: string,
): ModelConfig | null {
  return prefs.models.configs.find((c) => c.id === modelId) ?? null;
}

/** MiMo-V2.5-ASR 默认语音识别模型配置（不在用户列表中，固定常量） */
export const DEFAULT_ASR_MODEL = {
  apiFormat: "openai" as const,
  modelId: "mimo-v2.5-asr",
  baseURL: "https://api.xiaomimimo.com/v1",
};

/**
 * 任务属性常量与类型
 */

/** 重要度×紧急度四象限取值（艾森豪威尔矩阵标准） */
export const IMPORTANCE_VALUES = [
  "重要且紧急",
  "重要但不紧急",
  "不重要但紧急",
  "不重要且不紧急",
] as const;
export type Importance = (typeof IMPORTANCE_VALUES)[number];

/** 五育分类取值（德/智/体/美/劳） */
export const CATEGORY_VALUES = [
  "德育",
  "智育",
  "体育",
  "美育",
  "劳育",
] as const;
export type Category = (typeof CATEGORY_VALUES)[number];

/**
 * 共享的领域类型 —— Task 与按日期分组的任务地图
 * 之前定义在 lib/agent.ts，现汇总到此处以便 agent 与 API 路由共用
 */
export type Task = {
  id: string;
  title: string;
  done: boolean;
  importance: Importance;
  category: Category;
  segmentId?: string;
  /** 自定义标签数组（自由输入） */
  tags: string[];
  /** 提醒时间 ISO 字符串，未设置则 undefined */
  reminderAt?: string;
  /** 提醒是否已触发 */
  reminderNotified: boolean;
};

/** 按日期分组的任务地图，key 为 YYYY-MM-DD */
export type TasksByDate = Record<string, Task[]>;

/** 任务段：一段时间范围内的任务归组（如「暑假任务段」） */
export type TaskSegment = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  description?: string;
};

/** 数据库行到 Task 的映射 */
function rowToTask(row: {
  id: string;
  title: string;
  done: boolean;
  importance: string;
  category: string;
  segmentId?: string | null;
  tags: string[] | null;
  reminderAt: Date | null;
  reminderNotified: boolean | null;
}): Task {
  return {
    id: row.id,
    title: row.title,
    done: row.done,
    importance: row.importance as Importance,
    category: row.category as Category,
    segmentId: row.segmentId ?? undefined,
    tags: row.tags ?? [],
    reminderAt: row.reminderAt ? row.reminderAt.toISOString() : undefined,
    reminderNotified: row.reminderNotified ?? false,
  };
}

/** task 表查询的公共字段（不含 date，需要 date 的查询单独加） */
const TASK_FIELDS = {
  id: taskTable.id,
  title: taskTable.title,
  done: taskTable.done,
  importance: taskTable.importance,
  category: taskTable.category,
  segmentId: taskTable.segmentId,
  tags: taskTable.tags,
  reminderAt: taskTable.reminderAt,
  reminderNotified: taskTable.reminderNotified,
} as const;

/* ------------------------------------------------------------------ */
/* Task 查询                                                           */
/* ------------------------------------------------------------------ */

/** 加载用户全部任务并按日期分组 */
export async function loadTasksByDate(userId: string): Promise<TasksByDate> {
  const rows = await db
    .select({ ...TASK_FIELDS, date: taskTable.date })
    .from(taskTable)
    .where(eq(taskTable.userId, userId));
  const byDate: TasksByDate = {};
  for (const r of rows) {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(rowToTask(r));
  }
  return byDate;
}

/** 加载某天任务 */
export async function loadDayTasks(
  userId: string,
  date: string,
): Promise<Task[]> {
  const rows = await db
    .select(TASK_FIELDS)
    .from(taskTable)
    .where(and(eq(taskTable.userId, userId), eq(taskTable.date, date)));
  return rows.map(rowToTask);
}

/** 按 id 查找任务（含 date，用于 move 等场景） */
export async function findTaskById(userId: string, id: string) {
  const [row] = await db
    .select({ ...TASK_FIELDS, date: taskTable.date })
    .from(taskTable)
    .where(and(eq(taskTable.id, id), eq(taskTable.userId, userId)));
  return row ?? null;
}

/** 按 id + date 查找任务（用于 toggle/update/delete 时校验归属） */
export async function findTaskByIdAndDate(
  userId: string,
  id: string,
  date: string,
) {
  const [row] = await db
    .select(TASK_FIELDS)
    .from(taskTable)
    .where(
      and(
        eq(taskTable.id, id),
        eq(taskTable.userId, userId),
        eq(taskTable.date, date),
      ),
    );
  return row ?? null;
}

/** 新增任务（默认未完成），返回生成的 Task
 *  importance / category 不传则使用 schema 默认值（重要但不紧急 / 智育）
 *  segmentId 可选，关联到任务段
 *  tags 可选，自定义标签数组
 *  reminderAt 可选，提醒时间 ISO 字符串 */
export async function insertTask(
  userId: string,
  input: {
    title: string;
    date: string;
    importance?: Importance;
    category?: Category;
    segmentId?: string;
    tags?: string[];
    reminderAt?: string;
  },
): Promise<Task> {
  const [inserted] = await db
    .insert(taskTable)
    .values({
      userId,
      title: input.title,
      done: false,
      date: input.date,
      importance: input.importance,
      category: input.category,
      segmentId: input.segmentId,
      tags: input.tags,
      reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
    })
    .returning(TASK_FIELDS);
  return rowToTask(inserted);
}

/** 批量新增任务（默认未完成），返回生成的 Task 列表 */
export async function insertTasks(
  userId: string,
  inputs: Array<{
    title: string;
    date: string;
    importance?: Importance;
    category?: Category;
    segmentId?: string;
    tags?: string[];
    reminderAt?: string;
  }>,
): Promise<Task[]> {
  if (inputs.length === 0) return [];
  const rows = await db
    .insert(taskTable)
    .values(
      inputs.map((input) => ({
        userId,
        title: input.title,
        done: false,
        date: input.date,
        importance: input.importance,
        category: input.category,
        segmentId: input.segmentId,
        tags: input.tags,
        reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
      })),
    )
    .returning(TASK_FIELDS);
  return rows.map(rowToTask);
}

/** 设置任务完成状态，返回更新后的 Task；任务不存在或非本人则返回 null */
export async function setTaskDone(
  userId: string,
  id: string,
  done: boolean,
): Promise<Task | null> {
  const [updated] = await db
    .update(taskTable)
    .set({ done, updatedAt: new Date() })
    .where(and(eq(taskTable.id, id), eq(taskTable.userId, userId)))
    .returning(TASK_FIELDS);
  return updated ? rowToTask(updated) : null;
}

/** 设置任务标题，返回更新后的 Task；不存在则返回 null */
export async function setTaskTitle(
  userId: string,
  id: string,
  title: string,
): Promise<Task | null> {
  const [updated] = await db
    .update(taskTable)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(taskTable.id, id), eq(taskTable.userId, userId)))
    .returning(TASK_FIELDS);
  return updated ? rowToTask(updated) : null;
}

/**
 * 通用任务更新：支持修改 title / importance / category / tags / reminderAt /
 * segmentId。只更新传入的字段，未传字段保持不变。reminderAt 传 null 表示清除提醒。
 * 返回更新后的 Task；不存在则返回 null。
 */
export async function updateTaskFields(
  userId: string,
  id: string,
  input: {
    title?: string;
    importance?: Importance;
    category?: Category;
    tags?: string[];
    reminderAt?: string | null;
    segmentId?: string | null;
  },
): Promise<Task | null> {
  const updates: Partial<typeof taskTable.$inferInsert> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.importance !== undefined) updates.importance = input.importance;
  if (input.category !== undefined) updates.category = input.category;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.reminderAt !== undefined) {
    updates.reminderAt = input.reminderAt ? new Date(input.reminderAt) : null;
    // 重新设置提醒时重置通知标记
    if (input.reminderAt) updates.reminderNotified = false;
  }
  if (input.segmentId !== undefined) updates.segmentId = input.segmentId;
  if (Object.keys(updates).length === 0) return null;
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(taskTable)
    .set(updates)
    .where(and(eq(taskTable.id, id), eq(taskTable.userId, userId)))
    .returning(TASK_FIELDS);
  return updated ? rowToTask(updated) : null;
}

/** 设置任务日期（move），返回更新后的 Task；不存在则返回 null */
export async function setTaskDate(
  userId: string,
  id: string,
  date: string,
): Promise<Task | null> {
  const [updated] = await db
    .update(taskTable)
    .set({ date, updatedAt: new Date() })
    .where(and(eq(taskTable.id, id), eq(taskTable.userId, userId)))
    .returning(TASK_FIELDS);
  return updated ? rowToTask(updated) : null;
}

/**
 * 收集「过去未完成任务迁移决策」所需的只读上下文。
 *
 * 不执行任何写操作——迁移方式（直接 moveTask / 合并 deleteTask+addTask /
 * 跳过孤立历史任务）由 agent 自主决策。
 *
 * 返回：
 * - pastIncomplete: 过去日期（< today）中所有未完成任务，按日期升序，
 *   含 id/title/date/importance/category/segmentId，供 agent 决策。
 * - segments: 用户全部任务段（agent 据此判断「任务段开始前的孤立任务」
 *   是否应跳过迁移）。
 * - futureCounts: 今天起未来 14 天每日已有任务数（agent 据此选择空闲日，
 *   避免把任务挪到已满的日子）。
 */
export async function getPastIncompleteTasksData(
  userId: string,
  today: string,
): Promise<{
  pastIncomplete: Array<Task & { date: string }>;
  segments: TaskSegment[];
  futureCounts: Array<{ date: string; count: number }>;
}> {
  const [byDate, segments] = await Promise.all([
    loadTasksByDate(userId),
    loadSegments(userId),
  ]);

  const pastIncomplete: Array<Task & { date: string }> = [];
  for (const [d, list] of Object.entries(byDate)) {
    if (d >= today) continue;
    for (const t of list) {
      if (!t.done) pastIncomplete.push({ ...t, date: d });
    }
  }
  pastIncomplete.sort((a, b) => a.date.localeCompare(b.date));

  // 今天起未来 14 天每日任务数
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const futureCounts: Array<{ date: string; count: number }> = [];
  for (let i = 0; i < 14; i++) {
    const ds = new Date(todayMs + i * dayMs).toISOString().slice(0, 10);
    futureCounts.push({ date: ds, count: byDate[ds]?.length ?? 0 });
  }

  return { pastIncomplete, segments, futureCounts };
}

/** 删除任务，返回被删除的 Task；不存在则返回 null */
export async function removeTask(
  userId: string,
  id: string,
): Promise<Task | null> {
  const [deleted] = await db
    .delete(taskTable)
    .where(and(eq(taskTable.id, id), eq(taskTable.userId, userId)))
    .returning(TASK_FIELDS);
  return deleted ? rowToTask(deleted) : null;
}

/** 收集用户所有用过的自定义标签（去重，按字母序），供筛选下拉自动补全 */
export async function loadAllTags(userId: string): Promise<string[]> {
  const rows = await db
    .select({ tags: taskTable.tags })
    .from(taskTable)
    .where(eq(taskTable.userId, userId));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.tags) for (const t of r.tags) if (t) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/**
 * 查询已到点但尚未通知的提醒任务（供 Service Worker 轮询）。
 * 返回任务的 id / title / date / reminderAt，到点的逐一触发通知后由
 * markReminderNotified 标记，避免重复通知。
 */
export async function loadDueReminders(
  userId: string,
  now: Date = new Date(),
): Promise<
  Array<{ id: string; title: string; date: string; reminderAt: string }>
> {
  const rows = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      date: taskTable.date,
      reminderAt: taskTable.reminderAt,
    })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.userId, userId),
        eq(taskTable.reminderNotified, false),
        lte(taskTable.reminderAt, now),
      ),
    );
  return rows
    .filter((r) => r.reminderAt !== null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      reminderAt: r.reminderAt!.toISOString(),
    }));
}

/** 批量标记任务提醒已通知，避免重复触发 */
export async function markRemindersNotified(
  userId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(taskTable)
    .set({ reminderNotified: true, updatedAt: new Date() })
    .where(
      and(
        eq(taskTable.userId, userId),
        inArray(taskTable.id, ids),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* TaskSegment 查询                                                    */
/* ------------------------------------------------------------------ */

/** DB 行到 TaskSegment 的映射（description null → undefined） */
function rowToSegment(row: {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string | null;
}): TaskSegment {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    description: row.description ?? undefined,
  };
}

const SEGMENT_FIELDS = {
  id: taskSegmentTable.id,
  name: taskSegmentTable.name,
  startDate: taskSegmentTable.startDate,
  endDate: taskSegmentTable.endDate,
  description: taskSegmentTable.description,
} as const;

/** 加载用户全部任务段，按开始日期升序 */
export async function loadSegments(userId: string): Promise<TaskSegment[]> {
  const rows = await db
    .select(SEGMENT_FIELDS)
    .from(taskSegmentTable)
    .where(eq(taskSegmentTable.userId, userId))
    .orderBy(taskSegmentTable.startDate);
  return rows.map(rowToSegment);
}

/** 加载覆盖指定日期的所有任务段 */
export async function loadSegmentsForDate(
  userId: string,
  date: string,
): Promise<TaskSegment[]> {
  const rows = await db
    .select(SEGMENT_FIELDS)
    .from(taskSegmentTable)
    .where(
      and(
        eq(taskSegmentTable.userId, userId),
        lte(taskSegmentTable.startDate, date),
        gte(taskSegmentTable.endDate, date),
      ),
    );
  return rows.map(rowToSegment);
}

/** 按 id 查找任务段 */
export async function findSegmentById(
  userId: string,
  id: string,
): Promise<TaskSegment | null> {
  const [row] = await db
    .select(SEGMENT_FIELDS)
    .from(taskSegmentTable)
    .where(
      and(eq(taskSegmentTable.id, id), eq(taskSegmentTable.userId, userId)),
    );
  return row ? rowToSegment(row) : null;
}

/**
 * 创建任务段。时间范围可以相交，但同一用户下 name+startDate+endDate
 * 完全相同的段不允许重复创建。返回创建的 TaskSegment，重复时返回 { error }。
 */
export async function createSegment(
  userId: string,
  input: {
    name: string;
    startDate: string;
    endDate: string;
    description?: string;
  },
): Promise<TaskSegment | { error: string }> {
  // 唯一性校验：同 name + 同 startDate + 同 endDate 视为重复
  const [dup] = await db
    .select({ id: taskSegmentTable.id })
    .from(taskSegmentTable)
    .where(
      and(
        eq(taskSegmentTable.userId, userId),
        eq(taskSegmentTable.name, input.name),
        eq(taskSegmentTable.startDate, input.startDate),
        eq(taskSegmentTable.endDate, input.endDate),
      ),
    )
    .limit(1);
  if (dup) return { error: "已存在相同名称与日期范围的任务段" };

  const [created] = await db
    .insert(taskSegmentTable)
    .values({
      userId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      description: input.description,
    })
    .returning(SEGMENT_FIELDS);
  return rowToSegment(created);
}

/** 修改任务段（name / startDate / endDate / description），返回更新后的 TaskSegment */
export async function updateSegment(
  userId: string,
  id: string,
  input: {
    name?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  },
): Promise<TaskSegment | null> {
  const updates: Partial<typeof taskSegmentTable.$inferInsert> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.startDate !== undefined) updates.startDate = input.startDate;
  if (input.endDate !== undefined) updates.endDate = input.endDate;
  if (input.description !== undefined) updates.description = input.description;
  if (Object.keys(updates).length === 0) return null;
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(taskSegmentTable)
    .set(updates)
    .where(
      and(eq(taskSegmentTable.id, id), eq(taskSegmentTable.userId, userId)),
    )
    .returning(SEGMENT_FIELDS);
  return updated ? rowToSegment(updated) : null;
}

/* ------------------------------------------------------------------ */
/* Conversation 查询                                                   */
/* ------------------------------------------------------------------ */

export type ConversationRow = {
  id: string;
  title: string;
  messages: UIMessage[];
  updatedAt: Date;
};

/** 取用户最近一次对话（按 updatedAt 降序） */
export async function getLatestConversation(
  userId: string,
): Promise<ConversationRow | null> {
  const [latest] = await db
    .select({
      id: conversationTable.id,
      title: conversationTable.title,
      messages: conversationTable.messages,
      updatedAt: conversationTable.updatedAt,
    })
    .from(conversationTable)
    .where(eq(conversationTable.userId, userId))
    .orderBy(desc(conversationTable.updatedAt))
    .limit(1);
  return latest ?? null;
}

/** 清空用户所有对话记录（开发环境用：丢弃迁移前的陈旧消息） */
export async function clearConversations(userId: string): Promise<void> {
  await db
    .delete(conversationTable)
    .where(eq(conversationTable.userId, userId));
}

/**
 * 按关键词搜索用户的历史对话消息。
 * 在最近一次对话的 messages 里做不区分大小写的包含匹配，
 * 返回匹配消息的摘要（角色 + 文本片段 + 日期），供 Agent 回忆上下文使用。
 */
export async function searchConversations(
  userId: string,
  keywords: string[],
): Promise<Array<{ role: string; text: string; date: string }>> {
  const conv = await getLatestConversation(userId);
  if (!conv || keywords.length === 0) return [];

  const dateStr = conv.updatedAt.toISOString().split("T")[0];
  const lowered = keywords.map((k) => k.toLowerCase());

  const results: Array<{ role: string; text: string; date: string }> = [];
  for (const msg of conv.messages) {
    // 拼接所有 text part 作为消息文本
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join(" ")
      .trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lowered.some((k) => lower.includes(k))) {
      // 截断到 500 字符以节约 token
      results.push({
        role: msg.role,
        text: text.length > 500 ? text.slice(0, 500) + "…" : text,
        date: dateStr,
      });
      // 最多返回 20 条匹配
      if (results.length >= 20) break;
    }
  }
  return results;
}

/** 从 messages 里取第一条 user 消息的文本，作为对话标题 */
function pickTitle(messages: UIMessage[]): string {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        return part.text.length > 30 ? part.text.slice(0, 30) + "…" : part.text;
      }
    }
  }
  return "新对话";
}

/**
 * 保存（upsert）对话：有 id 则更新，没有则插入新对话
 * 返回对话 id
 */
export async function saveConversation(
  userId: string,
  input: { id?: string; messages: UIMessage[] },
): Promise<string> {
  const { messages, id } = input;
  const title = pickTitle(messages);

  if (id) {
    const [updated] = await db
      .update(conversationTable)
      .set({ messages, title, updatedAt: new Date() })
      .where(
        and(eq(conversationTable.id, id), eq(conversationTable.userId, userId)),
      )
      .returning({ id: conversationTable.id });
    if (updated) return updated.id;
  }

  const [created] = await db
    .insert(conversationTable)
    .values({ userId, title, messages })
    .returning({ id: conversationTable.id });
  return created.id;
}

/* ------------------------------------------------------------------ */
/* Report 查询与指标计算                                               */
/* ------------------------------------------------------------------ */

/** 心理绿芽指数维度配置：五育 → 心理指标映射 + 权重 */
const GROWTH_DIMENSION_CONFIG: Array<{
  category: Category;
  label: string;
  weight: number;
}> = [
  { category: "智育", label: "认知掌控感", weight: 0.25 },
  { category: "体育", label: "生理活力值", weight: 0.25 },
  { category: "德育", label: "人际连接感", weight: 0.2 },
  { category: "美育", label: "情绪舒缓度", weight: 0.15 },
  { category: "劳育", label: "生活掌控感", weight: 0.15 },
];

/** 客户端使用的报告类型 */
export type Report = {
  id: string;
  type: ReportType;
  title: string;
  periodStart: string;
  periodEnd: string;
  segmentId?: string;
  summary: string;
  metrics: ReportMetrics;
  plan: ReportPlan;
  createdAt: string;
};

function rowToReport(row: {
  id: string;
  type: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  segmentId: string | null;
  summary: string;
  metrics: ReportMetrics;
  plan: ReportPlan;
  createdAt: Date;
}): Report {
  return {
    id: row.id,
    type: row.type as ReportType,
    title: row.title,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    segmentId: row.segmentId ?? undefined,
    summary: row.summary,
    metrics: row.metrics,
    plan: row.plan,
    createdAt: row.createdAt.toISOString(),
  };
}

const REPORT_FIELDS = {
  id: reportTable.id,
  type: reportTable.type,
  title: reportTable.title,
  periodStart: reportTable.periodStart,
  periodEnd: reportTable.periodEnd,
  segmentId: reportTable.segmentId,
  summary: reportTable.summary,
  metrics: reportTable.metrics,
  plan: reportTable.plan,
  createdAt: reportTable.createdAt,
} as const;

/**
 * 计算周期内任务的结构化指标 + 心理绿芽指数。
 * 各维度分数 = 该维度任务完成率 × 100；总分 = Σ(维度分 × 权重)。
 */
export function computeMetrics(tasks: Task[]): ReportMetrics {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.done).length;
  const completionRate =
    totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  // 五育分布
  const categoryDistribution = CATEGORY_VALUES.map((category) => {
    const list = tasks.filter((t) => t.category === category);
    const completed = list.filter((t) => t.done).length;
    return {
      category,
      count: list.length,
      completed,
      rate: list.length === 0 ? 0 : Math.round((completed / list.length) * 100),
    };
  });

  // 四象限分布
  const importanceDistribution = IMPORTANCE_VALUES.map((importance) => {
    const list = tasks.filter((t) => t.importance === importance);
    const completed = list.filter((t) => t.done).length;
    return { importance, count: list.length, completed };
  });

  // 心理绿芽指数：各维度分数 = 该维度任务完成率，加权求和
  const dimensions = GROWTH_DIMENSION_CONFIG.map(
    ({ category, label, weight }) => {
      const list = tasks.filter((t) => t.category === category);
      const completed = list.filter((t) => t.done).length;
      const score =
        list.length === 0 ? 0 : Math.round((completed / list.length) * 100);
      return { category, label, score, weight };
    },
  );
  const growthTotal = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
  );

  return {
    totalTasks,
    completedTasks,
    completionRate,
    categoryDistribution,
    importanceDistribution,
    growthIndex: { total: growthTotal, dimensions },
  };
}

/** 加载周期内任务（按日期范围过滤），返回带 date 的任务（供报告生成器按日期分组） */
export async function loadTasksInRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Array<Task & { date: string }>> {
  const rows = await db
    .select({ ...TASK_FIELDS, date: taskTable.date })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.userId, userId),
        gte(taskTable.date, startDate),
        lte(taskTable.date, endDate),
      ),
    );
  return rows.map((r) => ({ ...rowToTask(r), date: r.date }));
}

/** 创建报告（存结构化指标 + AI 总结 + 规划） */
export async function createReport(
  userId: string,
  input: {
    type: ReportType;
    title: string;
    periodStart: string;
    periodEnd: string;
    segmentId?: string;
    summary: string;
    plan: ReportPlan;
  },
): Promise<Report> {
  const tasks = await loadTasksInRange(
    userId,
    input.periodStart,
    input.periodEnd,
  );
  const metrics = computeMetrics(tasks);
  const [created] = await db
    .insert(reportTable)
    .values({
      userId,
      type: input.type,
      title: input.title,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      segmentId: input.segmentId,
      summary: input.summary,
      metrics,
      plan: input.plan,
    })
    .returning(REPORT_FIELDS);
  return rowToReport(created);
}

/** 加载用户全部报告（按创建时间倒序） */
export async function loadReports(userId: string): Promise<Report[]> {
  const rows = await db
    .select(REPORT_FIELDS)
    .from(reportTable)
    .where(eq(reportTable.userId, userId))
    .orderBy(desc(reportTable.createdAt));
  return rows.map(rowToReport);
}

/** 按 id 查找报告 */
export async function findReportById(
  userId: string,
  id: string,
): Promise<Report | null> {
  const [row] = await db
    .select(REPORT_FIELDS)
    .from(reportTable)
    .where(and(eq(reportTable.id, id), eq(reportTable.userId, userId)));
  return row ? rowToReport(row) : null;
}

/** 检查某周期是否已生成过报告（同 type + 同 periodEnd 视为重复） */
export async function hasReportForPeriod(
  userId: string,
  type: ReportType,
  periodEnd: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: reportTable.id })
    .from(reportTable)
    .where(
      and(
        eq(reportTable.userId, userId),
        eq(reportTable.type, type),
        eq(reportTable.periodEnd, periodEnd),
      ),
    )
    .limit(1);
  return !!row;
}

/** 应用报告规划：批量创建 plan 中的任务，返回创建结果 */
export async function applyReportPlan(
  userId: string,
  reportId: string,
): Promise<Task[]> {
  const [row] = await db
    .select({ plan: reportTable.plan })
    .from(reportTable)
    .where(and(eq(reportTable.id, reportId), eq(reportTable.userId, userId)));
  if (!row || row.plan.length === 0) return [];
  return insertTasks(
    userId,
    row.plan.map((p) => ({
      title: p.title,
      importance: p.importance as Importance,
      category: p.category as Category,
      date: p.date,
    })),
  );
}

/* ------------------------------------------------------------------ */
/* UserPreferences & 账号查询                                          */
/* ------------------------------------------------------------------ */

/** 读取用户偏好；数据库为 NULL 时返回默认值 */
export async function getUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const [row] = await db
    .select({ preferences: userTable.preferences })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return row?.preferences ?? DEFAULT_PREFERENCES;
}

/**
 * 读取用户偏好并解密所有模型配置中的 apiKey。
 * 服务端业务层（agent / transcribe）应使用此函数；返回的 apiKey 是明文。
 *
 * 数据库中存储的是 "enc:" 前缀的密文，前端 GET /api/preferences
 * 返回的也是密文（前端用相同 master key 自行解密显示）。
 */
export async function getUserPreferencesDecrypted(
  userId: string,
): Promise<UserPreferences> {
  const prefs = await getUserPreferences(userId);
  if (!prefs.models?.configs?.length) return prefs;
  const { decryptForUser } = await import("@/lib/crypto");
  const decrypted = await Promise.all(
    prefs.models.configs.map(async (c) => ({
      ...c,
      apiKey: await decryptForUser(c.apiKey, userId),
    })),
  );
  return { ...prefs, models: { ...prefs.models, configs: decrypted } };
}

/** 整体覆盖用户偏好（merge 由调用方用 mergePreferences 完成） */
export async function updateUserPreferences(
  userId: string,
  preferences: UserPreferences,
): Promise<UserPreferences> {
  const [updated] = await db
    .update(userTable)
    .set({ preferences, updatedAt: new Date() })
    .where(eq(userTable.id, userId))
    .returning({ preferences: userTable.preferences });
  return updated?.preferences ?? DEFAULT_PREFERENCES;
}

/** 删除用户账号（cascade 会清除 session/account/task/conversation/report）。
 *  同时清理 Blob Store 中的核心记忆文件。 */
export async function deleteUser(userId: string): Promise<void> {
  // 先清理 Blob 中的核心记忆（账号删除后 userId 不再有效，无法再查）
  const { deleteCoreMemory } = await import("@/lib/ai/memory");
  await deleteCoreMemory(userId).catch(() => {});
  await db.delete(userTable).where(eq(userTable.id, userId));
}

/* ------------------------------------------------------------------ */
/* 分组实例：把上面散装的函数按领域聚合，方便按实例导入使用             */
/* ------------------------------------------------------------------ */

export const taskQueries = {
  loadByDate: loadTasksByDate,
  loadDay: loadDayTasks,
  findById: findTaskById,
  findByIdAndDate: findTaskByIdAndDate,
  insert: insertTask,
  insertMany: insertTasks,
  setDone: setTaskDone,
  setTitle: setTaskTitle,
  setDate: setTaskDate,
  updateFields: updateTaskFields,
  remove: removeTask,
  loadInRange: loadTasksInRange,
  getPastIncompleteData: getPastIncompleteTasksData,
  loadAllTags: loadAllTags,
  loadDueReminders: loadDueReminders,
  markRemindersNotified: markRemindersNotified,
};

export const segmentQueries = {
  load: loadSegments,
  loadForDate: loadSegmentsForDate,
  findById: findSegmentById,
  create: createSegment,
  update: updateSegment,
};

export const conversationQueries = {
  getLatest: getLatestConversation,
  save: saveConversation,
  clear: clearConversations,
  search: searchConversations,
};

export const reportQueries = {
  load: loadReports,
  create: createReport,
  findById: findReportById,
  hasForPeriod: hasReportForPeriod,
  applyPlan: applyReportPlan,
  computeMetrics: computeMetrics,
};

export const userQueries = {
  getPreferences: getUserPreferences,
  getPreferencesDecrypted: getUserPreferencesDecrypted,
  updatePreferences: updateUserPreferences,
  delete: deleteUser,
};
