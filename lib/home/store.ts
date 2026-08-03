"use client";

import { create } from "zustand";
import { date } from "@/lib/utils";
import type { Report } from "@/lib/db/queries";
import type { ViewMode } from "@/components/home/task-panel";

/**
 * 主界面统一状态管理。
 *
 * 设计原则：
 * - 只有跨组件共享的 UI 状态才放入 store；组件私有状态（如 ChatPanel 的 input、
 *   useChat messages、滚动 ref）保持为组件内部 state，避免无谓的跨组件渲染。
 * - 各组件通过 selector 订阅自身所需的切片，zustand 保证只有所选切片变化时才重渲染。
 * - SWR 数据（tasks / conversations / reports / preferences）由各组件自行 useSWR，
 *   SWR 按 key 去重，多组件共享同一缓存，无需经 store 中转。
 * - clearConversationNonce：SettingsDialog 等外部组件需要重置 ChatPanel 内部状态
 *   （useChat messages、滚动 ref 等）时，调用 clearConversationState() 递增 nonce，
 *   ChatPanel 通过 useEffect 监听 nonce 变化执行本地重置。
 */

interface HomeState {
  // --- 日期导航 ---
  /** 客户端本地时区的今天 YYYY-MM-DD，组件挂载时计算一次并固定 */
  today: string;
  /** 当前选中的日期 YYYY-MM-DD */
  selectedDate: string;
  /** 周历偏移量（0=本周，-1=上周，1=下周） */
  weekOffset: number;

  // --- 任务视图 ---
  viewMode: ViewMode;

  // --- 右侧 sidebar 当前激活的面板：null 时只显示任务面板 ---
  activePanel: "chat" | "export" | "report" | "task" | null;

  // --- 任务编辑面板 ---
  /** 正在编辑的任务（id + 所属日期）；null 时不显示任务编辑面板 */
  editingTask: { id: string; date: string } | null;

  // --- 报告 ---
  selectedReport: Report | null;

  // --- PDF 导出 ---
  /** 导出面板内部视图：「list」最近导出列表 / 「create」选择导出项目 */
  exportView: "list" | "create";

  // --- 设置弹窗 ---
  settingsOpen: boolean;

  // --- 对话重置信号 ---
  /** 递增计数器，ChatPanel 监听其变化执行本地清空 */
  clearConversationNonce: number;

  // --- 对话框 @ 引用插入信号 ---
  /** 拖拽任务到对话框时写入，ChatPanel 监听 nonce 把 @<任务名> 追加到输入框末尾 */
  chatMention: { text: string; nonce: number } | null;

  // --- 拖拽排序状态（dnd-kit sortable） ---
  /** 拖拽中的排序快照，key=group（象限 importance 或 "list"），value=任务ID数组。非拖拽时为 null */
  sortableOrder: Record<string, string[]> | null;
  /** 拖拽悬停在周历日期格上时的目标日期（用于 popover 预览）；非悬停日期格时为 null */
  dragOverDate: string | null;

  // --- Actions ---
  setSelectedDate: (d: string) => void;
  prevWeek: () => void;
  nextWeek: () => void;
  setViewMode: (v: ViewMode) => void;
  setActivePanel: (p: "chat" | "export" | "report" | "task" | null) => void;
  /** 打开任务编辑面板（编辑指定任务，sidebar 切换到任务面板） */
  openTaskEditor: (taskId: string, date: string) => void;
  /** 关闭任务编辑面板（清除选中任务；若当前在任务面板则收起） */
  closeTaskEditor: () => void;
  setSelectedReport: (r: Report | null) => void;
  setExportView: (v: "list" | "create") => void;
  setSettingsOpen: (open: boolean) => void;
  /** 重置对话相关的 store 状态并递增 nonce，通知 ChatPanel 清空本地状态 */
  clearConversationState: () => void;
  /** 向对话框输入框末尾插入一条 @ 引用（text 为任务名，ChatPanel 消费后清除） */
  insertChatMention: (text: string) => void;
  /** 清除 @ 引用插入信号 */
  clearChatMention: () => void;
  /** 设置拖拽排序快照（dragStart 写入，dragEnd 清空） */
  setSortableOrder: (o: Record<string, string[]> | null) => void;
  /** 设置拖拽悬停的目标日期（dragOver 写入，dragEnd 清空） */
  setDragOverDate: (d: string | null) => void;
}

const initialToday = date.formatDate(new Date());

/**
 * 计算某天相对今天所在周的周偏移量（0=本周，-1=上周，1=下周）。
 * 与 WeekCalendar 的 weekOffset 语义一致：周一起始。
 */
function weekOffsetOf(dateStr: string, today: string): number {
  const mondayOf = (ds: string) => {
    const d = date.parseDate(ds);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  // Math.round 吸收 DST 造成的 ±1h 误差
  return Math.round(
    (mondayOf(dateStr) - mondayOf(today)) / (7 * 24 * 3600 * 1000),
  );
}

export const useHomeStore = create<HomeState>((set) => ({
  today: initialToday,
  selectedDate: initialToday,
  weekOffset: 0,
  viewMode: "list",
  activePanel: null,
  selectedReport: null,
  exportView: "list",
  settingsOpen: false,
  clearConversationNonce: 0,
  editingTask: null,
  chatMention: null,
  sortableOrder: null,
  dragOverDate: null,

  // 选中日期时同步调整 weekOffset，保证日期落在周历显示范围内：
  // 从 diff 跳转、任务跳转按钮等入口可能选中非当前显示周的日期；
  // 日期本就落在显示周时计算结果等于当前偏移（无感行为不变）
  setSelectedDate: (d) =>
    set((s) => ({ selectedDate: d, weekOffset: weekOffsetOf(d, s.today) })),
  prevWeek: () => set((s) => ({ weekOffset: s.weekOffset - 1 })),
  nextWeek: () => set((s) => ({ weekOffset: s.weekOffset + 1 })),
  setViewMode: (v) => set({ viewMode: v }),
  setActivePanel: (p) => set({ activePanel: p }),
  openTaskEditor: (taskId, date) =>
    set({ editingTask: { id: taskId, date }, activePanel: "task" }),
  closeTaskEditor: () =>
    set((s) => ({
      editingTask: null,
      activePanel: s.activePanel === "task" ? null : s.activePanel,
    })),
  setSelectedReport: (r) => set({ selectedReport: r }),
  setExportView: (v) => set({ exportView: v }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  clearConversationState: () =>
    set((s) => ({ clearConversationNonce: s.clearConversationNonce + 1 })),
  insertChatMention: (text) =>
    set((s) => ({
      chatMention: { text, nonce: (s.chatMention?.nonce ?? 0) + 1 },
    })),
  clearChatMention: () => set({ chatMention: null }),
  setSortableOrder: (o) => set({ sortableOrder: o }),
  setDragOverDate: (d) => set({ dragOverDate: d }),
}));
