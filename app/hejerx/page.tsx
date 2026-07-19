"use client";

import { TaskBadges } from "@/components/home/reports";
import { TaskDragData } from "@/components/home/task-panel";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Importance,
  IMPORTANCE_META,
  QUADRANT_ORDER,
  Task,
} from "@/lib/home/constants";
import { cn } from "@/lib/utils";
import { DragDropProvider, DragOverlay, useDroppable } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { Bell, Pencil, Tag, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Feedback } from "@dnd-kit/dom";
import { CollisionPriority } from "@dnd-kit/abstract";

const MOCK_TASKS: Task[] = [
  {
    id: "6e2438d5-43c7-48b8-9a18-8686b7713435",
    title: "背万维英语词汇 Day 1",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "5a47cc3d-da75-4887-981d-dc1d2503cbc3",
    title: "数学暑假作业 第1练",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "5e6abf78-e242-4791-93d0-ad5295d11fc8",
    title: "5分钟拉伸放松",
    done: false,
    importance: "不重要且不紧急",
    category: "体育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },

  {
    id: "5dca13be-ed36-413d-aa3a-9f3d95d7f56b",
    title: "数学暑假作业 第19练",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "f2877b0c-c7d3-43da-ae95-332e01a2129f",
    title: "化学暑假作业 第14练",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "f31b6507-1da7-44d8-b4bc-b59fb4901111",
    title: "写《大卫·科波菲尔》读书笔记（三）",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "24b8691b-4f7d-4edd-86e6-a00471b60cc6",
    title: "语文练习3",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "2196a62b-0f15-4f75-a6cd-fcab33581fc6",
    title: "语文练习2",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "cafe9949-a7d7-4c86-84d6-369da0bbb29a",
    title: "读《大卫·科波菲尔》第53-56章",
    done: false,
    importance: "不重要但紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "1627ca21-279a-44e8-b602-a23d3695a172",
    title: "英语综合训练 第5套",
    done: false,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
  {
    id: "2b6a9811-6735-4849-921b-8c39335082eb",
    title: "英语综合训练 第4套",
    done: true,
    importance: "重要但不紧急",
    category: "智育",
    segmentId: "b6d5c8bf-b9e5-47a4-ad78-e9016c506589",
    tags: [],
    reminderNotified: false,
  },
];

/**
 * 任务卡片共享渲染层：负责布局、复选框、徽章、右键上下文菜单。
 * 拖拽钩子（useDraggable / useSortable）由外层包装组件注入 ref + isDragging。
 */
function HjxTaskCardShell({
  task,
  isDragging,
  dragRef,
}: {
  task: Task;
  isDragging: boolean;
  dragRef: (element: Element | null) => void;
}) {
  const isList = false;
  const canEdit = false;
  const canDelete = false;
  const hasMenu = canEdit || canDelete;

  const cardContent = (
    <>
      <Checkbox
        checked={task.done}
        className={cn("mt-0.5", isList ? "size-5" : "size-4")}
      />
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
        <TaskBadges task={task} showImportance={false} />
      </div>
    </>
  );

  const labelClass = cn(
    "flex w-full items-start gap-3 transition-colors",
    isList ? "rounded-lg px-3 py-2.5" : "rounded-md px-2 py-1.5",
    isDragging && "opacity-40",
  );

  if (!hasMenu) {
    return (
      <label ref={dragRef} className={labelClass}>
        {cardContent}
      </label>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<label ref={dragRef} />}
        className={labelClass}
      >
        {cardContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canEdit && (
          <>
            <ContextMenuItem>
              <Pencil className="size-3.5" />
              <span>修改任务名</span>
            </ContextMenuItem>
            <ContextMenuItem>
              <Bell className="size-3.5" />
              <span>{task.reminderAt ? "修改提醒" : "添加提醒"}</span>
            </ContextMenuItem>
            <ContextMenuItem>
              <Tag className="size-3.5" />
              <span>编辑标签</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {canDelete && (
          <ContextMenuItem variant="destructive">
            <Trash2 className="size-3.5" />
            <span>删除</span>
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HjxTaskCard({
  task,
  importance,
  index,
}: {
  task: Task;
  importance: Importance;
  index: number;
}) {
  const dragData: Partial<TaskDragData> = {
    kind: "task",
    taskId: task.id,
    title: task.title,
  };
  const { ref, isDragging } = useSortable({
    id: task.id,
    data: dragData,
    type: "task",
    accept: "task",
    index,
    group: importance,
    plugins: [Feedback.configure({ feedback: "clone" })],
  });

  return <HjxTaskCardShell task={task} isDragging={isDragging} dragRef={ref} />;
}

function HjxQuadrantCard({
  importance,
  tasks,
}: {
  importance: Importance;
  tasks: Task[];
}) {
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
              <HjxTaskCard task={task} importance={importance} index={index} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HjxPage() {
  const [tasks, setTasks] = useState(
    MOCK_TASKS.reduce(
      (prev, current) => ({
        ...prev,
        [current.importance]: Object.keys(prev).includes(current.importance)
          ? [...prev[current.importance], current.id]
          : [current.id],
      }),
      {
        重要且紧急: [],
        重要但不紧急: [],
        不重要但紧急: [],
        不重要且不紧急: [],
      } as Record<Importance, string[]>,
    ),
  );
  // const snapshot = useRef(structuredClone(tasks));

  return (
    <DragDropProvider
      onDragOver={(event) => setTasks((tasks) => move(tasks, event))}
      // onDragStart={() => {
      //   snapshot.current = structuredClone(tasks);
      // }}
      // onDragOver={(event) => event.preventDefault()}
      // onDragEnd={(event) => {
      //   if (event.canceled) {
      //     setTasks(snapshot.current);
      //     return;
      //   }

      //   const { source } = event.operation;

      //   if (isSortable(source)) {
      //     const { initialIndex, index, initialGroup, group } = source;

      //     if (initialGroup == null || group == null) return;

      //     setTasks((items) => {
      //       if (initialGroup === group) {
      //         // Same group: reorder within the list
      //         const groupItems = [...items[group as Importance]];
      //         const [removed] = groupItems.splice(initialIndex, 1);
      //         groupItems.splice(index, 0, removed);
      //         return { ...items, [group]: groupItems };
      //       }

      //       // Cross-group transfer
      //       const sourceItems = [...items[initialGroup as Importance]];
      //       const [removed] = sourceItems.splice(initialIndex, 1);
      //       const targetItems = [...items[group as Importance]];
      //       targetItems.splice(index, 0, removed);
      //       return {
      //         ...items,
      //         [initialGroup]: sourceItems,
      //         [group]: targetItems,
      //       };
      //     });
      //   }
      // }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Object.entries(tasks).map(([imp, items]) => (
          <HjxQuadrantCard
            key={imp}
            importance={imp as Importance}
            tasks={items.map((item) =>
              MOCK_TASKS.find((task) => task.id === item)!,
            )}
          />
        ))}
      </div>
      <DragOverlay>
        {(source) => {
          if (!source || source.type !== "task") return null;
          const d = source.data as TaskDragData;
          if (d?.kind !== "task") return null;
          return (
            <div className="pointer-events-none rounded-lg border bg-card px-3 py-2 text-sm shadow-lg max-w-xs">
              <span className="font-medium">{d.title}</span>
            </div>
          );
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}
