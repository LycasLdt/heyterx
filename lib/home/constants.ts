/**
 * Home 页面共享的常量与纯工具函数。
 * 从 app/page.tsx 中抽出，便于各子组件（报告、日历、对话面板等）复用，
 * 避免在每个组件里重复定义或大量从 page.tsx 反向导入。
 */
import type {
  Category,
  Importance,
  Report,
  Task,
  TaskSegment,
  TasksByDate,
} from "@/lib/db/queries";

/** 工具调用在 UI 中显示的中文标签 */
export const TOOL_LABELS: Record<string, string> = {
  searchTasks: "搜索任务",
  getTasks: "读取任务计划",
  addTask: "新增任务",
  toggleTask: "切换任务状态",
  updateTask: "修改任务",
  moveTask: "移动任务",
  deleteTask: "删除任务",
  analyzeTaskBalance: "分析任务平衡",
  createTaskSegment: "创建任务段",
  updateTaskSegment: "修改任务段",
  exportTasks: "导出任务",
  getPastIncompleteTasks: "读取过去未完成任务",
  askQuestions: "向用户提问",
};

/** 静默工具：不向用户展示其工具调用气泡（记忆系统相关操作对用户不可见） */
export const HIDDEN_TOOLS = new Set([
  "updateCoreMemory",
  "searchConversations",
]);

/** 任务完成时按五育维度给出的简短正向反馈（随机选一条展示） */
export const CATEGORY_FEEDBACK: Record<Category, string[]> = {
  智育: [
    "你攻克了这个难点，又积累了一个新的解题方法，持续下去进步会很明显。",
    "这一步虽小，却在把你的知识网络织得更密，继续保持。",
  ],
  体育: [
    "这次拉伸帮你放松了肩颈的紧绷，大脑也会跟着清醒很多。",
    "短暂的微运动让血液循环起来，下一段学习会更专注。",
  ],
  德育: [
    "小小的善意会给别人带去温暖，也会让你收获更融洽的人际氛围。",
    "这一份用心会被对方接住，你也在关系里多攒了一份踏实。",
  ],
  美育: [
    "这段柔和的旋律帮你从紧绷里抽离了一会儿，情绪已经悄悄平复啦。",
    "几分钟的审美小憩，让紧绷的神经松开了一些，很会照顾自己。",
  ],
  劳育: [
    "整洁的小空间会让你做事更顺手，也会让心里更踏实。",
    "顺手收拾好的角落，正在悄悄给你一种「我能掌控」的踏实感。",
  ],
};

export function pickFeedback(category: Category): string {
  const list = CATEGORY_FEEDBACK[category] ?? CATEGORY_FEEDBACK.智育;
  return list[Math.floor(Math.random() * list.length)];
}

/** 系统触发消息前缀：带此前缀的 user 消息不向用户展示（用于新一天问候触发） */
export const SYSTEM_TRIGGER_PREFIX = "__system_trigger__";
/** 上滑加载更多历史对话时每次释放的消息条数 */
export const HISTORY_LOAD_BATCH = 20;

/** 任务段指示器配色：按 segments 数组中的索引循环取色，保证稳定 */
export const SEGMENT_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
] as const;

/** 任务段徽章配色（浅色底，用于任务下方的段标识） */
export const SEGMENT_BADGE_COLORS = [
  "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
] as const;

/** 根据任务段在 segments 数组中的索引取徽章样式 */
export function segmentBadgeClass(index: number): string {
  return SEGMENT_BADGE_COLORS[index % SEGMENT_BADGE_COLORS.length];
}

/**
 * 把提醒时间 ISO 字符串格式化为可读的本地时间，如「今天 15:00」「明天 09:30」「7/14 15:00」。
 * today 为客户端今天的 YYYY-MM-DD，用于相对日期判断。
 */
export function formatReminder(reminderIso: string, today: string): string {
  const d = new Date(reminderIso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(today + "T00:00:00");
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  if (ymd === today) return `今天 ${hh}:${mm}`;
  if (ymd === tomorrowStr) return `明天 ${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** 重要度×紧急度四象限取值（艾森豪威尔矩阵标准） */
export const IMPORTANCE_VALUES = [
  "重要且紧急",
  "重要但不紧急",
  "不重要但紧急",
  "不重要且不紧急",
] as const;

/** 五育分类取值（德/智/体/美/劳） */
export const CATEGORY_VALUES = [
  "德育",
  "智育",
  "体育",
  "美育",
  "劳育",
] as const;

/** 重要度紧急度的样式与象限信息 */
export const IMPORTANCE_META: Record<
  Importance,
  { badge: string; quadrant: string; short: string }
> = {
  重要且紧急: {
    badge: "bg-red-500/10 text-red-700 dark:text-red-300",
    quadrant: "重要 · 紧急",
    short: "重紧",
  },
  重要但不紧急: {
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    quadrant: "重要 · 不紧急",
    short: "重不紧",
  },
  不重要但紧急: {
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    quadrant: "不重要 · 紧急",
    short: "不重紧",
  },
  不重要且不紧急: {
    badge: "bg-muted text-muted-foreground",
    quadrant: "不重要 · 不紧急",
    short: "不重不紧",
  },
};

/** 五育分类的样式 */
export const CATEGORY_META: Record<Category, { badge: string; short: string }> =
  {
    德育: {
      badge: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
      short: "德",
    },
    智育: {
      badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
      short: "智",
    },
    体育: {
      badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      short: "体",
    },
    美育: {
      badge: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
      short: "美",
    },
    劳育: {
      badge: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
      short: "劳",
    },
  };

/** 四象限顺序：左上→右上→左下→右下 */
export const QUADRANT_ORDER: Importance[] = [
  "重要且紧急",
  "重要但不紧急",
  "不重要但紧急",
  "不重要且不紧急",
];

/** 报告类型 → 中文标签 */
export const REPORT_TYPE_LABELS: Record<Report["type"], string> = {
  weekly: "周报",
  monthly: "月报",
  stage: "阶段报",
};

/** 五育维度配色（雷达图 + 进度条复用） */
export const GROWTH_COLORS: Record<string, string> = {
  智育: "#2563eb",
  体育: "#16a34a",
  德育: "#9333ea",
  美育: "#db2777",
  劳育: "#ea580c",
};

/** 取用户邮箱或昵称的首字母作为头像 fallback */
export function initials(s: string | null | undefined): string {
  if (!s) return "?";
  return s.trim().slice(0, 1).toUpperCase();
}

/** /api/tasks 响应类型 */
export type TasksResponse = {
  tasksByDate: TasksByDate;
  segments: TaskSegment[];
  today: string;
};

export type { Category, Importance, Report, Task, TaskSegment, TasksByDate };
