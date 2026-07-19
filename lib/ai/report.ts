import { streamText, Output } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { z } from "zod";
import { reportQueries, taskQueries } from "@/lib/db/queries";
import type {
  ReportMetrics,
  ReportType,
} from "@/lib/db/schema";
import { formatDate, parseDate } from "@/lib/utils/date";

/**
 * 报告生成器：从 agent 中分离出来，直接用 streamText + Output.object 结构化输出。
 * 调用顺序固定：加载周期任务 → 计算指标 → 把指标作为上下文喂给模型 → 模型只生成
 * title / summary / planTasks（不自己算数字）→ 路由层再用 reportQueries.create 持久化。
 * 与 agent 对话消息完全不同步。
 */

/** 模型结构化输出 schema */
const reportOutputSchema = z.object({
  title: z
    .string()
    .describe(
      '报告标题，如「第 26 周周报」「7 月月报」「暑假阶段报」。周报用"第 N 周周报"，月报用"X 月月报"，阶段报用任务段名+「阶段报」',
    ),
  summary: z
    .string()
    .describe(
      "本周期的 markdown 文字复盘总结，应包含：完成情况总览（引用给定指标里的真实数字）、亮点、不足、心理绿芽指数解读（引用给定的总分与各维度分）、1-2 条可改进建议。语气温暖鼓励。",
    ),
  planTasks: z
    .array(
      z.object({
        title: z.string().describe("下周期规划任务标题，具体可执行（含内容/时长/数量）"),
        importance: z
          .enum(["重要且紧急", "重要但不紧急", "不重要但紧急", "不重要且不紧急"])
          .describe("重要度紧急度四象限"),
        category: z
          .enum(["德育", "智育", "体育", "美育", "劳育"])
          .describe("五育分类"),
        date: z
          .string()
          .describe("计划安排到下周期的哪一天，YYYY-MM-DD，必须在给定的下周期日期范围内"),
      }),
    )
    .min(1)
    .describe("下周期规划任务列表，根据本周完成情况优化，补足欠缺的五育维度，适当加入体育/美育/劳育缓冲微任务（3-10 分钟）"),
});

export type ReportGeneratorInput = {
  userId: string;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  segmentId?: string;
  segmentName?: string;
};

export type ReportGeneratorOutput = {
  title: string;
  summary: string;
  planTasks: Array<{
    title: string;
    importance: string;
    category: string;
    date: string;
  }>;
};

/** 计算下周期日期范围（用于 planTasks 的日期分布提示） */
function nextPeriodRange(
  type: ReportType,
  periodEnd: string,
): { start: string; end: string } {
  const end = parseDate(periodEnd);
  if (type === "weekly") {
    // 下周一 = 本周日 + 1；下周日 = 下周一 + 6
    const nextMonday = new Date(end);
    nextMonday.setDate(end.getDate() + 1);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    return { start: formatDate(nextMonday), end: formatDate(nextSunday) };
  }
  if (type === "monthly") {
    // 下个月 1 日 ~ 下个月最后一天
    const nextMonthFirst = new Date(end.getFullYear(), end.getMonth() + 1, 1);
    const nextMonthLast = new Date(end.getFullYear(), end.getMonth() + 2, 0);
    return {
      start: formatDate(nextMonthFirst),
      end: formatDate(nextMonthLast),
    };
  }
  // stage：没有明确的下周期，默认给 periodEnd 之后 7 天作为规划窗口
  const start = new Date(end);
  start.setDate(end.getDate() + 1);
  const last = new Date(start);
  last.setDate(start.getDate() + 6);
  return { start: formatDate(start), end: formatDate(last) };
}

const TYPE_LABEL: Record<ReportType, string> = {
  weekly: "周报",
  monthly: "月报",
  stage: "阶段报",
};

/** 把指标格式化为给模型看的可读文本 */
function formatMetricsForPrompt(metrics: ReportMetrics): string {
  const dims = metrics.growthIndex.dimensions
    .map(
      (d) =>
        `  - ${d.label}（${d.category}）：${d.score} 分（权重 ${d.weight}）`,
    )
    .join("\n");
  const cats = metrics.categoryDistribution
    .map(
      (c) =>
        `  - ${c.category}：${c.completed}/${c.count} 完成，完成率 ${c.rate}%`,
    )
    .join("\n");
  const imps = metrics.importanceDistribution
    .map((i) => `  - ${i.importance}：${i.completed}/${i.count} 完成`)
    .join("\n");
  return `完成率：${metrics.completedTasks}/${metrics.totalTasks}（${metrics.completionRate}%）
心理绿芽指数总分：${metrics.growthIndex.total} / 100
五育分布：
${cats}
四象限分布：
${imps}
心理绿芽指数各维度：
${dims}`;
}

/** 把周期内任务格式化为给模型看的清单 */
function formatTasksForPrompt(
  tasks: Array<{ title: string; date: string; done: boolean; category: string; importance: string }>,
): string {
  if (tasks.length === 0) return "（本周期无任务记录）";
  // 按日期分组
  const byDate = new Map<string, Array<{ title: string; done: boolean; category: string; importance: string }>>();
  for (const t of tasks) {
    const list = byDate.get(t.date) ?? [];
    list.push({ title: t.title, done: t.done, category: t.category, importance: t.importance });
    byDate.set(t.date, list);
  }
  const lines: string[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate.get(date)!;
    lines.push(`【${date}】`);
    for (const t of list) {
      lines.push(
        `  ${t.done ? "[完成]" : "[未完成]"} ${t.title}（${t.importance} / ${t.category}）`,
      );
    }
  }
  return lines.join("\n");
}

/** 构造 system + prompt */
function buildPrompt(args: {
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  segmentName?: string;
  tasksText: string;
  metricsText: string;
  nextStart: string;
  nextEnd: string;
}): { system: string; prompt: string } {
  const typeLabel = TYPE_LABEL[args.type];
  const system = `你是 heyterx 学习/生活管理应用的报告生成助手。你的任务是根据给定周期内的真实任务数据与已计算好的结构化指标，生成一份${typeLabel}。
严格规则：
1. 指标数字（完成率、五育分布、心理绿芽指数总分与各维度分）由系统给你，你必须在 summary 中引用这些真实数字，绝不能自己编造或估算任何数字。
2. summary 用 markdown，结构清晰，语气温暖鼓励，像一个关心用户成长的朋友。控制在 300-500 字。
3. planTasks 是下周期规划，必须基于本周完成情况优化：补足欠缺的五育维度、保持优势维度、任务具体可执行、适当加入体育/美育/劳育缓冲微任务（3-10 分钟，归为"不重要且不紧急"）。
4. planTasks 的 date 必须落在给定的下周期日期范围内（${args.nextStart} ~ ${args.nextEnd}）。`;
  const prompt = `报告类型：${typeLabel}
周期：${args.periodStart} ~ ${args.periodEnd}${args.segmentName ? `（任务段：${args.segmentName}）` : ""}

本周期任务清单：
${args.tasksText}

本周期结构化指标（真实数据，请引用）：
${args.metricsText}

下周期规划日期范围：${args.nextStart} ~ ${args.nextEnd}

请生成这份${typeLabel}，输出 title、summary（markdown）、planTasks（下周期规划任务数组，date 必须在 ${args.nextStart} ~ ${args.nextEnd} 之间）。`;
  return { system, prompt };
}

/**
 * 生成报告内容（结构化输出）。不持久化——持久化由调用方（路由）通过 reportQueries.create 完成。
 * 抛出异常表示生成失败。
 */
export async function generateReportContent(
  input: ReportGeneratorInput,
): Promise<ReportGeneratorOutput> {
  // 1. 加载周期任务并计算指标（模型不自己算数字）
  const tasks = await taskQueries.loadInRange(
    input.userId,
    input.periodStart,
    input.periodEnd,
  );
  const metrics = reportQueries.computeMetrics(tasks);
  const next = nextPeriodRange(input.type, input.periodEnd);

  const { system, prompt } = buildPrompt({
    type: input.type,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    segmentName: input.segmentName,
    tasksText: formatTasksForPrompt(tasks),
    metricsText: formatMetricsForPrompt(metrics),
    nextStart: next.start,
    nextEnd: next.end,
  });

  // 2. 流式生成结构化对象，await 最终输出
  const result = streamText({
    model: deepseek("deepseek-v4-flash"),
    system,
    prompt,
    output: Output.object({ schema: reportOutputSchema }),
  });

  const output = await result.output;
  if (!output) {
    throw new Error("报告生成失败：模型未返回有效结构化输出");
  }
  return output;
}
