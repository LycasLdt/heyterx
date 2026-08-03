"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  Filter,
  LayoutGrid,
  LayoutList,
  Layers,
  Pencil,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { cn, date } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import { useTasks } from "@/lib/home/use-tasks";
import {
  deleteTaskById,
  patchTaskFields,
} from "@/lib/home/task-mutations";
import { TaskBadges } from "@/components/home/reports";
import { WeekCalendar } from "@/components/home/week-calendar";
import {
  CATEGORY_META,
  IMPORTANCE_META,
  QUADRANT_ORDER,
  formatReminder,
  pickFeedback,
  segmentBadgeClass,
  type Category,
  type Importance,
  type Task,
  type TaskSegment,
} from "@/lib/home/constants";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Feedback } from "@dnd-kit/dom";
import { CollisionPriority } from "@dnd-kit/abstract";

export type ViewMode = "list" | "quadrant";

/**
 * 任务下方的扩展徽章：任务段标识 + 自定义标签 + 提醒时间。
 * 只在对应字段存在时渲染，保持简洁。
 */
function TaskMetaBadges({
  task,
  segments,
  today,
}: {
  task: Task;
  segments: TaskSegment[];
  today: string;
}) {
  const segIndex = task.segmentId
    ? segments.findIndex((s) => s.id === task.segmentId)
    : -1;
  const segment = segIndex >= 0 ? segments[segIndex] : null;
  const hasReminder = task.reminderAt && !task.done;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {segment && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
            segmentBadgeClass(segIndex),
          )}
        >
          <Layers className="size-2.5" />
          {segment.name}
        </span>
      )}
      {(task.tags ?? []).map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
        >
          <Tag className="size-2.5" />
          {tag}
        </span>
      ))}
      {hasReminder && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-orange-700 dark:text-orange-300">
          <Bell className="size-2.5" />
          {formatReminder(task.reminderAt!, today)}
        </span>
      )}
    </div>
  );
}

/** 拖拽任务时携带的数据（dnd-kit useSortable data） */
export type TaskDragData = {
  kind: "task";
  taskId: string;
  date: string;
  title: string;
};

type EditMode = "rename" | "reminder" | "tags" | "delete";
type EditState = { task: Task; date: string; mode: EditMode } | null;

/**
 * 任务卡片共享渲染层：负责布局、复选框、徽章、右键上下文菜单。
 * 拖拽通过 dnd-kit useSortable 实现：外层传入 dragRef 和 isDragging。
 * 单击卡片（非复选框区域）打开右侧任务编辑面板；复选框点击仍为切换完成状态。
 */
function TaskCardShell({
  task,
  date: taskDate,
  segments,
  today,
  isPastDay,
  showImportance,
  variant,
  isDragging,
  dragRef,
  onCheck,
  onEdit,
}: {
  task: Task;
  date: string;
  segments: TaskSegment[];
  today: string;
  isPastDay: boolean;
  showImportance: boolean;
  variant: "list" | "quadrant";
  isDragging: boolean;
  dragRef?: (element: Element | null) => void;
  onCheck: (task: Task, next: boolean, date: string) => void;
  onEdit: (mode: EditMode, task: Task, date: string) => void;
}) {
  const openTaskEditor = useHomeStore((s) => s.openTaskEditor);
  const isList = variant === "list";
  const canEdit = !isPastDay;
  const canDelete = !isPastDay || !task.done;
  const hasMenu = canEdit || canDelete;

  const cardContent = (
    <>
      {/* 复选框点击不冒泡：避免触发卡片的「打开编辑面板」 */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <span onClick={(e) => e.stopPropagation()} className="inline-flex">
        <Checkbox
          checked={task.done}
          onCheckedChange={(v) => onCheck(task, v === true, taskDate)}
          className={cn("mt-0.5", isList ? "size-5" : "size-4")}
          disabled={isPastDay}
        />
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <span
          className={cn(
            "text-sm leading-snug",
            task.done
              ? "text-muted-foreground line-through"
              : "text-foreground",
          )}
        >
          {task.title}
        </span>
        <TaskBadges task={task} showImportance={showImportance} />
        <TaskMetaBadges task={task} segments={segments} today={today} />
      </div>
    </>
  );

  // 单击打开任务编辑面板（仅可编辑的非过去任务）
  const handleCardClick = canEdit
    ? () => openTaskEditor(task.id, taskDate)
    : undefined;

  const labelClass = cn(
    "flex w-full items-start gap-3 transition-colors",
    isList ? "rounded-lg px-3 py-2.5" : "rounded-md px-2 py-1.5",
    isPastDay ? "cursor-default" : "cursor-pointer hover:bg-muted",
    isDragging && "opacity-40",
    dragRef && "active:cursor-grabbing",
  );

  if (!hasMenu) {
    return (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div ref={dragRef} className={labelClass} onClick={handleCardClick}>
        {cardContent}
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
          <div ref={dragRef} className={labelClass} onClick={handleCardClick} />
        }
        className={labelClass}
      >
        {cardContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canEdit && (
          <>
            <ContextMenuItem onClick={() => onEdit("rename", task, taskDate)}>
              <Pencil className="size-3.5" />
              <span>修改任务名</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onEdit("reminder", task, taskDate)}>
              <Bell className="size-3.5" />
              <span>{task.reminderAt ? "修改提醒" : "添加提醒"}</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onEdit("tags", task, taskDate)}>
              <Tag className="size-3.5" />
              <span>编辑标签</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {canDelete && (
          <ContextMenuItem
            variant="destructive"
            onClick={() => onEdit("delete", task, taskDate)}
          >
            <Trash2 className="size-3.5" />
            <span>删除</span>
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** 公共卡片属性（SortableTaskCard 和 PlainTaskCard 共享） */
type CardCommonProps = {
  task: Task;
  date: string;
  segments: TaskSegment[];
  today: string;
  isPastDay: boolean;
  showImportance: boolean;
  variant: "list" | "quadrant";
  onCheck: (task: Task, next: boolean, date: string) => void;
  onEdit: (mode: EditMode, task: Task, date: string) => void;
};

/**
 * 可拖拽任务卡片：useSortable 注入 ref + isDragging。
 * 用于非过去日期且无筛选时的列表/四象限视图。
 */
function SortableTaskCard({
  task,
  date: taskDate,
  segments,
  today,
  isPastDay,
  showImportance,
  variant,
  index,
  group,
  onCheck,
  onEdit,
}: CardCommonProps & {
  index: number;
  group: string;
}) {
  const { ref, isDragging } = useSortable({
    id: task.id,
    data: {
      kind: "task",
      taskId: task.id,
      date: taskDate,
      title: task.title,
    } satisfies TaskDragData,
    type: "task",
    accept: "task",
    index,
    group,
    plugins: [Feedback.configure({ feedback: "clone" })],
  });
  return (
    <TaskCardShell
      task={task}
      date={taskDate}
      segments={segments}
      today={today}
      isPastDay={isPastDay}
      showImportance={showImportance}
      variant={variant}
      isDragging={isDragging}
      dragRef={ref}
      onCheck={onCheck}
      onEdit={onEdit}
    />
  );
}

/**
 * 不可拖拽任务卡片（过去日期或有筛选时使用）。
 */
function PlainTaskCard(props: CardCommonProps) {
  return (
    <TaskCardShell
      {...props}
      isDragging={false}
      onCheck={props.onCheck}
      onEdit={props.onEdit}
    />
  );
}

/** 象限卡片公共属性 */
type QuadrantCardProps = {
  importance: Importance;
  tasks: Task[];
  date: string;
  segments: TaskSegment[];
  today: string;
  isPastDay: boolean;
  dimmed: boolean;
  showImportance: boolean;
  onCheck: (task: Task, next: boolean, date: string) => void;
  onEdit: (mode: EditMode, task: Task, date: string) => void;
};

/**
 * 四象限视图中的单个象限卡片。
 * canDrag=true 时使用 useDroppable + SortableTaskCard，否则渲染纯静态卡片。
 */
function QuadrantCard({
  canDrag,
  ...props
}: QuadrantCardProps & { canDrag: boolean }) {
  if (canDrag) return <DroppableQuadrantCard {...props} />;
  return <StaticQuadrantCard {...props} />;
}

/** 可放置的象限卡片：useDroppable + SortableTaskCard */
function DroppableQuadrantCard({
  importance,
  tasks,
  date,
  segments,
  today,
  isPastDay,
  dimmed,
  showImportance,
  onCheck,
  onEdit,
}: QuadrantCardProps) {
  const { ref, isDropTarget } = useDroppable({
    id: importance,
    type: "quadrant",
    accept: "task",
    collisionPriority: CollisionPriority.Low,
  });
  const meta = IMPORTANCE_META[importance];
  return (
    <div
      ref={ref}
      className={cn(
        "flex min-h-24 flex-col rounded-lg border p-2 transition-all",
        dimmed && "opacity-40 pointer-events-none",
        isDropTarget && "border-ring ring-3 ring-ring/50",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={cn(
            "rounded-full px-4 py-1 text-xs font-medium leading-none",
            meta.badge,
          )}
        >
          {meta.quadrant}
        </span>
        <span className="text-xs text-muted-foreground">{tasks.length} 项</span>
      </div>
      {tasks.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-3 text-center text-xs text-muted-foreground">
          无
        </p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((task, index) => (
            <li key={task.id}>
              <SortableTaskCard
                task={task}
                date={date}
                segments={segments}
                today={today}
                isPastDay={isPastDay}
                showImportance={showImportance}
                variant="quadrant"
                index={index}
                group={importance}
                onCheck={onCheck}
                onEdit={onEdit}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 静态象限卡片（过去日期或有筛选时使用） */
function StaticQuadrantCard({
  importance,
  tasks,
  date,
  segments,
  today,
  isPastDay,
  dimmed,
  showImportance,
  onCheck,
  onEdit,
}: QuadrantCardProps) {
  const meta = IMPORTANCE_META[importance];
  return (
    <div
      className={cn(
        "flex min-h-24 flex-col rounded-lg border p-2 transition-all",
        dimmed && "opacity-40 pointer-events-none",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={cn(
            "rounded-full px-4 py-1 text-xs font-medium leading-none",
            meta.badge,
          )}
        >
          {meta.quadrant}
        </span>
        <span className="text-xs text-muted-foreground">{tasks.length} 项</span>
      </div>
      {tasks.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-3 text-center text-xs text-muted-foreground">
          无
        </p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <PlainTaskCard
                task={task}
                date={date}
                segments={segments}
                today={today}
                isPastDay={isPastDay}
                showImportance={showImportance}
                variant="quadrant"
                onCheck={onCheck}
                onEdit={onEdit}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 任务段详情 Dialog：展示某个任务段的所有任务，支持搜索和跳转。
 * 点击跳转按钮会切换 selectedDate 到任务所在日期并关闭 dialog。
 */
function SegmentDialog({
  segment,
  index,
  tasksByDate,
  today,
  onClose,
  onJump,
}: {
  segment: TaskSegment;
  index: number;
  tasksByDate: Record<string, Task[]>;
  today: string;
  onClose: () => void;
  onJump: (date: string) => void;
}) {
  const [search, setSearch] = useState("");

  // 收集该任务段的所有任务（带日期）
  const allEntries = useMemo(() => {
    const entries: Array<{ task: Task; date: string }> = [];
    for (const [d, list] of Object.entries(tasksByDate)) {
      for (const task of list) {
        if (task.segmentId === segment.id) entries.push({ task, date: d });
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  }, [tasksByDate, segment.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter((e) => e.task.title.toLowerCase().includes(q));
  }, [allEntries, search]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
                segmentBadgeClass(index),
              )}
            >
              <Layers className="size-2.5" />
              {segment.name}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {segment.startDate} ~ {segment.endDate} · {allEntries.length} 项
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务标题…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <ScrollArea className="max-h-80">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {search ? "没有匹配的任务。" : "该任务段暂无任务。"}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map(({ task, date: d }) => {
                const dateObj = date.parseDate(d);
                const weekday = date.WEEKDAY_LABELS[(dateObj.getDay() + 6) % 7];
                const dateLabel =
                  d === today
                    ? "今天"
                    : `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <Checkbox checked={task.done} disabled className="size-4" />
                    <div className="flex flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          "text-sm leading-snug",
                          task.done && "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {dateLabel} 周{weekday}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-6 shrink-0"
                      onClick={() => onJump(d)}
                      aria-label="跳转到该任务"
                    >
                      <ArrowUpRight className="size-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 任务编辑 Dialog 集合：修改任务名 / 添加提醒 / 编辑标签 / 删除确认。
 * 根据 editState.mode 渲染对应的 Dialog。
 */
function TaskEditDialogs({
  editState,
  allTags,
  onClose,
  onRename,
  onSetReminder,
  onSetTags,
  onDelete,
}: {
  editState: EditState;
  allTags: string[];
  onClose: () => void;
  onRename: (taskId: string, date: string, title: string) => void;
  onSetReminder: (
    taskId: string,
    date: string,
    reminderAt: string | null,
  ) => void;
  onSetTags: (taskId: string, date: string, tags: string[]) => void;
  onDelete: (taskId: string, date: string) => void;
}) {
  const isRename = editState?.mode === "rename";
  const isReminder = editState?.mode === "reminder";
  const isTags = editState?.mode === "tags";
  const isDelete = editState?.mode === "delete";

  // --- rename ---
  const [renameValue, setRenameValue] = useState("");
  const renameTaskRef = useRef<EditState>(null);
  if (isRename && editState && renameTaskRef.current?.task !== editState.task) {
    renameTaskRef.current = editState;
    setRenameValue(editState.task.title);
  }

  // --- reminder ---
  const [reminderValue, setReminderValue] = useState("");
  const reminderTaskRef = useRef<EditState>(null);
  if (
    isReminder &&
    editState &&
    reminderTaskRef.current?.task !== editState.task
  ) {
    reminderTaskRef.current = editState;
    setReminderValue(date.isoToLocalInput(editState.task.reminderAt));
  }

  // --- tags ---
  const [tagDraft, setTagDraft] = useState("");
  const [tagsValue, setTagsValue] = useState<string[]>([]);
  const tagsTaskRef = useRef<EditState>(null);
  if (isTags && editState && tagsTaskRef.current?.task !== editState.task) {
    tagsTaskRef.current = editState;
    setTagsValue(editState.task.tags ?? []);
    setTagDraft("");
  }

  if (!editState) return null;

  const submitRename = () => {
    const v = renameValue.trim();
    if (!v || !editState) return;
    onRename(editState.task.id, editState.date, v);
    onClose();
  };

  const submitReminder = () => {
    if (!editState) return;
    const iso = reminderValue ? date.localInputToIso(reminderValue) : null;
    onSetReminder(editState.task.id, editState.date, iso);
    onClose();
  };

  const clearReminder = () => {
    if (!editState) return;
    onSetReminder(editState.task.id, editState.date, null);
    onClose();
  };

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (!t || tagsValue.includes(t)) return;
    setTagsValue((prev) => [...prev, t]);
    setTagDraft("");
  };

  const submitTags = () => {
    if (!editState) return;
    onSetTags(editState.task.id, editState.date, tagsValue);
    onClose();
  };

  const confirmDelete = () => {
    if (!editState) return;
    onDelete(editState.task.id, editState.date);
    onClose();
  };

  const suggestions = allTags.filter(
    (t) =>
      !tagsValue.includes(t) &&
      (!tagDraft || t.toLowerCase().includes(tagDraft.toLowerCase())),
  );

  return (
    <>
      {/* 修改任务名 */}
      <Dialog open={isRename} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改任务名</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={submitRename} disabled={!renameValue.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加/修改提醒 */}
      <Dialog open={isReminder} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editState.task.reminderAt ? "修改提醒" : "添加提醒"}
            </DialogTitle>
          </DialogHeader>
          <Input
            type="datetime-local"
            value={reminderValue}
            onChange={(e) => setReminderValue(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            {editState.task.reminderAt && (
              <Button
                variant="ghost"
                onClick={clearReminder}
                className="mr-auto text-destructive"
              >
                清除提醒
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={submitReminder} disabled={!reminderValue}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑标签 */}
      <Dialog open={isTags} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑标签</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {tagsValue.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <Tag className="size-2.5" />
                  {tag}
                  <button
                    type="button"
                    onClick={() =>
                      setTagsValue((prev) => prev.filter((t) => t !== tag))
                    }
                    className="ml-0.5 hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {tagsValue.length === 0 && (
                <span className="text-xs text-muted-foreground">暂无标签</span>
              )}
            </div>
            <Input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              placeholder="输入标签后按 Enter 添加"
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {suggestions.slice(0, 10).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addTag(tag)}
                    className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <Tag className="size-2.5" />
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={submitTags}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={isDelete} onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要删除这个任务吗？</AlertDialogTitle>
            <AlertDialogDescription>
              {editState
                ? `「${editState.task.title}」将被永久删除，无法恢复。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * 选中日期的任务面板：视图切换（列表 / 四象限）+ 任务清单。
 * 从 store 读取 selectedDate / today / viewMode，通过 useTasks 获取任务数据。
 * 勾选任务的乐观更新与撤销确认均在组件内部完成。
 */
export function TaskPanel() {
  const today = useHomeStore((s) => s.today);
  const selectedDate = useHomeStore((s) => s.selectedDate);
  const viewMode = useHomeStore((s) => s.viewMode);
  const setViewMode = useHomeStore((s) => s.setViewMode);
  const setSelectedDate = useHomeStore((s) => s.setSelectedDate);
  const sortableOrder = useHomeStore((s) => s.sortableOrder);

  const { data: tasksData, mutate: mutateTasks } = useTasks();
  const tasksByDate = tasksData.tasksByDate;
  const segments = tasksData.segments;

  const dayTasks = tasksByDate[selectedDate] ?? [];
  const remaining = dayTasks.filter((t) => !t.done).length;
  const isPastDay = selectedDate < today;
  const isSelectedToday = selectedDate === today;

  const selectedDateObj = date.parseDate(selectedDate);
  const selectedWeekday =
    date.WEEKDAY_LABELS[(selectedDateObj.getDay() + 6) % 7];
  const selectedLabel = isSelectedToday ? "今天" : selectedDate;

  // 当前选中日期所属的任务段（用于日期下方显示段标签）
  const segmentsForDate = useMemo(
    () =>
      segments.filter(
        (s) => s.startDate <= selectedDate && selectedDate <= s.endDate,
      ),
    [segments, selectedDate],
  );
  const segmentColorIndex = useMemo(() => {
    const map: Record<string, number> = {};
    segments.forEach((s, i) => {
      map[s.id] = i;
    });
    return map;
  }, [segments]);

  // 撤销完成的待确认任务
  const [pendingUncomplete, setPendingUncomplete] = useState<{
    task: Task;
    date: string;
  } | null>(null);
  const [editState, setEditState] = useState<EditState>(null);
  const [segmentDialog, setSegmentDialog] = useState<{
    segment: TaskSegment;
    index: number;
  } | null>(null);

  // 任务切换请求序号：快速连续勾选时丢弃过期 PATCH 响应
  const toggleSeqRef = useRef(0);

  // 筛选：五育 + 重要度 + 标签（空数组表示不筛选该维度，即"全部"）
  const [filterCategory, setFilterCategory] = useState<Category[]>([]);
  const [filterImportance, setFilterImportance] = useState<Importance[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(tasksByDate)) {
      for (const t of list)
        for (const tag of t.tags ?? []) if (tag) set.add(tag);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [tasksByDate]);
  const hasFilter =
    filterCategory.length > 0 ||
    filterImportance.length > 0 ||
    filterTags.length > 0;

  // 四象限视图中，重要度筛选变为「淡化」而非过滤
  const importanceDimActive =
    viewMode === "quadrant" && filterImportance.length > 0;

  const filteredTasks = useMemo(
    () =>
      hasFilter
        ? dayTasks.filter((t) => {
            const catOk =
              filterCategory.length === 0 ||
              filterCategory.includes(t.category);
            const tagOk =
              filterTags.length === 0 ||
              filterTags.some((tag) => (t.tags ?? []).includes(tag));
            // 四象限视图：重要度不参与过滤（改为淡化）
            const impOk =
              importanceDimActive ||
              filterImportance.length === 0 ||
              filterImportance.includes(t.importance);
            return catOk && tagOk && impOk;
          })
        : dayTasks,
    [
      dayTasks,
      hasFilter,
      filterCategory,
      filterImportance,
      filterTags,
      importanceDimActive,
    ],
  );
  const displayRemaining = filteredTasks.filter((t) => !t.done).length;

  /** 客户端勾选任务：SWR 乐观更新 */
  const toggleTask = async (id: string, next: boolean, taskDate: string) => {
    if (taskDate < today) return;
    const seq = ++toggleSeqRef.current;
    mutateTasks(
      (prev) => {
        if (!prev) return prev;
        const list = prev.tasksByDate[taskDate] ?? [];
        return {
          ...prev,
          tasksByDate: {
            ...prev.tasksByDate,
            [taskDate]: list.map((t) =>
              t.id === id ? { ...t, done: next } : t,
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
        body: JSON.stringify({ id, done: next }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch {
      if (seq !== toggleSeqRef.current) return;
      mutateTasks();
    }
  };

  const handleTaskCheck = (task: Task, next: boolean, taskDate: string) => {
    if (next) {
      void toggleTask(task.id, true, taskDate);
      toast.success(pickFeedback(task.category), { duration: 4000 });
    } else {
      setPendingUncomplete({ task, date: taskDate });
    }
  };

  const confirmUncomplete = () => {
    const entry = pendingUncomplete;
    setPendingUncomplete(null);
    if (entry) void toggleTask(entry.task.id, false, entry.date);
  };

  /** 乐观更新任务字段 + PATCH 服务端（共享实现） */
  const patchFields = (
    taskDate: string,
    taskId: string,
    fields: Partial<Task>,
    body: Record<string, unknown>,
  ) => patchTaskFields(mutateTasks, taskDate, taskId, fields, body);

  /** 乐观删除任务 + DELETE 服务端（共享实现） */
  const deleteTask = (taskDate: string, taskId: string) =>
    deleteTaskById(mutateTasks, taskDate, taskId);

  const handleEdit = (mode: EditMode, task: Task, taskDate: string) => {
    setEditState({ task, date: taskDate, mode });
  };

  // --- 拖拽排序（dnd-kit） ---
  // 过去日期 / 有筛选时禁用拖拽
  const canDrag = !isPastDay && !hasFilter;

  /**
   * 拖拽进行中：用 sortableOrder 快照决定显示顺序。
   * 非拖拽时为 null，使用 filteredTasks 原始顺序。
   */
  const orderedTasks = useMemo(() => {
    if (!sortableOrder) return filteredTasks;
    const taskMap = new Map(dayTasks.map((t) => [t.id, t]));
    if (viewMode === "quadrant") {
      // 四象限：按 QUADRANT_ORDER 顺序从各象限拼接
      const orderedIds = QUADRANT_ORDER.flatMap(
        (imp) => sortableOrder[imp] ?? [],
      );
      return orderedIds
        .map((id) => taskMap.get(id))
        .filter((t): t is Task => t !== undefined);
    }
    // 列表视图
    return (sortableOrder["list"] ?? [])
      .map((id) => taskMap.get(id))
      .filter((t): t is Task => t !== undefined);
  }, [sortableOrder, filteredTasks, dayTasks, viewMode]);

  return (
    <>
      <div className="flex flex-1 min-h-0 w-full flex-col xl:flex-row">
        <WeekCalendar />
        {/* 竖直（flex-col）模式下由 flex-1 + min-h-0 占据剩余高度；
            不要用 h-screen——100vh 不含头部/日历高度，会导致底部内容被推出可视区，
            滚动到最底部仍显示不全。xl 横向模式下由 stretch 自动撑满交叉轴高度 */}
        <ScrollArea className="min-h-0 flex-1 xl:min-w-0">
          <div className="w-full px-4 pb-8 pt-4 sm:px-6">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-medium">{selectedLabel}</h2>
                <span className="text-xs text-muted-foreground">
                  周{selectedWeekday}
                </span>
                {isPastDay && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    只读
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs"
                      />
                    }
                  >
                    {viewMode === "list" ? (
                      <LayoutList className="size-3.5" />
                    ) : (
                      <LayoutGrid className="size-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {viewMode === "list" ? "列表视图" : "四象限视图"}
                    </span>
                    <ChevronDown className="size-3 opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>切换视图</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setViewMode("list")}>
                        <LayoutList className="size-3.5" />
                        <span>列表视图</span>
                        {viewMode === "list" && (
                          <Check className="ml-auto size-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setViewMode("quadrant")}>
                        <LayoutGrid className="size-3.5" />
                        <span>四象限视图</span>
                        {viewMode === "quadrant" && (
                          <Check className="ml-auto size-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs"
                        aria-label="筛选"
                      />
                    }
                  >
                    <Filter className="size-3.5" />
                    <span className="hidden sm:inline">筛选</span>
                    {hasFilter && (
                      <span className="size-1.5 rounded-full bg-primary" />
                    )}
                    <ChevronDown className="size-3 opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>五育分类</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem
                        checked={filterCategory.length === 0}
                        onCheckedChange={() => setFilterCategory([])}
                      >
                        全部
                      </DropdownMenuCheckboxItem>
                      {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c}
                          checked={filterCategory.includes(c)}
                          onCheckedChange={(checked) =>
                            setFilterCategory((prev) =>
                              checked
                                ? [...prev, c]
                                : prev.filter((x) => x !== c),
                            )
                          }
                        >
                          {c}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>重要度紧急度</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem
                        checked={filterImportance.length === 0}
                        onCheckedChange={() => setFilterImportance([])}
                      >
                        全部
                      </DropdownMenuCheckboxItem>
                      {QUADRANT_ORDER.map((imp) => (
                        <DropdownMenuCheckboxItem
                          key={imp}
                          checked={filterImportance.includes(imp)}
                          onCheckedChange={(checked) =>
                            setFilterImportance((prev) =>
                              checked
                                ? [...prev, imp]
                                : prev.filter((x) => x !== imp),
                            )
                          }
                        >
                          {IMPORTANCE_META[imp].quadrant}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    {allTags.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>自定义标签</DropdownMenuLabel>
                          <DropdownMenuCheckboxItem
                            checked={filterTags.length === 0}
                            onCheckedChange={() => setFilterTags([])}
                          >
                            全部
                          </DropdownMenuCheckboxItem>
                          {allTags.map((tag) => (
                            <DropdownMenuCheckboxItem
                              key={tag}
                              checked={filterTags.includes(tag)}
                              onCheckedChange={(checked) =>
                                setFilterTags((prev) =>
                                  checked
                                    ? [...prev, tag]
                                    : prev.filter((x) => x !== tag),
                                )
                              }
                            >
                              {tag}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuGroup>
                      </>
                    )}
                    {hasFilter && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={() => {
                              setFilterCategory([]);
                              setFilterImportance([]);
                              setFilterTags([]);
                            }}
                          >
                            清除筛选
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="text-xs text-muted-foreground">
                  {hasFilter
                    ? `筛选 ${displayRemaining} / ${filteredTasks.length}（共 ${dayTasks.length}）`
                    : `剩余 ${remaining} / 共 ${dayTasks.length}`}
                </span>
              </div>
            </div>

            {/* 选中日期所属的任务段标签 */}
            {segmentsForDate.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">
                  任务段
                </span>
                {segmentsForDate.map((seg) => (
                  <button
                    key={seg.id}
                    type="button"
                    onClick={() =>
                      setSegmentDialog({
                        segment: seg,
                        index: segmentColorIndex[seg.id] ?? 0,
                      })
                    }
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none transition-opacity hover:opacity-80",
                      segmentBadgeClass(segmentColorIndex[seg.id] ?? 0),
                    )}
                  >
                    <Layers className="size-2.5" />
                    {seg.name}
                  </button>
                ))}
              </div>
            )}

            {dayTasks.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {isPastDay
                  ? "这一天没有任务记录。"
                  : "这一天还没有任务，在下方对话框里让 AI 帮你安排吧。"}
              </p>
            ) : filteredTasks.length === 0 && !importanceDimActive ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                没有符合筛选条件的任务。
              </p>
            ) : viewMode === "list" ? (
              <ul className="space-y-1">
                {orderedTasks.map((task, index) => (
                  <li key={task.id}>
                    {canDrag ? (
                      <SortableTaskCard
                        task={task}
                        date={selectedDate}
                        segments={segments}
                        today={today}
                        isPastDay={isPastDay}
                        showImportance
                        variant="list"
                        index={index}
                        group="list"
                        onCheck={handleTaskCheck}
                        onEdit={handleEdit}
                      />
                    ) : (
                      <PlainTaskCard
                        task={task}
                        date={selectedDate}
                        segments={segments}
                        today={today}
                        isPastDay={isPastDay}
                        showImportance
                        variant="list"
                        onCheck={handleTaskCheck}
                        onEdit={handleEdit}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {QUADRANT_ORDER.map((imp) => {
                  // 拖拽中：从 sortableOrder 取该象限的任务顺序；否则用 filteredTasks 过滤
                  let tasks: Task[];
                  if (sortableOrder) {
                    const taskMap = new Map(dayTasks.map((t) => [t.id, t]));
                    tasks = (sortableOrder[imp] ?? [])
                      .map((id) => taskMap.get(id))
                      .filter((t): t is Task => t !== undefined);
                  } else {
                    tasks = filteredTasks.filter((t) => t.importance === imp);
                  }
                  const dimmed =
                    importanceDimActive && !filterImportance.includes(imp);
                  return (
                    <QuadrantCard
                      key={imp}
                      canDrag={canDrag}
                      importance={imp}
                      tasks={tasks}
                      date={selectedDate}
                      segments={segments}
                      today={today}
                      isPastDay={isPastDay}
                      dimmed={dimmed}
                      showImportance={false}
                      onCheck={handleTaskCheck}
                      onEdit={handleEdit}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 撤销任务完成的二次确认 */}
      <AlertDialog
        open={pendingUncomplete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUncomplete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要把它标记为未完成吗？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUncomplete
                ? `「${pendingUncomplete.task.title}」已经完成，重新切回未完成会让进度回退。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUncomplete}>
              确认撤销
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 任务段详情 Dialog */}
      {segmentDialog && (
        <SegmentDialog
          segment={segmentDialog.segment}
          index={segmentDialog.index}
          tasksByDate={tasksByDate}
          today={today}
          onClose={() => setSegmentDialog(null)}
          onJump={(d) => {
            setSelectedDate(d);
            setSegmentDialog(null);
          }}
        />
      )}

      {/* 任务编辑 Dialog */}
      {editState && (
        <TaskEditDialogs
          editState={editState}
          allTags={allTags}
          onClose={() => setEditState(null)}
          onRename={(taskId, d, title) =>
            patchFields(d, taskId, { title }, { title })
          }
          onSetReminder={(taskId, d, reminderAt) =>
            patchFields(
              d,
              taskId,
              {
                reminderAt: reminderAt ?? undefined,
                reminderNotified: false,
              },
              { reminderAt },
            )
          }
          onSetTags={(taskId, d, tags) =>
            patchFields(d, taskId, { tags }, { tags })
          }
          onDelete={(taskId, d) => deleteTask(d, taskId)}
        />
      )}
    </>
  );
}
