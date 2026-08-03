"use client";

import { ReactNode } from "react";
import { ChevronRight, Diff, ArrowRight, Check } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn, date } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import type { TaskDayDiff, TaskDiffEntry } from "@/lib/home/task-diff";

/** 各变更类型的 diff 前缀符号与配色（仿代码 diff） */
const DIFF_META: Record<
  TaskDiffEntry["kind"],
  { sign: ReactNode; className: string; strike?: boolean }
> = {
  added: {
    sign: "+",
    className: "bg-green-500/10 text-green-700 dark:text-green-300",
  },
  updated: {
    sign: "~",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  moved: {
    sign: <ArrowRight className="size-2" />,
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  deleted: {
    sign: "-",
    className: "bg-red-500/10 text-red-700 dark:text-red-300",
    strike: true,
  },
  toggled: {
    sign: <Check className="size-2" />,
    className: "bg-muted text-muted-foreground",
  },
};

/**
 * 任务变更 diff 视图：显示在 agent 回答下方（消息 action 上方）。
 * 可折叠（默认折叠），内容仿代码 diff 按每一天分组；
 * 点击某天标题可跳转（selectedDate）到该天查看任务。
 */
export function TaskDiffView({
  diffs,
  today,
}: {
  diffs: TaskDayDiff[];
  today: string;
}) {
  const setSelectedDate = useHomeStore((s) => s.setSelectedDate);
  const total = diffs.reduce((n, d) => n + d.entries.length, 0);
  if (total === 0) return null;

  return (
    <Collapsible className="ml-9 max-w-[80%] overflow-hidden rounded-xl border text-xs">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
        <Diff className="size-3.5 shrink-0" />
        <span className="font-medium">任务变更</span>
        <span className="text-muted-foreground/70">· {total} 项</span>
        <ChevronRight className="ml-auto size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) border-t font-mono transition-[height] data-ending-style:h-0 data-starting-style:h-0">
        {diffs.map((day) => (
          <div key={day.date}>
            {/* 天数标题：点击跳转到该天 */}
            <button
              type="button"
              onClick={() => setSelectedDate(day.date)}
              className="flex w-full items-center gap-1.5 bg-muted/30 px-2.5 py-1 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              title={`跳转到 ${day.date}`}
            >
              <span className="font-medium">
                {date.formatDateDivider(day.date, today)}
              </span>
              <span className="text-muted-foreground/60">
                {day.date} · {day.entries.length} 项
              </span>
            </button>
            {day.entries.map((entry, i) => {
              const meta = DIFF_META[entry.kind];
              return (
                <div
                  key={`${day.date}-${i}`}
                  className={cn(
                    "flex items-baseline gap-1.5 px-2.5 py-0.5",
                    meta.className,
                  )}
                >
                  <span className="shrink-0 select-none">{meta.sign}</span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      meta.strike && "line-through opacity-70",
                    )}
                  >
                    {entry.title}
                  </span>
                  {entry.detail && (
                    <span className="shrink-0 opacity-70">{entry.detail}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
