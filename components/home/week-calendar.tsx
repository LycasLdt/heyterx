"use client";

import { useMemo, useRef, useSyncExternalStore } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn, date } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import { useTasks } from "@/lib/home/use-tasks";
import {
  IMPORTANCE_META,
  QUADRANT_ORDER,
  SEGMENT_COLORS,
  type Importance,
  type TaskSegment,
} from "@/lib/home/constants";
import { useDroppable } from "@dnd-kit/react";
import { CollisionPriority } from "@dnd-kit/abstract";

const XL_BREAKPOINT = 1280;

const subscribeXl = (onChange: () => void) => {
  const mql = window.matchMedia(`(min-width: ${XL_BREAKPOINT}px)`);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};
const getXlSnapshot = () =>
  typeof window !== "undefined" &&
  window.matchMedia(`(min-width: ${XL_BREAKPOINT}px)`).matches;
const getXlServerSnapshot = () => false;

/**
 * 周日历：左右箭头切换周，每个圆角按钮只显示日期与任务指示点。
 * 从 store 读取 today / selectedDate / weekOffset，通过 useTasks 获取任务数据。
 * 周历导航时 useTasks 自动按需加载未获取过的周。
 *
 * 拖拽：日期格和上下周按钮均为 dnd-kit drop target。
 * - 日期格：拖入时由 DndProvider 设 dragOverDate 触发 popover 预览，drop 时跨日期移动
 * - 上下周按钮：拖入时由 DndProvider 节流切换 weekOffset
 *
 * 响应式：xl 宽屏下切换为竖向紧凑布局（日期提示在左、日期选择在右、ChevronUp/Down 导航），
 * 与任务面板紧凑排列；窄屏保持横向周条。
 */
export function WeekCalendar() {
  const isVertical = useSyncExternalStore(
    subscribeXl,
    getXlSnapshot,
    getXlServerSnapshot,
  );

  const today = useHomeStore((s) => s.today);
  const selectedDate = useHomeStore((s) => s.selectedDate);
  const weekOffset = useHomeStore((s) => s.weekOffset);
  const setSelectedDate = useHomeStore((s) => s.setSelectedDate);
  const prevWeek = useHomeStore((s) => s.prevWeek);
  const nextWeek = useHomeStore((s) => s.nextWeek);
  const dragOverDate = useHomeStore((s) => s.dragOverDate);

  const { data: tasksData } = useTasks();
  const tasksByDate = tasksData.tasksByDate;
  const segments = tasksData.segments;

  const weekDates = useMemo(() => {
    const anchor = date.parseDate(today);
    anchor.setDate(anchor.getDate() + weekOffset * 7);
    return date.getWeekDates(anchor);
  }, [today, weekOffset]);

  // 年月标签：一周可能跨月/跨年，跨月时显示「M月 – M月」
  const weekMonthLabel = useMemo(() => {
    const monday = weekDates[0]!;
    const sunday = weekDates[6]!;
    const mYear = monday.getFullYear();
    const mMonth = monday.getMonth() + 1;
    const sYear = sunday.getFullYear();
    const sMonth = sunday.getMonth() + 1;
    if (mYear === sYear && mMonth === sMonth) {
      return `${mYear}年${mMonth}月`;
    }
    if (mYear === sYear) {
      return `${mYear}年${mMonth}月 – ${sMonth}月`;
    }
    return `${mYear}年${mMonth}月 – ${sYear}年${sMonth}月`;
  }, [weekDates]);

  const segmentsByDate = useMemo(() => {
    const map: Record<string, TaskSegment[]> = {};
    for (const d of weekDates) {
      const ds = date.formatDate(d);
      map[ds] = segments.filter((s) => s.startDate <= ds && ds <= s.endDate);
    }
    return map;
  }, [weekDates, segments]);

  const segmentColorMap = useMemo(() => {
    const map: Record<string, number> = {};
    segments.forEach((s, i) => {
      map[s.id] = i % SEGMENT_COLORS.length;
    });
    return map;
  }, [segments]);

  // popover 锚点：周历容器
  const calendarRef = useRef<HTMLDivElement>(null);
  const popoverOpen = dragOverDate !== null && dragOverDate !== selectedDate;

  // popover 内容：目标日期的任务统计
  const dragOverTasks = dragOverDate ? (tasksByDate[dragOverDate] ?? []) : [];
  const dragOverPending = dragOverTasks.filter((t) => !t.done).length;
  const dragOverLabel = useMemo(() => {
    if (!dragOverDate) return "";
    return date.formatDateDivider(dragOverDate, today);
  }, [dragOverDate, today]);

  const dateCells = weekDates.map((d) => {
    const ds = date.formatDate(d);
    const list = tasksByDate[ds] ?? [];
    const pending = list.filter((t) => !t.done).length;
    const isToday = ds === today;
    const isSelected = ds === selectedDate;
    const isPast = ds < today;
    const daySegs = segmentsByDate[ds] ?? [];
    return (
      <DateCell
        key={ds}
        d={d}
        ds={ds}
        list={list}
        pending={pending}
        isToday={isToday}
        isSelected={isSelected}
        isPast={isPast}
        daySegs={daySegs}
        segmentColorMap={segmentColorMap}
        onSelect={setSelectedDate}
        vertical={isVertical}
      />
    );
  });

  const popoverContent = (
    <PopoverContent
      anchor={calendarRef}
      side={isVertical ? "right" : "bottom"}
      align="center"
      sideOffset={8}
      className="w-64 gap-2 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{dragOverLabel}</span>
        <span className="text-xs text-muted-foreground">
          共 {dragOverTasks.length} 项
        </span>
      </div>
      <div className="space-y-1">
        {QUADRANT_ORDER.map((imp: Importance) => {
          const count = dragOverTasks.filter(
            (t) => t.importance === imp,
          ).length;
          const meta = IMPORTANCE_META[imp];
          return (
            <div
              key={imp}
              className="flex items-center justify-between text-xs"
            >
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-medium leading-none",
                  meta.badge,
                )}
              >
                {meta.quadrant}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {count}
              </span>
            </div>
          );
        })}
      </div>
      {dragOverPending > 0 && (
        <div className="border-t pt-1 text-xs text-muted-foreground">
          待完成 {dragOverPending} 项
        </div>
      )}
    </PopoverContent>
  );

  if (isVertical) {
    // 竖向布局：占满高度，年月提示在左、日期选择在右，ChevronUp/Down 上下导航。
    // 日期格在可用高度内宽松分布。
    return (
      <div className="flex min-w-8 h-full shrink-0 items-stretch pl-4 pr-2 py-3">
        <Popover open={popoverOpen}>
          <div ref={calendarRef} className="flex h-full items-stretch gap-2">
            {/*<div className="flex items-center justify-center px-1 text-xs font-medium text-muted-foreground [writing-mode:vertical-rl] [text-orientation:upright]">
              {weekMonthLabel}
            </div>*/}
            <div className="flex h-full flex-col items-center justify-between py-1">
              <WeekNavButton
                onClick={prevWeek}
                ariaLabel="上一周"
                direction="prev"
              >
                <ChevronUp className="size-4" />
              </WeekNavButton>
              <div className="flex flex-1 flex-col items-center justify-around">
                {dateCells}
              </div>
              <WeekNavButton
                onClick={nextWeek}
                ariaLabel="下一周"
                direction="next"
              >
                <ChevronDown className="size-4" />
              </WeekNavButton>
            </div>
          </div>
          {popoverContent}
        </Popover>
      </div>
    );
  }

  // 横向周条（默认）
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-6 sm:px-6">
      <div className="mb-1.5 text-center text-xs font-medium text-muted-foreground">
        {weekMonthLabel}
      </div>
      <Popover open={popoverOpen}>
        <div
          ref={calendarRef}
          className="flex items-center justify-center gap-1 sm:gap-1.5"
        >
          <WeekNavButton onClick={prevWeek} ariaLabel="上一周" direction="prev">
            <ChevronLeft className="size-4" />
          </WeekNavButton>
          <div className="flex flex-1 justify-center gap-1 sm:gap-1.5">
            {dateCells}
          </div>
          <WeekNavButton onClick={nextWeek} ariaLabel="下一周" direction="next">
            <ChevronRight className="size-4" />
          </WeekNavButton>
        </div>
        {popoverContent}
      </Popover>
    </div>
  );
}

/** 单个日期格：Tooltip 触发器 + dnd-kit drop target */
function DateCell({
  d,
  ds,
  list,
  pending,
  isToday,
  isSelected,
  isPast,
  daySegs,
  segmentColorMap,
  onSelect,
  vertical = false,
}: {
  d: Date;
  ds: string;
  list: { done: boolean }[];
  pending: number;
  isToday: boolean;
  isSelected: boolean;
  isPast: boolean;
  daySegs: TaskSegment[];
  segmentColorMap: Record<string, number>;
  onSelect: (ds: string) => void;
  vertical?: boolean;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `date:${ds}`,
    type: "date-cell",
    accept: "task",
    collisionPriority: CollisionPriority.High,
  });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={ref}
            type="button"
            onClick={() => onSelect(ds)}
            className={cn(
              "flex aspect-square flex-col items-center justify-center gap-1 rounded-full border transition-colors",
              vertical ? "size-12" : "max-w-12 flex-1",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : isToday
                  ? "border-primary text-primary"
                  : "border-transparent hover:bg-muted",
              isPast && !isSelected && "opacity-60",
              isDropTarget &&
                !isSelected &&
                "border-primary ring-2 ring-primary/50",
              isDropTarget && isSelected && "ring-2 ring-primary-foreground/50",
            )}
          />
        }
      >
        <span className="text-xs font-semibold leading-none sm:text-sm">
          {d.getDate()}
        </span>
        {daySegs.length > 0 && (
          <div className="flex gap-0.5">
            {daySegs.slice(0, 4).map((s) => (
              <span
                key={s.id}
                className={cn(
                  "size-1 rounded-full",
                  SEGMENT_COLORS[segmentColorMap[s.id] ?? 0],
                )}
              />
            ))}
          </div>
        )}
        <span
          className={cn(
            "size-1.5 rounded-full",
            list.length === 0 && "opacity-0",
            pending > 0
              ? isSelected
                ? "bg-primary-foreground"
                : "bg-primary"
              : isSelected
                ? "bg-primary-foreground/60"
                : "bg-muted-foreground/40",
          )}
        />
      </TooltipTrigger>
      {daySegs.length > 0 && (
        <TooltipContent side={vertical ? "right" : "top"} sideOffset={6}>
          <div className="flex flex-col gap-1">
            {daySegs.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    SEGMENT_COLORS[segmentColorMap[s.id] ?? 0],
                  )}
                />
                <span className="font-medium">{s.name}</span>
                <span className="opacity-70">
                  {s.startDate} → {s.endDate}
                </span>
              </div>
            ))}
          </div>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

/** 上/下周导航按钮 + dnd-kit drop target */
function WeekNavButton({
  onClick,
  ariaLabel,
  direction,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  direction: "prev" | "next";
  children: React.ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: direction === "prev" ? "week-nav-prev" : "week-nav-next",
    type: "week-nav",
    accept: "task",
    collisionPriority: CollisionPriority.High,
  });
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "size-8 sm:size-9",
        isDropTarget && "bg-muted ring-2 ring-primary/50",
      )}
    >
      {children}
    </Button>
  );
}
