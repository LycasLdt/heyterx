"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { date, fetcher } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import type { TasksResponse } from "@/lib/home/constants";

/**
 * 任务按需加载 Hook。
 *
 * 设计要点：
 * - SWR key 固定为 "/api/tasks"，fetcher 在显式 revalidate 时拉取全部任务（安全网）。
 * - 通过 fallbackData + revalidateIfStale:false 避免挂载时自动拉取全部。
 * - loadRange(start, end) 调用 /api/tasks?start=…&end=… 按需拉取，merge 进缓存。
 * - 模块级 loadedRangesSet 跟踪已加载日期范围，跨组件实例共享，避免重复请求。
 * - 初始加载：若今天在任务段内，加载该任务段范围 + 最近三周；否则只加载最近三周。
 * - 周历导航：weekOffset 变化时自动加载当前周（若未加载过）。
 */
const TASKS_KEY = "/api/tasks";

const EMPTY: TasksResponse = {
  tasksByDate: {},
  segments: [],
  today: "",
};

/** 模块级已加载日期范围集合，跨所有 useTasks 实例共享。格式 "start|end"。 */
const loadedRangesSet = new Set<string>();

function rangeKey(start: string, end: string) {
  return `${start}|${end}`;
}

/** 检查目标范围是否已被某个已加载范围完全包含 */
function isRangeLoaded(start: string, end: string): boolean {
  for (const key of loadedRangesSet) {
    const idx = key.indexOf("|");
    const s = key.slice(0, idx);
    const e = key.slice(idx + 1);
    if (s <= start && e >= end) return true;
  }
  return false;
}

/** 重置已加载范围追踪（登出/切换用户时调用） */
export function resetLoadedTaskRanges() {
  loadedRangesSet.clear();
}

export function useTasks() {
  const today = useHomeStore((s) => s.today);
  const weekOffset = useHomeStore((s) => s.weekOffset);

  const { data, mutate } = useSWR<TasksResponse>(TASKS_KEY, fetcher, {
    fallbackData: EMPTY,
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  /** 按需加载指定日期范围内的任务并 merge 进 SWR 缓存 */
  const loadRange = useCallback(
    async (start: string, end: string) => {
      if (isRangeLoaded(start, end)) return;
      loadedRangesSet.add(rangeKey(start, end));
      try {
        const res = await fetch(`${TASKS_KEY}?start=${start}&end=${end}`);
        if (!res.ok) {
          loadedRangesSet.delete(rangeKey(start, end));
          return;
        }
        const partial = (await res.json()) as TasksResponse;
        mutate(
          (prev) => {
            const p = prev ?? EMPTY;
            return {
              tasksByDate: { ...p.tasksByDate, ...partial.tasksByDate },
              segments:
                partial.segments.length > 0 ? partial.segments : p.segments,
              today,
            };
          },
          { revalidate: false },
        );
      } catch {
        loadedRangesSet.delete(rangeKey(start, end));
      }
    },
    [mutate, today],
  );

  // --- 初始加载 ---
  const initialLoadedRef = useRef(false);
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;
    const loadInitial = async () => {
      const anchor = date.parseDate(today);
      const lastWeekAnchor = new Date(anchor);
      lastWeekAnchor.setDate(anchor.getDate() - 7);
      const nextWeekAnchor = new Date(anchor);
      nextWeekAnchor.setDate(anchor.getDate() + 7);
      const lastWeek = date.getWeekDates(lastWeekAnchor);
      const nextWeek = date.getWeekDates(nextWeekAnchor);
      const start = date.formatDate(lastWeek[0]!);
      const end = date.formatDate(nextWeek[6]!);

      // 先加载最近三周（响应中包含全部 segments）
      // 多个组件（task-panel / week-calendar）同时挂载时，通过 loadedRangesSet 去重
      if (isRangeLoaded(start, end)) return;
      loadedRangesSet.add(rangeKey(start, end));
      try {
        const res = await fetch(`${TASKS_KEY}?start=${start}&end=${end}`);
        if (!res.ok) {
          loadedRangesSet.delete(rangeKey(start, end));
          return;
        }
        const partial = (await res.json()) as TasksResponse;

        // 若今天落在某个任务段内，补加载该任务段完整范围
        const todaySeg = partial.segments.find(
          (s) => s.startDate <= today && today <= s.endDate,
        );
        if (
          todaySeg &&
          !isRangeLoaded(todaySeg.startDate, todaySeg.endDate)
        ) {
          loadedRangesSet.add(
            rangeKey(todaySeg.startDate, todaySeg.endDate),
          );
          try {
            const segRes = await fetch(
              `${TASKS_KEY}?start=${todaySeg.startDate}&end=${todaySeg.endDate}`,
            );
            const segPartial = (await segRes.json()) as TasksResponse;
            mutate(
              {
                tasksByDate: {
                  ...partial.tasksByDate,
                  ...segPartial.tasksByDate,
                },
                segments: partial.segments,
                today,
              },
              { revalidate: false },
            );
            return;
          } catch {
            loadedRangesSet.delete(
              rangeKey(todaySeg.startDate, todaySeg.endDate),
            );
          }
        }
        mutate(partial, { revalidate: false });
      } catch {
        loadedRangesSet.delete(rangeKey(start, end));
      }
    };
    void loadInitial();
  }, [today, mutate]);

  // --- 周历导航：加载当前周 ---
  useEffect(() => {
    if (!initialLoadedRef.current) return;
    const anchor = date.parseDate(today);
    anchor.setDate(anchor.getDate() + weekOffset * 7);
    const week = date.getWeekDates(anchor);
    void loadRange(date.formatDate(week[0]!), date.formatDate(week[6]!));
  }, [weekOffset, today, loadRange]);

  return { data: data ?? EMPTY, mutate, loadRange };
}
