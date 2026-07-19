"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { date, fetcher } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import type { Report, TaskSegment } from "@/lib/db/queries";
import type { TasksResponse } from "@/lib/home/constants";

type ReportsResponse = { reports: Report[] };

type ReportReminder = {
  type: "weekly" | "monthly" | "stage";
  label: string;
  periodStart: string;
  periodEnd: string;
  segmentId?: string;
};

/**
 * 周期末报告提醒 banner：当今天是周末 / 月末 / 段末，且当天任务全部完成，
 * 且该周期尚未生成过报告时，显示「生成报告」提醒按钮。
 * 点击后直接调用独立报告生成接口（不经过 agent）。
 */
export function ReportReminder() {
  const today = useHomeStore((s) => s.today);
  const setSelectedReport = useHomeStore((s) => s.setSelectedReport);
  const setActivePanel = useHomeStore((s) => s.setActivePanel);

  // 共享 useTasks 的 SWR 缓存，但不触发自动全量拉取（按需加载安全网）
  const { data: tasksData } = useSWR<TasksResponse>("/api/tasks", fetcher, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const { data: reportsData, mutate: mutateReports } =
    useSWR<ReportsResponse>("/api/reports", fetcher, {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });

  const tasksByDate = tasksData?.tasksByDate ?? {};
  const segments = tasksData?.segments ?? [];
  const reports = reportsData?.reports ?? [];

  const [generatingReport, setGeneratingReport] = useState(false);

  const reportReminder = useMemo<ReportReminder | null>(() => {
    const todayObj = date.parseDate(today);
    const isWeekEnd = todayObj.getDay() === 0;
    const tomorrow = new Date(todayObj);
    tomorrow.setDate(todayObj.getDate() + 1);
    const isMonthEnd = tomorrow.getDate() === 1;
    const stageEndSegment =
      (segments as TaskSegment[]).find((s) => s.endDate === today) ?? null;
    // const todayList = tasksByDate[today] ?? [];
    // const allDone = todayList.length > 0 && todayList.every((t) => t.done);
    // if (!allDone) return null;
    if (
      isWeekEnd &&
      !reports.some((r) => r.type === "weekly" && r.periodEnd === today)
    ) {
      const weekDates = date.getWeekDates(todayObj);
      return {
        type: "weekly",
        label: "本周周报",
        periodStart: date.formatDate(weekDates[0]),
        periodEnd: today,
      };
    }
    if (
      isMonthEnd &&
      !reports.some((r) => r.type === "monthly" && r.periodEnd === today)
    ) {
      return {
        type: "monthly",
        label: "本月月报",
        periodStart: date.formatDate(
          new Date(todayObj.getFullYear(), todayObj.getMonth(), 1),
        ),
        periodEnd: today,
      };
    }
    if (
      stageEndSegment &&
      !reports.some((r) => r.type === "stage" && r.periodEnd === today)
    ) {
      return {
        type: "stage",
        label: `${stageEndSegment.name}阶段报`,
        periodStart: stageEndSegment.startDate,
        periodEnd: stageEndSegment.endDate,
        segmentId: stageEndSegment.id,
      };
    }
    return null;
  }, [today, segments, tasksByDate, reports]);

  const triggerReport = async () => {
    if (generatingReport || !reportReminder) return;
    setGeneratingReport(true);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: reportReminder.type,
          periodStart: reportReminder.periodStart,
          periodEnd: reportReminder.periodEnd,
          segmentId: reportReminder.segmentId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `生成失败: ${res.status}`);
      }
      const data = (await res.json()) as { report: Report };
      mutateReports(
        { reports: [data.report, ...reports] },
        { revalidate: false },
      );
      setSelectedReport(data.report);
      setActivePanel("report");
      toast.success("报告已生成");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "报告生成失败");
    } finally {
      setGeneratingReport(false);
    }
  };

  if (!reportReminder) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3 sm:px-6">
      <button
        type="button"
        onClick={triggerReport}
        disabled={generatingReport}
        className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-50"
      >
        <FileText className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {generatingReport
              ? "正在生成报告…"
              : `生成${reportReminder.label}`}
          </div>
          <div className="text-xs text-muted-foreground">
            一个周期已经快要过完了，点击让 AI 帮你复盘并规划下个周期
          </div>
        </div>
        {generatingReport ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <Sparkles className="size-4 shrink-0 text-primary" />
        )}
      </button>
    </div>
  );
}
