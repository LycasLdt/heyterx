import type { Task, TasksByDate } from "@/lib/db/queries";
import { date } from "@/lib/utils";

/**
 * 任务树的客户端纯工具函数（乐观更新级联、日视图/任务段树的构建）。
 * 与服务端 lib/db/queries.ts 的级联查询保持一致的语义：
 * - 完成状态：标记完成级联全部子孙；取消完成仅级联今天及以后的子孙
 * - importance / category：母节点覆盖策略，级联全部子孙
 * - 移动：子孙按相同天数偏移一并移动
 * - 删除：连带所有子孙
 */

/** 收集某任务在 tasksByDate 中的全部子孙 id（BFS，跨日期） */
export function collectDescendantIds(
  tasksByDate: TasksByDate,
  rootId: string,
): string[] {
  const childMap = new Map<string, string[]>();
  for (const list of Object.values(tasksByDate)) {
    for (const t of list) {
      if (!t.parentId) continue;
      const arr = childMap.get(t.parentId);
      if (arr) arr.push(t.id);
      else childMap.set(t.parentId, [t.id]);
    }
  }
  const out: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const c of childMap.get(cur) ?? []) {
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/**
 * 把一天的平铺任务列表组织成树：
 * - top：顶级节点（parentId 为空，或母节点不在列表中）
 * - childrenOf：母节点 id → 列表内的直接子节点
 * 基于同一个列表构建，筛选后的视图不会出现「子节点可见但母节点不可见」。
 */
export function buildDayForest(tasks: Task[]): {
  top: Task[];
  childrenOf: Map<string, Task[]>;
} {
  const ids = new Set(tasks.map((t) => t.id));
  const top: Task[] = [];
  const childrenOf = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) {
      const arr = childrenOf.get(t.parentId);
      if (arr) arr.push(t);
      else childrenOf.set(t.parentId, [t]);
    } else {
      top.push(t);
    }
  }
  return { top, childrenOf };
}

/** YYYY-MM-DD 加 N 天（本地时区安全：按本地日期加减天数） */
export function shiftDateStr(dateStr: string, days: number): string {
  const d = date.parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return date.formatDate(d);
}

/** b - a 的天数差（正数表示 b 在 a 之后） */
export function diffDays(a: string, b: string): number {
  return Math.round(
    (date.parseDate(b).getTime() - date.parseDate(a).getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

/**
 * 对 tasksByDate 应用「完成状态级联」乐观更新：
 * root 与满足条件的子孙一并切换 done。
 * - next=true：级联全部子孙（含过去日期的）
 * - next=false：仅级联今天及以后的子孙
 */
export function applyDoneCascade(
  tasksByDate: TasksByDate,
  rootId: string,
  next: boolean,
  today: string,
): TasksByDate {
  const affected = new Set([
    rootId,
    ...collectDescendantIds(tasksByDate, rootId),
  ]);
  const out: TasksByDate = {};
  for (const [d, list] of Object.entries(tasksByDate)) {
    out[d] = list.map((t) => {
      if (!affected.has(t.id)) return t;
      if (t.id === rootId) return { ...t, done: next };
      if (next || d >= today) return { ...t, done: next };
      return t;
    });
  }
  return out;
}

/**
 * 对 tasksByDate 应用「属性覆盖」乐观更新：
 * root 应用 fields；子孙仅同步 importance / category（母节点覆盖策略）。
 */
export function applyAttrCascade(
  tasksByDate: TasksByDate,
  rootId: string,
  fields: Partial<Task>,
): TasksByDate {
  const cascadeAttrs =
    fields.importance !== undefined || fields.category !== undefined;
  const affected = cascadeAttrs
    ? new Set([rootId, ...collectDescendantIds(tasksByDate, rootId)])
    : null;
  const out: TasksByDate = {};
  for (const [d, list] of Object.entries(tasksByDate)) {
    out[d] = list.map((t) => {
      if (t.id === rootId) return { ...t, ...fields };
      if (affected?.has(t.id)) {
        return {
          ...t,
          ...(fields.importance !== undefined
            ? { importance: fields.importance }
            : {}),
          ...(fields.category !== undefined
            ? { category: fields.category }
            : {}),
        };
      }
      return t;
    });
  }
  return out;
}

/** 对 tasksByDate 应用「删除级联」乐观更新：移除 root 与全部子孙 */
export function applyDeleteCascade(
  tasksByDate: TasksByDate,
  rootId: string,
): TasksByDate {
  const affected = new Set([
    rootId,
    ...collectDescendantIds(tasksByDate, rootId),
  ]);
  const out: TasksByDate = {};
  for (const [d, list] of Object.entries(tasksByDate)) {
    const kept = list.filter((t) => !affected.has(t.id));
    if (kept.length !== list.length) out[d] = kept;
    else out[d] = list;
  }
  return out;
}

/**
 * 对 tasksByDate 应用「移动级联」乐观更新：
 * root 移到 targetDate，全部子孙按相同天数偏移一并移动。
 */
export function applyMoveCascade(
  tasksByDate: TasksByDate,
  rootId: string,
  targetDate: string,
): TasksByDate {
  // 找到 root 当前日期
  let sourceDate: string | null = null;
  for (const [d, list] of Object.entries(tasksByDate)) {
    if (list.some((t) => t.id === rootId)) {
      sourceDate = d;
      break;
    }
  }
  if (!sourceDate || sourceDate === targetDate) return tasksByDate;
  const delta = diffDays(sourceDate, targetDate);
  const affected = new Set([
    rootId,
    ...collectDescendantIds(tasksByDate, rootId),
  ]);
  // 先摘下所有受影响任务并记录新日期，再按新日期归位
  const moved: Array<{ task: Task; newDate: string }> = [];
  const out: TasksByDate = {};
  for (const [d, list] of Object.entries(tasksByDate)) {
    const kept: Task[] = [];
    for (const t of list) {
      if (affected.has(t.id)) {
        moved.push({
          task: t,
          newDate: t.id === rootId ? targetDate : shiftDateStr(d, delta),
        });
      } else {
        kept.push(t);
      }
    }
    out[d] = kept;
  }
  for (const { task, newDate } of moved) {
    const list = out[newDate] ?? [];
    list.push(task);
    out[newDate] = list;
  }
  return out;
}
