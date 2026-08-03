"use client";

import { toast } from "sonner";
import type { KeyedMutator } from "swr";
import type { Task } from "@/lib/db/queries";
import type { TasksResponse } from "@/lib/home/constants";
import {
  applyAttrCascade,
  applyDeleteCascade,
} from "@/lib/home/task-tree";

/**
 * 任务变更的共享实现（task-panel 与任务编辑面板共用）：
 * 先乐观更新 SWR 缓存，再 PATCH/DELETE 服务端，失败时 revalidate 回滚。
 * 任务树级联：importance/category 的修改级联所有子孙（母节点覆盖策略），
 * 删除母节点连带删除所有子孙。
 */

type MutateTasks = KeyedMutator<TasksResponse>;

/** 乐观更新任务字段 + PATCH 服务端（importance/category 级联覆盖子孙） */
export async function patchTaskFields(
  mutate: MutateTasks,
  taskId: string,
  fields: Partial<Task>,
  body: Record<string, unknown>,
): Promise<void> {
  mutate(
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasksByDate: applyAttrCascade(prev.tasksByDate, taskId, fields),
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

/** 乐观删除任务（连带所有子孙）+ DELETE 服务端 */
export async function deleteTaskById(
  mutate: MutateTasks,
  taskId: string,
): Promise<void> {
  mutate(
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasksByDate: applyDeleteCascade(prev.tasksByDate, taskId),
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
