"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useTheme } from "next-themes";
import { Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn, fetcher } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import type { UserPreferences } from "@/lib/db/schema";
import { AppHeader } from "@/components/home/app-header";
import { ReportReminder } from "@/components/home/report-reminder";
import { TaskPanel } from "@/components/home/task-panel";
import { ChatPanel } from "@/components/home/chat-panel";
import { ReportPanel } from "@/components/home/reports";
import { ExportPanel } from "@/components/home/exports";
import { SideToolbar } from "@/components/home/side-toolbar";
import { SettingsDialog } from "@/components/home/settings-dialog";
import { DndProvider } from "@/components/home/dnd-provider";
import { SidebarProvider } from "@/components/ui/sidebar";

/**
 * 主界面布局壳。
 *
 * 职责（仅三项）：
 * 1. 鉴权：未登录跳转 /login，会话加载中显示 loading
 * 2. 偏好初始化：首次加载 preferences 后一次性设置 viewMode + theme
 * 3. 布局：渲染各子组件，子组件自行从 store 读状态、useSWR 拉数据
 *
 * 子组件通过 zustand store（useHomeStore）共享 UI 状态，通过 SWR 共享远程数据，
 * 各组件只在与自身相关的状态/数据变化时重渲染。
 */
export default function Home() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const user = session?.user ?? null;

  // 偏好初始化（一次性）
  const { data: prefsData } = useSWR<{ preferences: UserPreferences }>(
    user ? "/api/preferences" : null,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const preferences = prefsData?.preferences;
  const setViewMode = useHomeStore((s) => s.setViewMode);
  const activePanel = useHomeStore((s) => s.activePanel);
  const { setTheme } = useTheme();
  const viewModeInitRef = useRef(false);
  useEffect(() => {
    if (viewModeInitRef.current || !preferences) return;

    setViewMode(preferences.general.defaultTaskView);
    setTheme(preferences.general.theme);
    viewModeInitRef.current = true;
  }, [preferences, setTheme, setViewMode]);

  // 未登录跳转
  useEffect(() => {
    if (!sessionLoading && !session) {
      router.replace("/login");
    }
  }, [sessionLoading, session, router]);

  // 会话未就绪时显示加载态
  if (sessionLoading || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4 animate-pulse" />
          <span>加载中…</span>
        </div>
      </div>
    );
  }

  return (
    <DndProvider>
      <div className="flex h-dvh flex-col bg-background text-foreground overflow-hidden">
        <AppHeader />
        <SidebarProvider
          className="min-h-0 flex-1 flex-col md:flex-row"
          style={
            { "--sidebar-width": "3rem" } as React.CSSProperties
          }
        >
          {/* 左侧主区域：日期 + 任务面板（WeekCalendar 已内嵌到 TaskPanel 中）。
              手机端选中面板时隐藏，桌面端始终显示 */}
          <div
            className={cn(
              "flex items-center min-h-0 min-w-0 flex-1 flex-col",
              activePanel && "hidden md:flex",
            )}
          >
            <ReportReminder />
            <TaskPanel />
          </div>

          {/* 右侧面板：由 sidebar 控制显示哪个。
              ChatPanel 始终挂载（保留 useChat 流式状态），仅切换可见性；
              Export / Report 按需挂载（SWR 缓存复用） */}
          <div
            className={cn(
              "min-h-0 min-w-0",
              activePanel === "chat"
                ? "flex flex-1 flex-col md:flex-none md:w-96 md:border-l md:border-border lg:w-[28rem] xl:w-[32rem]"
                : "hidden",
            )}
          >
            <ChatPanel />
          </div>
          {activePanel === "export" && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-none md:w-96 md:border-l md:border-border lg:w-[28rem] xl:w-[32rem]">
              <ExportPanel />
            </div>
          )}
          {activePanel === "report" && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-none md:w-96 md:border-l md:border-border lg:w-[28rem] xl:w-[32rem]">
              <ReportPanel />
            </div>
          )}

          <SideToolbar />
        </SidebarProvider>
        <SettingsDialog />
      </div>
    </DndProvider>
  );
}
