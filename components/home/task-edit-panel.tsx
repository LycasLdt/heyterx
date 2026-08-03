"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, ListTodo, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn, date } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import { useTasks } from "@/lib/home/use-tasks";
import { patchTaskFields } from "@/lib/home/task-mutations";
import {
  CATEGORY_VALUES,
  IMPORTANCE_VALUES,
  CATEGORY_META,
  IMPORTANCE_META,
  formatReminder,
  type Category,
  type Importance,
  type Task,
} from "@/lib/home/constants";

/**
 * 任务编辑面板：右侧 sidebar 的第四个面板（与 Agent / 导出 / 报告面板同风格）。
 * 单击任务面板中的任务时打开（store.openTaskEditor）。
 *
 * 布局（自上而下）：
 * - 无边框任务名输入框（blur / Enter 提交）
 * - 标签修改 section：重要度紧急度（四象限）+ 五育
 *   （任务树母节点覆盖策略：修改后该任务的所有子节点同步修改）
 * - 提醒 section：datetime-local 设置 / 清除
 *
 * 所有修改即改即存（乐观更新 + PATCH），任务被删除时自动关闭。
 */
export function TaskEditPanel() {
  const today = useHomeStore((s) => s.today);
  const editingTask = useHomeStore((s) => s.editingTask);
  const closeTaskEditor = useHomeStore((s) => s.closeTaskEditor);
  const { data: tasksData, mutate: mutateTasks } = useTasks();

  // 跨日期查找任务（任务可能被移动到其他日期，editingTask.date 可能已过期）
  const entry = useMemo(() => {
    if (!editingTask) return null;
    for (const [d, list] of Object.entries(tasksData.tasksByDate)) {
      const task = list.find((t) => t.id === editingTask.id);
      if (task) return { task, date: d };
    }
    return null;
  }, [editingTask, tasksData.tasksByDate]);

  // 任务被删除（或彻底不存在于已加载范围）后自动关闭面板
  useEffect(() => {
    if (editingTask && !entry) closeTaskEditor();
  }, [editingTask, entry, closeTaskEditor]);

  // 任务名草稿：切换任务时重置
  const [titleDraft, setTitleDraft] = useState("");
  const taskId = entry?.task.id;
  useEffect(() => {
    setTitleDraft(entry?.task.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // 该任务的直接子节点数（用于提示母节点覆盖策略）
  const childCount = useMemo(() => {
    if (!entry) return 0;
    let n = 0;
    for (const list of Object.values(tasksData.tasksByDate)) {
      for (const t of list) if (t.parentId === entry.task.id) n++;
    }
    return n;
  }, [entry, tasksData.tasksByDate]);

  if (!entry) return null;
  const { task, date: taskDate } = entry;
  const isPastDay = taskDate < today;

  const patch = (fields: Partial<Task>, body: Record<string, unknown>) => {
    void patchTaskFields(mutateTasks, task.id, fields, body);
  };

  const commitTitle = () => {
    const v = titleDraft.trim();
    if (!v || v === task.title) {
      setTitleDraft(task.title);
      return;
    }
    patch({ title: v }, { title: v });
  };

  const dateObj = date.parseDate(taskDate);
  const dateLabel = `${taskDate === today ? "今天" : `${dateObj.getMonth() + 1}/${dateObj.getDate()}`} 周${date.WEEKDAY_LABELS[(dateObj.getDay() + 6) % 7]}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <ListTodo className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">任务</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {dateLabel}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="关闭任务编辑"
          onClick={closeTaskEditor}
        >
          <X data-icon="inline-start" />
        </Button>
      </div>

      {/* 无边框任务名输入框 */}
      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commitTitle();
          }
        }}
        disabled={isPastDay}
        placeholder="任务名"
        className="w-full bg-transparent px-4 py-3 text-base font-medium outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:bg-muted/40 disabled:text-muted-foreground"
      />
      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 px-4 py-4">
          {/* 重要度紧急度（四象限） */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              重要度 · 紧急度
            </h3>
            {childCount > 0 && (
              <p className="text-[11px] text-muted-foreground/80">
                该任务含 {childCount} 个子任务，修改后将同步到所有子任务
              </p>
            )}
            <RadioGroup
              value={task.importance}
              onValueChange={(v) =>
                !isPastDay &&
                patch(
                  { importance: v as Importance },
                  { importance: v as Importance },
                )
              }
              className="grid grid-cols-2 gap-1.5"
            >
              {IMPORTANCE_VALUES.map((imp) => (
                <div
                  key={imp}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
                    "has-data-checked:border-primary has-data-checked:bg-primary/5",
                    isPastDay && "opacity-60",
                  )}
                >
                  <RadioGroupItem
                    id={`imp-${imp}`}
                    value={imp}
                    disabled={isPastDay}
                  />
                  <Label
                    htmlFor={`imp-${imp}`}
                    className="flex-1 cursor-pointer text-xs font-normal"
                  >
                    <span
                      className={cn(
                        "inline-flex rounded-full px-1.5 py-0.5 leading-none",
                        IMPORTANCE_META[imp].badge,
                      )}
                    >
                      {IMPORTANCE_META[imp].short}
                    </span>{" "}
                    {imp}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </section>

          {/* 五育分类 */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              五育分类
            </h3>
            <RadioGroup
              value={task.category}
              onValueChange={(v) =>
                !isPastDay &&
                patch({ category: v as Category }, { category: v as Category })
              }
              className="flex flex-wrap gap-1.5"
            >
              {CATEGORY_VALUES.map((cat) => (
                <div
                  key={cat}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors",
                    "has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5",
                    isPastDay && "opacity-60",
                  )}
                >
                  <RadioGroupItem
                    id={`cat-${cat}`}
                    value={cat}
                    disabled={isPastDay}
                  />
                  <Label
                    htmlFor={`cat-${cat}`}
                    className="cursor-pointer text-xs font-normal"
                  >
                    <span
                      className={cn(
                        "inline-flex rounded-full px-1.5 py-0.5 leading-none",
                        CATEGORY_META[cat].badge,
                      )}
                    >
                      {CATEGORY_META[cat].short}
                    </span>{" "}
                    {cat}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </section>

          <Separator />

          {/* 提醒 */}
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Bell className="size-3" />
              提醒
            </h3>
            {task.reminderAt && (
              <p className="text-xs text-muted-foreground">
                将于 {formatReminder(task.reminderAt, today)} 通过浏览器通知提醒
              </p>
            )}
            <Input
              type="datetime-local"
              value={date.isoToLocalInput(task.reminderAt)}
              onChange={(e) => {
                if (!e.target.value || isPastDay) return;
                const iso = date.localInputToIso(e.target.value);
                patch({ reminderAt: iso }, { reminderAt: iso });
              }}
              disabled={isPastDay}
              className="h-8 text-xs"
            />
            {task.reminderAt && !isPastDay && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-destructive"
                onClick={() =>
                  patch({ reminderAt: undefined }, { reminderAt: null })
                }
              >
                清除提醒
              </Button>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
