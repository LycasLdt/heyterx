import type { UIMessage } from "ai";
import type { Task } from "@/lib/db/queries";

/**
 * 从一条 assistant 消息的工具调用结果中提取任务变更 diff。
 * 供 chat-panel 在 agent 完成回答后展示「修改和创建任务的 diff」。
 */

/** 单条任务变更 */
export type TaskDiffEntry = {
  kind: "added" | "updated" | "moved" | "deleted" | "toggled";
  title: string;
  /** 补充说明：更新任务的字段变化 / 移动任务的日期变化 / 切换完成状态 */
  detail?: string;
};

/** 按天分组的任务变更 */
export type TaskDayDiff = {
  date: string;
  entries: TaskDiffEntry[];
};

/** updateTask 各字段的中文标签（用于 diff 详情） */
const UPDATE_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  importance: "重要度",
  category: "分类",
  metadata: "元数据",
  reminderAt: "提醒",
  segmentId: "任务段",
};

type ToolPartLike = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};

/** 级联子任务数量的展示后缀（如「（含 2 个子任务）」），无子任务时为空串 */
function descendantSuffix(count: number | undefined): string {
  return count && count > 0 ? `（含 ${count} 个子任务）` : "";
}

/** 读取 tool part（output-available 且无顶层 error） */
function asToolPart(part: UIMessage["parts"][number]): ToolPartLike | null {
  if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
    return null;
  }
  const p = part as ToolPartLike;
  if (p.state !== "output-available" || !p.output) return null;
  if (typeof p.output === "object" && "error" in p.output && p.output.error) {
    return null;
  }
  return p;
}

/**
 * 计算一条 assistant 消息中所有任务修改/创建工具的变更 diff。
 * 仅统计 addTask / updateTask / moveTask / deleteTask / toggleTask 的成功输出，
 * 按天分组（日期升序），同一天内按工具调用顺序排列。
 */
export function computeMessageTaskDiff(
  msg: UIMessage,
  today: string,
): TaskDayDiff[] {
  const byDate = new Map<string, TaskDiffEntry[]>();
  const push = (date: string, entry: TaskDiffEntry) => {
    const list = byDate.get(date);
    if (list) list.push(entry);
    else byDate.set(date, [entry]);
  };

  for (const part of msg.parts) {
    const p = asToolPart(part);
    if (!p) continue;

    if (p.type === "tool-addTask") {
      const input = p.input as {
        tasks?: Array<{ title?: string; date?: string }>;
      };
      const output = p.output as { created?: Task[] };
      if (!Array.isArray(output.created)) continue;
      const inputs = Array.isArray(input.tasks) ? input.tasks : [];
      output.created.forEach((task, i) => {
        push(inputs[i]?.date ?? today, { kind: "added", title: task.title });
      });
      continue;
    }

    if (p.type === "tool-updateTask") {
      const input = p.input as {
        updates?: Array<Record<string, unknown> & { date?: string }>;
      };
      const output = p.output as {
        updated?: Array<{ task: Task | null; error?: string }>;
      };
      if (!Array.isArray(output.updated)) continue;
      const updates = Array.isArray(input.updates) ? input.updates : [];
      output.updated.forEach((r, i) => {
        if (!r.task) return;
        const u = updates[i] ?? {};
        const fields = Object.keys(UPDATE_FIELD_LABELS)
          .filter((k) => u[k] !== undefined)
          .map((k) => UPDATE_FIELD_LABELS[k]);
        push(u.date ?? today, {
          kind: "updated",
          title: r.task.title,
          detail: fields.length > 0 ? fields.join("、") : undefined,
        });
      });
      continue;
    }

    if (p.type === "tool-moveTask") {
      const output = p.output as {
        moved?: Array<{
          task: Task | null;
          from: string;
          to: string;
          movedDescendants?: number;
        }>;
      };
      if (!Array.isArray(output.moved)) continue;
      for (const r of output.moved) {
        if (!r.task) continue;
        push(r.to, {
          kind: "moved",
          title: r.task.title,
          detail: `${r.from} → ${r.to}${descendantSuffix(r.movedDescendants)}`,
        });
      }
      continue;
    }

    if (p.type === "tool-shiftTasks") {
      const output = p.output as {
        shifted?: Array<{
          task: Task | null;
          from: string;
          to: string;
          movedCount?: number;
        }>;
      };
      if (!Array.isArray(output.shifted)) continue;
      for (const r of output.shifted) {
        if (!r.task) continue;
        const children = (r.movedCount ?? 1) - 1;
        push(r.to, {
          kind: "moved",
          title: r.task.title,
          detail: `${r.from} → ${r.to}（整体偏移${descendantSuffix(children)}）`,
        });
      }
      continue;
    }

    if (p.type === "tool-deleteTask") {
      const output = p.output as {
        deleted?: Array<{
          task: Task | null;
          date?: string;
          removedDescendants?: number;
        }>;
      };
      if (!Array.isArray(output.deleted)) continue;
      for (const r of output.deleted) {
        if (!r.task) continue;
        push(r.date ?? today, {
          kind: "deleted",
          title: r.task.title,
          detail: descendantSuffix(r.removedDescendants) || undefined,
        });
      }
      continue;
    }

    if (p.type === "tool-toggleTask") {
      const output = p.output as {
        date?: string;
        task?: Task | null;
        toggledDescendants?: number;
      };
      if (!output.task) continue;
      push(output.date ?? today, {
        kind: "toggled",
        title: output.task.title,
        detail: `${output.task.done ? "标记完成" : "取消完成"}${descendantSuffix(output.toggledDescendants)}`,
      });
      continue;
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, entries]) => ({ date, entries }));
}
