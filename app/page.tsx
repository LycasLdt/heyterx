"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutGrid,
  LayoutList,
  LogOut,
  Send,
  Settings,
  Sparkles,
  Square,
  User,
  Wrench,
} from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
} from "recharts";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import type {
  Category,
  ConversationRow,
  Importance,
  Report,
  Task,
  TaskSegment,
  TasksByDate,
} from "@/lib/db/queries";
import type { UserPreferences } from "@/lib/db/schema";
import { useTheme } from "next-themes";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  formatDate,
  getWeekDates,
  parseDate,
  WEEKDAY_LABELS,
} from "@/lib/date";

const TOOL_LABELS: Record<string, string> = {
  searchTasks: "搜索任务",
  getTasks: "读取任务计划",
  addTask: "新增任务",
  toggleTask: "切换任务状态",
  updateTask: "修改任务",
  moveTask: "移动任务",
  deleteTask: "删除任务",
  analyzeTaskBalance: "分析任务平衡",
  createTaskSegment: "创建任务段",
  updateTaskSegment: "修改任务段",
};

/** 静默工具：不向用户展示其工具调用气泡（记忆系统相关操作对用户不可见） */
const HIDDEN_TOOLS = new Set([
  "updateCoreMemory",
  "searchConversations",
]);

/** 任务完成时按五育维度给出的简短正向反馈（随机选一条展示） */
const CATEGORY_FEEDBACK: Record<Category, string[]> = {
  智育: [
    "你攻克了这个难点，又积累了一个新的解题方法，持续下去进步会很明显。",
    "这一步虽小，却在把你的知识网络织得更密，继续保持。",
  ],
  体育: [
    "这次拉伸帮你放松了肩颈的紧绷，大脑也会跟着清醒很多。",
    "短暂的微运动让血液循环起来，下一段学习会更专注。",
  ],
  德育: [
    "小小的善意会给别人带去温暖，也会让你收获更融洽的人际氛围。",
    "这一份用心会被对方接住，你也在关系里多攒了一份踏实。",
  ],
  美育: [
    "这段柔和的旋律帮你从紧绷里抽离了一会儿，情绪已经悄悄平复啦。",
    "几分钟的审美小憩，让紧绷的神经松开了一些，很会照顾自己。",
  ],
  劳育: [
    "整洁的小空间会让你做事更顺手，也会让心里更踏实。",
    "顺手收拾好的角落，正在悄悄给你一种「我能掌控」的踏实感。",
  ],
};

function pickFeedback(category: Category): string {
  const list = CATEGORY_FEEDBACK[category] ?? CATEGORY_FEEDBACK.智育;
  return list[Math.floor(Math.random() * list.length)];
}

/** 系统触发消息前缀：带此前缀的 user 消息不向用户展示（用于新一天问候触发） */
const SYSTEM_TRIGGER_PREFIX = "__system_trigger__";
/** 「查看更多历史对话」每次释放的消息条数 */
const HISTORY_LOAD_BATCH = 20;

/** 任务段指示器配色：按 segments 数组中的索引循环取色，保证稳定 */
const SEGMENT_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
] as const;

/** 重要度紧急度的样式与象限信息 */
const IMPORTANCE_META: Record<
  Importance,
  { badge: string; quadrant: string; short: string }
> = {
  重要且紧急: {
    badge: "bg-red-500/10 text-red-700 dark:text-red-300",
    quadrant: "重要 · 紧急",
    short: "重紧",
  },
  重要但不紧急: {
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    quadrant: "重要 · 不紧急",
    short: "重不紧",
  },
  不重要但紧急: {
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    quadrant: "不重要 · 紧急",
    short: "不重紧",
  },
  不重要且不紧急: {
    badge: "bg-muted text-muted-foreground",
    quadrant: "不重要 · 不紧急",
    short: "不重不紧",
  },
};

/** 五育分类的样式 */
const CATEGORY_META: Record<Category, { badge: string; short: string }> = {
  德育: { badge: "bg-purple-500/10 text-purple-700 dark:text-purple-300", short: "德" },
  智育: { badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300", short: "智" },
  体育: { badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", short: "体" },
  美育: { badge: "bg-pink-500/10 text-pink-700 dark:text-pink-300", short: "美" },
  劳育: { badge: "bg-orange-500/10 text-orange-700 dark:text-orange-300", short: "劳" },
};

/** 四象限顺序：左上→右上→左下→右下 */
const QUADRANT_ORDER: Importance[] = [
  "重要且紧急",
  "重要但不紧急",
  "不重要但紧急",
  "不重要且不紧急",
];

/** 报告类型 → 中文标签 */
const REPORT_TYPE_LABELS: Record<Report["type"], string> = {
  weekly: "周报",
  monthly: "月报",
  stage: "阶段报",
};

/** 五育维度配色（雷达图 + 进度条复用） */
const GROWTH_COLORS: Record<string, string> = {
  智育: "#2563eb",
  体育: "#16a34a",
  德育: "#9333ea",
  美育: "#db2777",
  劳育: "#ea580c",
};

/** SWR fetcher：失败时抛错以便 SWR 进入 error 状态 */
const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
};

/** 取用户邮箱或昵称的首字母作为头像 fallback */
function initials(s: string | null | undefined): string {
  if (!s) return "?";
  return s.trim().slice(0, 1).toUpperCase();
}

/** 任务属性徽章：显示重要度紧急度 + 五育分类 */
function TaskBadges({ task }: { task: Task }) {
  const imp = IMPORTANCE_META[task.importance];
  const cat = CATEGORY_META[task.category];
  return (
    <div className="flex flex-wrap gap-1">
      {imp && (
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

type TasksResponse = {
  tasksByDate: TasksByDate;
  segments: TaskSegment[];
  today: string;
};

/** 简单数值展示卡片 */
function Stat({
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
function ReportListView({
  reports,
  onSelect,
}: {
  reports: Report[];
  onSelect: (r: Report) => void;
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>报告</SheetTitle>
        <SheetDescription>查看历史周报、月报与阶段报</SheetDescription>
      </SheetHeader>
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
function ReportDetailView({
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
      <SheetHeader>
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> 返回列表
        </button>
        <SheetTitle className="text-base">{report.title}</SheetTitle>
        <SheetDescription>
          {REPORT_TYPE_LABELS[report.type]} · {report.periodStart} →{" "}
          {report.periodEnd}
        </SheetDescription>
      </SheetHeader>
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
type ConversationResponse = { conversation: ConversationRow | null };
type ViewMode = "list" | "quadrant";

export default function Home() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const user = session?.user ?? null;

  // today 在客户端本地时区计算一次并固定，作为默认日期与“仅今天及以后可改”的基准
  const [today] = useState(() => formatDate(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 待确认的「撤销完成」任务：用户把已完成任务再次切回未完成时，弹出 AlertDialog 确认
  const [pendingUncomplete, setPendingUncomplete] = useState<Task | null>(
    null
  );
  // 新一天问候时折叠掉的旧消息数量；用户点击「查看更多历史对话」时逐步释放
  const [hiddenCount, setHiddenCount] = useState(0);
  // 防止新一天问候在 sendMessage 与 setMessages 竞态下重复触发
  const greetingInFlightRef = useRef(false);

  // 未登录跳转到 /login
  useEffect(() => {
    if (!sessionLoading && !session) {
      router.replace("/login");
    }
  }, [sessionLoading, session, router]);

  // SWR：加载任务列表。user 存在时才发请求；窗口聚焦自动 revalidate 以保持最新
  const {
    data: tasksData,
    mutate: mutateTasks,
  } = useSWR<TasksResponse>(user ? "/api/tasks" : null, fetcher);
  const tasksByDate = tasksData?.tasksByDate ?? {};
  const segments = tasksData?.segments ?? [];

  // SWR：加载历史对话。只在挂载时拉取一次，避免流式中被覆盖
  const { data: convData, mutate: mutateConv } =
    useSWR<ConversationResponse>(
      user ? "/api/conversations" : null,
      fetcher,
      { revalidateOnFocus: false, revalidateOnReconnect: false }
    );

  // SWR：加载报告列表。流式中 generateReport 工具输出会 mutate 此缓存
  const { data: reportsData, mutate: mutateReports } = useSWR<
    { reports: Report[] }
  >(user ? "/api/reports" : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const reports = reportsData?.reports ?? [];

  // SWR：加载用户偏好（主题 / 默认任务视图 / Agent 配置），与 SettingsDialog 共享缓存
  const { data: prefsData } = useSWR<{ preferences: UserPreferences }>(
    user ? "/api/preferences" : null,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  const preferences = prefsData?.preferences;
  const viewModeInitRef = useRef(false);
  const { setTheme } = useTheme();
  // 首次加载偏好后初始化任务视图与主题（一次性，不覆盖用户后续手动切换）
  useEffect(() => {
    if (viewModeInitRef.current || !preferences) return;
    setViewMode(preferences.general.defaultTaskView);
    setTheme(preferences.general.theme);
    viewModeInitRef.current = true;
  }, [preferences, setTheme]);

  // 客户端不再发送 tasksByDate（服务端从 DB 读取）
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages, today },
        }),
      }),
    [today]
  );

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    transport,
  });

  // 加载历史对话：仅注入一次，避免 SWR revalidate 时覆盖流式状态
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current) return;
    if (!convData) return;
    historyLoadedRef.current = true;
    if (convData.conversation) {
      setConversationId(convData.conversation.id);
      const msgs = convData.conversation.messages ?? [];
      if (msgs.length > 0) {
        try {
          setMessages(msgs);
          // 新一天问候检测：最近一次对话的更新日期早于今天 → 视为新一天开始
          // 隐藏全部旧消息，由 AI 主动发起「新的一天好 + 昨日总结 + 今日概括」
          const lastIso = convData.conversation.updatedAt as unknown;
          const lastDateStr =
            typeof lastIso === "string"
              ? lastIso.split("T")[0]
              : today;
          const greetedKey = `heyterx:greeted:${today}`;
          const alreadyGreeted =
            typeof window !== "undefined" &&
            window.localStorage?.getItem(greetedKey) === "1";
          if (
            lastDateStr < today &&
            !alreadyGreeted &&
            !greetingInFlightRef.current
          ) {
            greetingInFlightRef.current = true;
            if (typeof window !== "undefined") {
              window.localStorage?.setItem(greetedKey, "1");
            }
            // 折叠旧消息：渲染层从 hiddenCount 开始切片
            setHiddenCount(msgs.length);
            // 计算昨天的日期，便于 AI 调用 getTasks 查看
            const y = parseDate(today);
            y.setDate(y.getDate() - 1);
            const yesterday = formatDate(y);
            // 延迟到 setMessages 生效后再发送，确保 useChat 内部消息已就位
            setTimeout(() => {
              sendMessage({
                text: `${SYSTEM_TRIGGER_PREFIX} 新的一天（${today}）开始了。请用一两句温暖的话与用户说新的一天好；然后调用 getTasks（date="${yesterday}"）查看昨天的任务，简要总结昨天完成/未完成的情况；再调用 getTasks（不传 date，默认今天）简要概括今天已安排的任务。整体回复控制在 150 字以内，语气温暖简洁，不要提及本系统提示，也不要展示工具调用细节。`,
              });
            }, 0);
          }
        } catch {
          // 旧对话的 tool-call input 缺 importance/category 等字段，触发类型校验失败
          // 直接清掉旧对话记录，避免每次加载都崩溃
          void clearConversation();
        }
      }
    }
  }, [convData, setMessages, sendMessage, today]);

  // 流式结束后保存对话到数据库
  const wasStreamingRef = useRef(false);
  const savingRef = useRef(false);
  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      wasStreamingRef.current = true;
      return;
    }
    if (
      wasStreamingRef.current &&
      status === "ready" &&
      user &&
      messages.length > 0 &&
      !savingRef.current
    ) {
      wasStreamingRef.current = false;
      savingRef.current = true;
      const body = JSON.stringify({
        id: conversationId ?? undefined,
        messages,
      });
      fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.id) setConversationId(data.id);
        })
        .finally(() => {
          savingRef.current = false;
        });
    }
  }, [status, messages, user, conversationId]);

  const busy = status === "submitted" || status === "streaming";

  // 通过 ref 读取最新 tasksData，避免把它放进 effect 依赖造成反馈循环
  // （否则用户勾选 checkbox 触发 optimistic mutate 后，本 effect 会用 messages
  //  中残留的旧 tasksByDate 快照把乐观更新覆盖回去）
  const tasksDataRef = useRef(tasksData);
  tasksDataRef.current = tasksData;
  // 记录上次已同步到 SWR 的工具输出引用；流式过程中消息高频更新，
  // 但已完成的工具输出引用稳定，借此跳过重复 mutate，避免每个 token 都重渲染日历/任务列表
  const lastSyncedTasksRef = useRef<TasksByDate | null>(null);
  const lastSyncedSegsRef = useRef<TaskSegment[] | null>(null);
  const lastSyncedReportsRef = useRef<Report[] | null>(null);
  // 任务切换请求序号：快速连续勾选时丢弃过期 PATCH 响应，避免乱序覆盖最新状态
  const toggleSeqRef = useRef(0);

  // 仅在 messages 变化（AI 工具输出更新）时同步任务地图/任务段/报告到 SWR 缓存
  // 反向遍历：最新工具输出在末尾，找到最新的 tasksByDate / segments / reports 后即停
  useEffect(() => {
    let latest: TasksByDate | null = null;
    let latestSegments: TaskSegment[] | null = null;
    let latestReports: Report[] | null = null;
    scan: for (let mi = messages.length - 1; mi >= 0; mi--) {
      const parts = messages[mi].parts as UIMessage["parts"];
      for (let pi = parts.length - 1; pi >= 0; pi--) {
        const part = parts[pi];
        if (
          typeof part.type !== "string" ||
          !part.type.startsWith("tool-") ||
          part.type === "tool-dynamic-tool"
        )
          continue;
        const toolPart = part as {
          type: string;
          state?: string;
          output?: {
            tasksByDate?: TasksByDate;
            segments?: TaskSegment[];
            reports?: Report[];
          };
        };
        if (toolPart.state !== "output-available" || !toolPart.output)
          continue;
        if (!latest && toolPart.output.tasksByDate) {
          latest = toolPart.output.tasksByDate;
        }
        if (!latestSegments && toolPart.output.segments) {
          latestSegments = toolPart.output.segments;
        }
        if (!latestReports && toolPart.output.reports) {
          latestReports = toolPart.output.reports;
        }
        if (latest && latestSegments && latestReports) break scan;
      }
    }
    // 跳过迁移前的陈旧 tool 输出：旧任务对象缺 importance/category 字段，
    // 直接覆盖会破坏 TaskBadges 渲染（GET /api/tasks 返回的数据才是权威的）
    const isStale = latest
      ? Object.values(latest).some((list) =>
          list.some(
            (t) => t.importance === undefined || t.category === undefined
          )
        )
      : false;
    const tasksToSync = latest && !isStale ? latest : null;
    const segsToSync = latestSegments;
    const reportsToSync = latestReports;
    // 仅当工具输出引用变化（新工具调用完成）时才 mutate，避免流式文本逐 token 触发重渲染
    if (
      (tasksToSync && tasksToSync !== lastSyncedTasksRef.current) ||
      (segsToSync && segsToSync !== lastSyncedSegsRef.current) ||
      (reportsToSync && reportsToSync !== lastSyncedReportsRef.current)
    ) {
      if (tasksDataRef.current) {
        mutateTasks(
          {
            ...tasksDataRef.current,
            tasksByDate: tasksToSync ?? tasksDataRef.current.tasksByDate,
            segments: segsToSync ?? tasksDataRef.current.segments,
          },
          { revalidate: false }
        );
      }
      if (reportsToSync) {
        mutateReports({ reports: reportsToSync }, { revalidate: false });
      }
      if (tasksToSync) lastSyncedTasksRef.current = tasksToSync;
      if (segsToSync) lastSyncedSegsRef.current = segsToSync;
      if (reportsToSync) lastSyncedReportsRef.current = reportsToSync;
    }
  }, [messages, mutateTasks, mutateReports]);

  // 当前显示的那一周：以 today 为基准，按 weekOffset 平移整周
  const weekDates = useMemo(() => {
    const anchor = parseDate(today);
    anchor.setDate(anchor.getDate() + weekOffset * 7);
    return getWeekDates(anchor);
  }, [today, weekOffset]);

  // 预计算本周每天被哪些任务段覆盖 + 每个段的配色索引，避免日历每项重复过滤/查找
  const segmentsByDate = useMemo(() => {
    const map: Record<string, TaskSegment[]> = {};
    for (const d of weekDates) {
      const ds = formatDate(d);
      map[ds] = segments.filter(
        (s) => s.startDate <= ds && ds <= s.endDate
      );
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

  const dayTasks = tasksByDate[selectedDate] ?? [];
  const remaining = dayTasks.filter((t) => !t.done).length;
  const isPastDay = selectedDate < today;
  const isSelectedToday = selectedDate === today;

  /**
   * 客户端勾选任务：SWR 乐观更新
   * 1) 立即更新本地缓存（基于最新 cache 函数式更新，避免闭包 tasksData 过期导致乐观更新丢失）
   * 2) PATCH 到服务端
   * 3) 成功：仅当本请求仍是最新一次时，用服务端 tasksByDate 覆盖（丢弃乱序的过期响应）
   * 4) 失败：仅当本请求仍是最新一次时，revalidate 回滚
   */
  const toggleTask = async (id: string, next: boolean) => {
    if (isPastDay) return;
    const seq = ++toggleSeqRef.current;

    mutateTasks(
      (prev) => {
        if (!prev) return prev;
        const list = prev.tasksByDate[selectedDate] ?? [];
        return {
          ...prev,
          tasksByDate: {
            ...prev.tasksByDate,
            [selectedDate]: list.map((t) =>
              t.id === id ? { ...t, done: next } : t
            ),
          },
        };
      },
      { revalidate: false }
    );

    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, done: next }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      const data = (await res.json()) as { tasksByDate: TasksByDate };
      // 过期响应丢弃：快速连续勾选时，只接受最后一次请求的结果
      if (seq !== toggleSeqRef.current) return;
      mutateTasks(
        (prev) => (prev ? { ...prev, tasksByDate: data.tasksByDate } : prev),
        { revalidate: false }
      );
    } catch {
      if (seq !== toggleSeqRef.current) return;
      // 失败回滚：重新拉取真实状态
      mutateTasks();
    }
  };

  /**
   * 用户点击任务复选框的统一入口：
   * - 标记完成（done=false→true）：立即乐观更新 + 按五育维度弹出正向反馈 toast
   * - 撤销完成（done=true→false）：不立即切换，弹出 AlertDialog 让用户二次确认
   *   （避免误触把已完成任务撤回，鼓励用户谨慎修改任务状态）
   */
  const handleTaskCheck = (task: Task, next: boolean) => {
    if (next) {
      void toggleTask(task.id, true);
      toast.success(pickFeedback(task.category), {
        duration: 4000,
      });
    } else {
      setPendingUncomplete(task);
    }
  };

  /** AlertDialog 确认撤销完成 */
  const confirmUncomplete = () => {
    const task = pendingUncomplete;
    setPendingUncomplete(null);
    if (task) void toggleTask(task.id, false);
  };

  /**
   * 周期末报告提醒：当今天是周末 / 月末 / 段末，且当天任务全部完成，
   * 且该周期尚未生成过报告时，显示「生成报告」提醒按钮。
   */
  const reportReminder = useMemo(() => {
    const todayObj = parseDate(today);
    const isWeekEnd = todayObj.getDay() === 0; // 周日 = 周末
    const tomorrow = new Date(todayObj);
    tomorrow.setDate(todayObj.getDate() + 1);
    const isMonthEnd = tomorrow.getDate() === 1; // 明天是 1 号 → 今天是月末
    const stageEndSegment =
      segments.find((s) => s.endDate === today) ?? null;
    const todayList = tasksByDate[today] ?? [];
    const allDone =
      todayList.length > 0 && todayList.every((t) => t.done);
    if (!allDone) return null;
    if (
      isWeekEnd &&
      !reports.some((r) => r.type === "weekly" && r.periodEnd === today)
    ) {
      return {
        type: "weekly" as const,
        label: "本周周报",
        prompt: "请帮我生成本周周报（本周一到本周日）",
      };
    }
    if (
      isMonthEnd &&
      !reports.some((r) => r.type === "monthly" && r.periodEnd === today)
    ) {
      return {
        type: "monthly" as const,
        label: "本月月报",
        prompt: "请帮我生成本月月报（本月 1 日到今天）",
      };
    }
    if (
      stageEndSegment &&
      !reports.some((r) => r.type === "stage" && r.periodEnd === today)
    ) {
      return {
        type: "stage" as const,
        label: `${stageEndSegment.name}阶段报`,
        prompt: `请帮我生成「${stageEndSegment.name}」的阶段报（${stageEndSegment.startDate} 到 ${stageEndSegment.endDate}）`,
      };
    }
    return null;
  }, [today, segments, tasksByDate, reports]);

  /** 点击提醒 banner：发送消息触发 AI 调用 generateReport */
  const triggerReport = () => {
    if (busy || !reportReminder) return;
    sendMessage({ text: reportReminder.prompt });
  };

  /** 应用报告下周期规划：POST /api/reports 批量创建任务，并 merge 到 tasks 缓存 */
  const applyReportPlan = async (reportId: string) => {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId }),
    });
    if (!res.ok) throw new Error(`应用规划失败: ${res.status}`);
    const data = (await res.json()) as { tasksByDate: TasksByDate };
    // PATCH /api/tasks 同款 merge 策略：只覆盖 tasksByDate，保留 segments
    mutateTasks(
      (prev) => (prev ? { ...prev, tasksByDate: data.tasksByDate } : prev),
      { revalidate: false }
    );
  };

  const selectedDateObj = parseDate(selectedDate);
  const selectedWeekday =
    WEEKDAY_LABELS[(selectedDateObj.getDay() + 6) % 7];
  const selectedLabel = isSelectedToday ? "今天" : selectedDate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  };

  /** 清空所有对话记录：调用 DELETE API + 重置本地状态 */
  const clearConversation = async () => {
    setMessages([]);
    setConversationId(null);
    setHiddenCount(0);
    greetingInFlightRef.current = false;
    mutateConv({ conversation: null }, { revalidate: false });
    await fetch("/api/conversations", { method: "DELETE" });
  };

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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* 标题栏 + 账号下拉菜单 */}
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">heyterx</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="账号菜单"
            >
              <Avatar>
                <AvatarImage src={user.image ?? undefined} alt={user.name} />
                <AvatarFallback>
                  {initials(user.name ?? user.email)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{user.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {user.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setSelectedReport(null);
                setReportSheetOpen(true);
              }}
            >
              <FileText className="size-4" />
              <span>报告</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings className="size-4" />
              <span>设置</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* 横屏左右分栏：左 = 日历+任务，右 = AI 对话；竖屏保持上下排版 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <main className="flex min-h-0 flex-1 flex-col md:border-r md:border-border">
        {/* 周日历：左右箭头切换周，每个圆角按钮只显示日期与任务指示点
            item 用 aspect-square + flex-1 + max-w-12，窄屏自动缩小、宽屏不超过 48px */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6">
          <div className="flex items-center justify-center gap-1 sm:gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setWeekOffset((w) => w - 1)}
              aria-label="上一周"
              className="size-8 shrink-0 sm:size-9"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="flex flex-1 justify-center gap-1 sm:gap-1.5">
              {weekDates.map((d) => {
                const ds = formatDate(d);
                const list = tasksByDate[ds] ?? [];
                const pending = list.filter((t) => !t.done).length;
                const isToday = ds === today;
                const isSelected = ds === selectedDate;
                const isPast = ds < today;
                const daySegs = segmentsByDate[ds] ?? [];
                return (
                  <Tooltip key={ds}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setSelectedDate(ds)}
                        className={cn(
                          "flex aspect-square max-w-12 flex-1 flex-col items-center justify-center gap-1 rounded-full border transition-colors",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : isToday
                              ? "border-primary text-primary"
                              : "border-transparent hover:bg-muted",
                          isPast && !isSelected && "opacity-60"
                        )}
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
                                  SEGMENT_COLORS[segmentColorMap[s.id] ?? 0]
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
                                : "bg-muted-foreground/40"
                          )}
                        />
                      </button>
                    </TooltipTrigger>
                    {daySegs.length > 0 && (
                      <TooltipContent>
                        <div className="flex flex-col gap-1">
                          {daySegs.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-center gap-1.5"
                            >
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  SEGMENT_COLORS[segmentColorMap[s.id] ?? 0]
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
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setWeekOffset((w) => w + 1)}
              aria-label="下一周"
              className="size-8 shrink-0 sm:size-9"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* 周期末任务全部完成时显示「生成报告」提醒 banner */}
        {reportReminder && (
          <div className="mx-auto w-full max-w-3xl px-4 pt-3 sm:px-6">
            <button
              type="button"
              onClick={triggerReport}
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              <FileText className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  生成{reportReminder.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  今天的任务已全部完成，点击让 AI 帮你复盘并规划下个周期
                </div>
              </div>
              <Sparkles className="size-4 shrink-0 text-primary" />
            </button>
          </div>
        )}

        {/* 选中日期的任务列表 */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4 sm:px-6">
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
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
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
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuLabel>切换视图</DropdownMenuLabel>
                    <DropdownMenuSeparator />
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
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="text-xs text-muted-foreground">
                  剩余 {remaining} / 共 {dayTasks.length}
                </span>
              </div>
            </div>
            {dayTasks.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {isPastDay
                  ? "这一天没有任务记录。"
                  : "这一天还没有任务，在下方对话框里让 AI 帮你安排吧。"}
              </p>
            ) : viewMode === "list" ? (
              <ul className="space-y-1">
                {dayTasks.map((task) => (
                  <li key={task.id}>
                    <label
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
                        isPastDay
                          ? "cursor-default"
                          : "cursor-pointer hover:bg-muted"
                      )}
                    >
                      <Checkbox
                        checked={task.done}
                        onCheckedChange={(v) =>
                          handleTaskCheck(task, v === true)
                        }
                        className="mt-0.5 size-5"
                        disabled={isPastDay}
                      />
                      <div className="flex flex-1 flex-col gap-1">
                        <span
                          className={cn(
                            "text-sm leading-snug",
                            task.done
                              ? "text-muted-foreground line-through"
                              : "text-foreground"
                          )}
                        >
                          {task.title}
                        </span>
                        <TaskBadges task={task} />
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {QUADRANT_ORDER.map((imp) => {
                  const tasks = dayTasks.filter(
                    (t) => t.importance === imp
                  );
                  const meta = IMPORTANCE_META[imp];
                  return (
                    <div
                      key={imp}
                      className="flex min-h-24 flex-col rounded-lg border p-2"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
                            meta.badge
                          )}
                        >
                          {meta.quadrant}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {tasks.length} 项
                        </span>
                      </div>
                      {tasks.length === 0 ? (
                        <p className="flex flex-1 items-center justify-center py-3 text-center text-[11px] text-muted-foreground">
                          无
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {tasks.map((task) => (
                            <li key={task.id}>
                              <label
                                className={cn(
                                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 transition-colors",
                                  isPastDay
                                    ? "cursor-default"
                                    : "cursor-pointer hover:bg-muted"
                                )}
                              >
                                <Checkbox
                                  checked={task.done}
                                  onCheckedChange={(v) =>
                                    handleTaskCheck(task, v === true)
                                  }
                                  className="mt-0.5 size-4"
                                  disabled={isPastDay}
                                />
                                <div className="flex flex-1 flex-col gap-1">
                                  <span
                                    className={cn(
                                      "text-xs leading-snug",
                                      task.done
                                        ? "text-muted-foreground line-through"
                                        : "text-foreground"
                                    )}
                                  >
                                    {task.title}
                                  </span>
                                  <TaskBadges task={task} />
                                </div>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </main>

      {/* AI 对话：横屏时为右栏占满高度 */}
      <section className="border-t md:flex md:min-h-0 md:flex-1 md:flex-col md:border-l md:border-t-0">
        <div className="mx-auto flex h-80 w-full max-w-3xl flex-col px-6 py-4 md:h-full md:min-h-0">
          <div className="mb-2 flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">AI 对话</h2>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 pr-3">
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setHiddenCount((c) => Math.max(0, c - HISTORY_LOAD_BATCH))
                  }
                  className="mx-auto flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  <ChevronDown className="size-3.5 rotate-180" />
                  <span>
                    查看更多历史对话
                    {hiddenCount > 0 ? `（剩余 ${hiddenCount} 条）` : ""}
                  </span>
                </button>
              )}
              {messages.slice(hiddenCount).map((msg) => {
                // 系统触发消息（如新一天问候触发）整条不渲染，避免出现孤立头像
                const isSystemTrigger =
                  msg.role === "user" &&
                  msg.parts.some(
                    (p) =>
                      p.type === "text" &&
                      typeof p.text === "string" &&
                      p.text.startsWith(SYSTEM_TRIGGER_PREFIX)
                  );
                if (isSystemTrigger) return null;
                return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2.5",
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}
                  >
                    {msg.role === "user" ? (
                      <User className="size-3.5" />
                    ) : (
                      <Bot className="size-3.5" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "flex max-w-[80%] flex-col gap-1.5",
                      msg.role === "user" ? "items-end" : "items-start"
                    )}
                  >
                    {msg.parts.map((part, i) => {
                      const key = `${msg.id}-${i}`;
                      if (part.type === "text") {
                        if (!part.text) return null;
                        // 系统触发消息（如新一天问候）不向用户展示
                        if (
                          msg.role === "user" &&
                          part.text.startsWith(SYSTEM_TRIGGER_PREFIX)
                        ) {
                          return null;
                        }
                        const isStreaming = part.state === "streaming";
                        const isAssistant = msg.role === "assistant";
                        return (
                          <div
                            key={key}
                            className={cn(
                              "max-w-full rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                              isAssistant
                                ? "bg-muted text-foreground"
                                : "bg-primary text-primary-foreground"
                            )}
                          >
                            {isAssistant && !isStreaming ? (
                              <Markdown content={part.text} />
                            ) : (
                              <span className="whitespace-pre-wrap wrap-break-word">
                                {part.text}
                              </span>
                            )}
                          </div>
                        );
                      }
                      if (
                        typeof part.type === "string" &&
                        part.type.startsWith("tool-") &&
                        part.type !== "tool-dynamic-tool"
                      ) {
                        const toolName = part.type.slice(5);
                        // 记忆系统相关工具调用对用户不可见
                        if (HIDDEN_TOOLS.has(toolName)) return null;
                        const toolPart = part as {
                          type: string;
                          state?: string;
                          input?: unknown;
                        };
                        const label = TOOL_LABELS[toolName] ?? toolName;
                        const stateLabel =
                          toolPart.state === "output-available"
                            ? "完成"
                            : toolPart.state === "output-error"
                              ? "出错"
                              : "调用中…";
                        return (
                          <div
                            key={key}
                            className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                          >
                            <Wrench className="size-3" />
                            <span>{label}</span>
                            <span className="text-muted-foreground/70">
                              · {stateLabel}
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
                );
              })}
              {busy && (
                <div className="flex gap-2.5">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                    <Bot className="size-3.5" />
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl bg-muted px-3.5 py-2.5">
                    <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                    <span
                      className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                      style={{ animationDelay: "0.15s" }}
                    />
                    <span
                      className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                      style={{ animationDelay: "0.3s" }}
                    />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {error && (
            <p className="mt-2 text-xs text-destructive">
              出错了：{error.message}
            </p>
          )}

          <form className="mt-3 flex items-center gap-2" onSubmit={handleSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如「把今天的 t3 标记为完成」或「明天加一个任务：买菜」"
              className="h-9 flex-1 rounded-full border border-input bg-background px-4 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {busy ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="停止"
                onClick={() => stop()}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                aria-label="发送"
                disabled={!input.trim()}
              >
                <Send className="size-4" />
              </Button>
            )}
          </form>
        </div>
      </section>
      </div>

      {/* 报告 Sheet：第 1 层列表 / 第 2 层详情（含雷达图 + 应用规划按钮） */}
      <Sheet
        open={reportSheetOpen}
        onOpenChange={(open) => {
          setReportSheetOpen(open);
          if (!open) setSelectedReport(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 sm:max-w-xl"
        >
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
        </SheetContent>
      </Sheet>

      {/* 设置 Dialog：通用 / Agent / 危险 / 关于 */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onConversationCleared={() => {
          setMessages([]);
          setConversationId(null);
          mutateConv({ conversation: null }, { revalidate: false });
        }}
        onAccountDeleted={() => {
          authClient.signOut().then(() => router.replace("/login"));
        }}
      />

      {/* 撤销任务完成的二次确认：避免误触把已完成任务撤回 */}
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
                ? `「${pendingUncomplete.title}」已经完成，重新切回未完成会让进度回退。`
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
    </div>
  );
}
