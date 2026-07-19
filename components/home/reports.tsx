"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
} from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Markdown } from "@/components/markdown";
import { cn, fetcher } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import {
  CATEGORY_META,
  GROWTH_COLORS,
  IMPORTANCE_META,
  REPORT_TYPE_LABELS,
  type Report,
  type Task,
  type TasksResponse,
} from "@/lib/home/constants";
import type { TasksByDate } from "@/lib/db/queries";

export { type Report, type Task };

/** 任务属性徽章：显示重要度紧急度 + 五育分类
 *  showImportance=false 时仅显示五育（四象限视图已按重要度分组，无需重复） */
export function TaskBadges({
  task,
  showImportance = true,
}: {
  task: Task;
  showImportance?: boolean;
}) {
  const imp = IMPORTANCE_META[task.importance];
  const cat = CATEGORY_META[task.category];
  return (
    <div className="flex flex-wrap gap-1">
      {showImportance && imp && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
            imp.badge
          )}
        >
          {task.importance}
        </span>
      )}
      {cat && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
            cat.badge
          )}
        >
          {task.category}
        </span>
      )}
    </div>
  );
}

/** 简单数值展示卡片 */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 报告列表（Sheet 第 1 层） */
export function ReportListView({
  reports,
  onSelect,
}: {
  reports: Report[];
  onSelect: (r: Report) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <FileText className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">报告</h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-4">
          {reports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有报告。完成一个周期的全部任务后，点击「生成报告」让 AI 帮你总结。
            </p>
          ) : (
            reports.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted"
              >
                <FileText className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {REPORT_TYPE_LABELS[r.type]} · {r.periodStart} → {r.periodEnd}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </>
  );
}

/** 报告详情（Sheet 第 2 层）：复盘看板 + 雷达图 + 下周期规划应用 */
export function ReportDetailView({
  report,
  onBack,
  onApply,
}: {
  report: Report;
  onBack: () => void;
  onApply: (reportId: string) => Promise<void>;
}) {
  const [applying, setApplying] = useState(false);
  const { metrics, summary, plan } = report;
  const growthConfig: ChartConfig = {
    score: { label: "维度分", color: "#16a34a" },
  };
  const radarData = metrics.growthIndex.dimensions.map((d) => ({
    dimension: d.label,
    score: d.score,
  }));
  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply(report.id);
    } finally {
      setApplying(false);
    }
  };
  return (
    <>
      <div className="flex flex-col gap-1.5 border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> 返回列表
        </button>
        <h2 className="text-sm font-medium text-foreground">
          {report.title}
        </h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          {/* 基础复盘看板 */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">基础复盘</h3>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="完成率"
                value={`${metrics.completionRate}%`}
                sub={`${metrics.completedTasks}/${metrics.totalTasks}`}
              />
              <Stat label="总任务" value={String(metrics.totalTasks)} />
              <Stat
                label="绿芽指数"
                value={String(metrics.growthIndex.total)}
              />
            </div>
          </section>

          {/* 五育分布 */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">五育分布</h3>
            <div className="space-y-1.5">
              {metrics.categoryDistribution.map((c) => (
                <div
                  key={c.category}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="w-8 shrink-0">{c.category}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${c.rate}%`,
                        backgroundColor:
                          GROWTH_COLORS[c.category] ?? "#64748b",
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-muted-foreground">
                    {c.completed}/{c.count}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 心理绿芽指数 雷达图 */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">心理绿芽指数</h3>
            <ChartContainer
              config={growthConfig}
              className="mx-auto aspect-square h-48 w-full"
            >
              <RadarChart data={radarData}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid />
                {/* @ts-ignore */}
                <PolarAngleAxis dataKey="dimension" className="text-[10px]" />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={false}
                  axisLine={false}
                />
                <Radar
                  dataKey="score"
                  fill="var(--color-score)"
                  fillOpacity={0.4}
                  stroke="var(--color-score)"
                />
              </RadarChart>
            </ChartContainer>
            <div className="mt-1 text-center">
              <span className="text-2xl font-semibold text-primary">
                {metrics.growthIndex.total}
              </span>
              <span className="ml-1 text-xs text-muted-foreground">/ 100</span>
            </div>
          </section>

          {/* 四象限分布 */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">四象限分布</h3>
            <div className="grid grid-cols-2 gap-2">
              {metrics.importanceDistribution.map((i) => (
                <div key={i.importance} className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">
                    {i.importance}
                  </div>
                  <div className="text-sm font-medium">
                    {i.completed}/{i.count}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* AI 文字复盘 */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">AI 复盘</h3>
            <div className="rounded-lg bg-muted p-3 text-sm">
              <Markdown content={summary} />
            </div>
          </section>

          {/* 下周期规划 + 应用按钮 */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">下周期规划</h3>
              <Button
                size="sm"
                onClick={handleApply}
                disabled={applying || plan.length === 0}
              >
                {applying ? "应用中…" : "应用规划"}
              </Button>
            </div>
            {plan.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                本报告未提供下周期规划
              </p>
            ) : (
              <ul className="space-y-1.5">
                {plan.map((p, idx) => (
                  <li key={idx} className="rounded-md border p-2 text-xs">
                    <div className="font-medium">{p.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-muted-foreground">
                      <span>{p.date}</span>
                      <span>·</span>
                      <span>{p.importance}</span>
                      <span>·</span>
                      <span>{p.category}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </>
  );
}

/** 报告面板（内联）：从 store 读取选中状态，直接 useSWR 获取报告列表 */
export function ReportPanel() {
  const selectedReport = useHomeStore((s) => s.selectedReport);
  const setSelectedReport = useHomeStore((s) => s.setSelectedReport);
  const { mutate: globalMutate } = useSWRConfig();

  const { data: reportsData } = useSWR<{ reports: Report[] }>(
    "/api/reports",
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const reports = reportsData?.reports ?? [];

  /** 应用报告下周期规划：POST /api/reports 批量创建任务，并 merge 到 tasks 缓存 */
  const applyReportPlan = async (reportId: string) => {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId }),
    });
    if (!res.ok) throw new Error(`应用规划失败: ${res.status}`);
    const data = (await res.json()) as { tasksByDate: TasksByDate };
    globalMutate<TasksResponse>(
      "/api/tasks",
      (prev) => (prev ? { ...prev, tasksByDate: data.tasksByDate } : prev),
      { revalidate: false },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {selectedReport ? (
        <ReportDetailView
          report={selectedReport}
          onBack={() => setSelectedReport(null)}
          onApply={applyReportPlan}
        />
      ) : (
        <ReportListView
          reports={reports}
          onSelect={(r) => setSelectedReport(r)}
        />
      )}
    </div>
  );
}
