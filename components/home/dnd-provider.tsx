"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { isSortable } from "@dnd-kit/react/sortable";
import { DragStartEvent, DragOverEvent, DragEndEvent } from "@dnd-kit/dom";
import { useHomeStore } from "@/lib/home/store";
import { useTasks } from "@/lib/home/use-tasks";
import {
  QUADRANT_ORDER,
  type Importance,
  type Task,
} from "@/lib/home/constants";
import type { TaskDragData } from "@/components/home/task-panel";
import { date } from "@/lib/utils";

/** 周历导航按钮拖拽节流间隔（毫秒） */
const WEEK_NAV_THROTTLE_MS = 500;

/**
 * 拖拽上下文提供者（dnd-kit）。
 *
 * 职责：
 * 1. 包裹 DragDropProvider，提供拖拽上下文
 * 2. onDragStart：从当前选中日期的任务构建 sortableOrder 快照
 * 3. onDragOver：
 *    - 周历日期格 → 设 dragOverDate（触发 popover 预览）
 *    - 上下周按钮 → 节流切换 weekOffset
 *    - sortable 容器 → 用 move() 实时更新 sortableOrder
 * 4. onDragEnd：
 *    - 拖到对话框 → 末尾追加 @<任务名> 引用
 *    - 拖到周历日期格 → 跨日期移动 + toast 撤回，清空 sortableOrder 后切换页面
 *    - 拖到上下周按钮 → 视为取消
 *    - sortable 容器 → 写回 SWR + 跨象限 PATCH importance
 */
export function DndProvider({ children }: { children: React.ReactNode }) {
  const today = useHomeStore((s) => s.today);
  const selectedDate = useHomeStore((s) => s.selectedDate);
  const viewMode = useHomeStore((s) => s.viewMode);
  const setSortableOrder = useHomeStore((s) => s.setSortableOrder);
  const setDragOverDate = useHomeStore((s) => s.setDragOverDate);
  const setSelectedDate = useHomeStore((s) => s.setSelectedDate);
  const prevWeek = useHomeStore((s) => s.prevWeek);
  const nextWeek = useHomeStore((s) => s.nextWeek);
  const insertChatMention = useHomeStore((s) => s.insertChatMention);
  const { data: tasksData, mutate: mutateTasks } = useTasks();

  // 周历导航节流：记录上次切换时间
  const lastNavRef = useRef(0);

  /** 从 target.id 解析日期格日期；非日期格返回 null */
  const parseDateCellId = (id: unknown): string | null => {
    if (typeof id !== "string") return null;
    if (!id.startsWith("date:")) return null;
    return id.slice(5);
  };

  /** 拖拽开始：从 SWR 缓存构建 sortableOrder 快照 */
  const handleDragStart = ({ operation }: DragStartEvent) => {
    const source = operation.source;
    if (!source || source.type !== "task") return;

    const dayTasks = tasksData.tasksByDate[selectedDate] ?? [];
    const order: Record<string, string[]> = {};

    if (viewMode === "quadrant") {
      for (const imp of QUADRANT_ORDER) {
        order[imp] = dayTasks
          .filter((t) => t.importance === imp)
          .map((t) => t.id);
      }
    } else {
      order["list"] = dayTasks.map((t) => t.id);
    }

    setSortableOrder(order);
  };

  /** 拖拽进行中：周历导航节流 / 日期格设 dragOverDate / sortable 用 move 更新 */
  const handleDragOver = (event: DragOverEvent) => {
    const { target } = event.operation;
    const targetId = target?.id;

    // 周历导航按钮：节流切换周
    if (targetId === "week-nav-prev" || targetId === "week-nav-next") {
      const now = Date.now();
      if (now - lastNavRef.current >= WEEK_NAV_THROTTLE_MS) {
        lastNavRef.current = now;
        if (targetId === "week-nav-prev") prevWeek();
        else nextWeek();
      }
      return;
    }

    // 周历日期格：设 dragOverDate（popover 预览）
    const dateCellDate = parseDateCellId(targetId);
    if (dateCellDate) {
      setDragOverDate(dateCellDate);
      return;
    }

    // 离开周历区域：清除 dragOverDate
    setDragOverDate(null);

    // sortable 容器内：用 move() 实时更新排序快照
    const current = useHomeStore.getState().sortableOrder;
    if (!current) return;
    const next = move(current, event);
    if (next !== current) {
      setSortableOrder(next);
    }
  };

  /**
   * 跨日期移动任务 + toast 撤回 action。
   * 保持任务 importance 不变（移到目标日期的对应象限）。
   */
  const moveTaskCrossDate = (
    taskId: string,
    title: string,
    sourceDate: string,
    targetDate: string,
  ) => {
    // optimisticMove：从 sourceDate 移除，添加到 targetDate
    mutateTasks(
      (prev) => {
        if (!prev) return prev;
        const oldList = prev.tasksByDate[sourceDate] ?? [];
        const newList = prev.tasksByDate[targetDate] ?? [];
        const task = oldList.find((t) => t.id === taskId);
        if (!task) return prev;
        return {
          ...prev,
          tasksByDate: {
            ...prev.tasksByDate,
            [sourceDate]: oldList.filter((t) => t.id !== taskId),
            [targetDate]: [...newList, task],
          },
        };
      },
      { revalidate: false },
    );

    // PATCH 服务端
    (async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: taskId, date: targetDate }),
        });
        if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      } catch {
        mutateTasks();
        toast.error("移动任务失败，请重试");
      }
    })();

    toast.success(
      `已将「${title}」移至 ${date.formatDateDivider(targetDate, today)}`,
      {
        action: {
          label: "撤回",
          onClick: () => {
            mutateTasks(
              (prev) => {
                if (!prev) return prev;
                const oldList = prev.tasksByDate[targetDate] ?? [];
                const newList = prev.tasksByDate[sourceDate] ?? [];
                const task = oldList.find((t) => t.id === taskId);
                if (!task) return prev;
                return {
                  ...prev,
                  tasksByDate: {
                    ...prev.tasksByDate,
                    [targetDate]: oldList.filter((t) => t.id !== taskId),
                    [sourceDate]: [...newList, task],
                  },
                };
              },
              { revalidate: false },
            );
            setSelectedDate(sourceDate);
            (async () => {
              try {
                const res = await fetch("/api/tasks", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: taskId, date: sourceDate }),
                });
                if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
              } catch {
                mutateTasks();
                toast.error("撤回失败，请重试");
              }
            })();
            toast.success(
              `已撤回「${title}」至 ${date.formatDateDivider(sourceDate, today)}`,
            );
          },
        },
      },
    );
  };

  /** 拖拽结束：应用变更到 SWR + 服务端，然后清空快照 */
  const handleDragEnd = ({ operation, canceled }: DragEndEvent) => {
    const { source, target } = operation;

    if (!source || source.type !== "task") {
      setSortableOrder(null);
      setDragOverDate(null);
      return;
    }

    const dragData = source.data as TaskDragData | undefined;

    // 拖到对话框 → 末尾追加 @<任务名>（由 chat-panel 消费 chatMention 写入输入框）
    if (target?.id === "chat-input") {
      if (dragData?.kind === "task") {
        insertChatMention(dragData.title);
      }
      setSortableOrder(null);
      setDragOverDate(null);
      return;
    }

    // 拖到周历导航按钮 → 视为取消（仅切换周，不执行 drop）
    if (target?.id === "week-nav-prev" || target?.id === "week-nav-next") {
      setSortableOrder(null);
      setDragOverDate(null);
      return;
    }

    // 拖到周历日期格 → 跨日期移动 + toast 撤回，清空后切换页面
    const dateCellDate = parseDateCellId(target?.id);
    if (dateCellDate && dragData?.kind === "task") {
      const targetDate = dateCellDate;
      const sourceTask = (tasksData.tasksByDate[selectedDate] ?? []).find(
        (t) => t.id === dragData.taskId,
      );
      if (sourceTask?.done) {
        toast.error("已完成的任务不能移动到其他日期");
      } else if (targetDate < today) {
        toast.error("不能把任务移到过去的日期");
      } else if (targetDate !== selectedDate) {
        moveTaskCrossDate(dragData.taskId, dragData.title, selectedDate, targetDate);
        // 清空 sortableOrder 后切换页面
        setSortableOrder(null);
        setDragOverDate(null);
        setSelectedDate(targetDate);
        return;
      }
      setSortableOrder(null);
      setDragOverDate(null);
      return;
    }

    // 取消拖拽（如按 Esc）→ 仅清空
    if (canceled) {
      setSortableOrder(null);
      setDragOverDate(null);
      return;
    }

    // 排序/跨象限：应用 sortableOrder 到 SWR 缓存
    if (isSortable(source)) {
      const finalOrder = useHomeStore.getState().sortableOrder;
      const dayTasks = tasksData.tasksByDate[selectedDate] ?? [];
      const taskMap = new Map(dayTasks.map((t) => [t.id, t]));

      // 检测跨象限移动
      let importanceChange: {
        taskId: string;
        newImportance: Importance;
      } | null = null;

      if (finalOrder) {
        // 根据 finalOrder 构建新的平铺数组
        let newFlat: Task[];
        if (viewMode === "quadrant") {
          const entries = Object.entries(finalOrder);

          const newImportance = entries.find(([_, ids]) =>
            ids.includes(source.id as string),
          )?.[0] as Importance | undefined;
          if (
            newImportance &&
            newImportance !== taskMap.get(source.id as string)?.importance
          )
            importanceChange = { taskId: source.id as string, newImportance };

          newFlat = entries.reduce(
            (prev, [importance, ids]) => [
              ...prev,
              ...ids
                .map((id) => {
                  const task = taskMap.get(id);
                  if (!task) return null;
                  return { ...task, importance } as Task;
                })
                .filter((t): t is Task => t !== null),
            ],
            [] as Task[],
          );
        } else {
          newFlat = (finalOrder["list"] ?? [])
            .map((id) => taskMap.get(id))
            .filter((t): t is Task => t !== undefined);
        }

        // 写回 SWR（乐观更新，revalidate: false）
        mutateTasks(
          (prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              tasksByDate: {
                ...prev.tasksByDate,
                [selectedDate]: newFlat,
              },
            };
          },
          { revalidate: false },
        );
      }

      // 跨象限：PATCH 服务端 importance
      if (importanceChange) {
        void (async () => {
          try {
            const res = await fetch("/api/tasks", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: importanceChange.taskId,
                importance: importanceChange.newImportance,
              }),
            });
            if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
          } catch {
            mutateTasks();
          }
        })();
      }
    }

    setSortableOrder(null);
    setDragOverDate(null);
  };

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay>
        {(source) => {
          if (!source || source.type !== "task") return null;
          const d = source.data as TaskDragData | undefined;
          if (d?.kind !== "task") return null;
          return (
            <div className="pointer-events-none max-w-xs rounded-lg border bg-card px-3 py-2 text-sm shadow-lg">
              <span className="font-medium">{d.title}</span>
            </div>
          );
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}
