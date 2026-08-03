"use client";

import { toast } from "sonner";
import type { KeyedMutator } from "swr";
import type { Task } from "@/lib/db/queries";
import type { TasksResponse } from "@/lib/home/constants";

/**
 * 任务变更的共享实现（task-panel 与任务编辑面板共用）：
 * 先乐观更新 SWR 缓存，再 PATCH/DELETE 服务端，失败时 revalidate 回滚。
 */

type MutateTasks = KeyedMutator<TasksResponse>;

/** 乐观更新任务字段 + PATCH 服务端 */
export async function patchTaskFields(
  mutate: MutateTasks,
  taskDate: string,
  taskId: string,
  fields: Partial<Task>,
  body: Record<string, unknown>,
): Promise<void> {
  mutate(
    (prev) => {
      if (!prev) return prev;
      const list = prev.tasksByDate[taskDate] ?? [];
      return {
        ...prev,
        tasksByDate: {
          ...prev.tasksByDate,
          [taskDate]: list.map((t) =>
            t.id === taskId ? { ...t, ...fields } : t,
          ),
        },
      };
    },
    { revalidate: false },
  );
  try {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, ...body }),
    });
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
  } catch {
    mutate();
    toast.error("保存失败，请重试");
  }
}

/** 乐观删除任务 + DELETE 服务端 */
export async function deleteTaskById(
  mutate: MutateTasks,
  taskDate: string,
  taskId: string,
): Promise<void> {
  mutate(
    (prev) => {
      if (!prev) return prev;
      const list = prev.tasksByDate[taskDate] ?? [];
      return {
        ...prev,
        tasksByDate: {
          ...prev.tasksByDate,
          [taskDate]: list.filter((t) => t.id !== taskId),
        },
      };
    },
    { revalidate: false },
  );
  try {
    const res = await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });
    if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
    toast.success("已删除");
  } catch {
    mutate();
    toast.error("删除失败，请重试");
  }
}
