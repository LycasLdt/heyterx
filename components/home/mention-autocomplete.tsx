"use client";

import { CalendarRange, Layers, SquareCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MentionSuggestion, ResolvedMention } from "@/lib/home/mentions";
import { CATEGORY_META, IMPORTANCE_META } from "@/lib/home/constants";

const GROUP_LABELS: Record<MentionSuggestion["kind"], string> = {
  segment: "任务段",
  date: "日期",
  task: "任务",
};

const GROUP_ORDER: MentionSuggestion["kind"][] = ["segment", "date", "task"];

/**
 * 各类引用对应的 icon 与配色。chat-panel 中的「引用块」chip 复用此元数据，
 * 保证 autocomplete 列表与已选 chip 的视觉表现一致。
 */
export const MENTION_ICON_META: Record<
  ResolvedMention["kind"],
  { Icon: LucideIcon; className: string }
> = {
  segment: { Icon: Layers, className: "text-sky-600 dark:text-sky-400" },
  date: { Icon: CalendarRange, className: "text-emerald-600 dark:text-emerald-400" },
  task: { Icon: SquareCheck, className: "text-amber-600 dark:text-amber-400" },
};

/**
 * 「@」引用 autocomplete 悬浮面板：由 chat-panel 绝对定位于输入框上方。
 * 按任务段 / 日期 / 任务分组展示推荐，不同引用类型显示不同 icon；
 * 支持键盘上下导航（activeIndex）与鼠标点选。
 */
export function MentionAutocomplete({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: MentionSuggestion[];
  activeIndex: number;
  onSelect: (item: MentionSuggestion) => void;
  onHover: (index: number) => void;
}) {
  if (items.length === 0) return null;

  // 全局扁平索引（键盘导航用），渲染时按组归类
  let flatIndex = -1;

  return (
    // mousedown 阻止默认行为，避免点选时输入框失焦
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="max-h-64 overflow-y-auto"
      onMouseDown={(e) => e.preventDefault()}
    >
      {GROUP_ORDER.map((kind) => {
        const groupItems = items
          .map((item, i) => ({ item, i }))
          .filter(({ item }) => item.kind === kind);
        if (groupItems.length === 0) return null;
        return (
          <div key={kind}>
            <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium text-muted-foreground">
              {GROUP_LABELS[kind]}
            </div>
            {groupItems.map(({ item }) => {
              flatIndex++;
              const index = flatIndex;
              const active = index === activeIndex;
              return (
                <button
                  key={`${kind}-${index}`}
                  type="button"
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onSelect(item)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                    active ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  {item.kind === "segment" && (
                    <>
                      <Layers className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                      <span className="min-w-0 flex-1 truncate">
                        {item.segment.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.segment.startDate.slice(5).replace("-", "/")} ~{" "}
                        {item.segment.endDate.slice(5).replace("-", "/")} ·{" "}
                        {item.count} 项
                      </span>
                    </>
                  )}
                  {item.kind === "date" && (
                    <>
                      <CalendarRange className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.count} 项任务
                      </span>
                    </>
                  )}
                  {item.kind === "task" && (
                    <>
                      <SquareCheck className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          item.task.done && "text-muted-foreground line-through",
                        )}
                      >
                        {item.task.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[10px]">
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 leading-none",
                            IMPORTANCE_META[item.task.importance].badge,
                          )}
                        >
                          {IMPORTANCE_META[item.task.importance].short}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 leading-none",
                            CATEGORY_META[item.task.category].badge,
                          )}
                        >
                          {CATEGORY_META[item.task.category].short}
                        </span>
                        <span className="text-muted-foreground">
                          {item.date.slice(5).replace("-", "/")}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
