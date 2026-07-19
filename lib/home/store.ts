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
/** 拖拽到对话框的任务参考（类似附件，但引用已有任务） */
export interface ChatTaskRef {
  id: string;
  taskId: string;
  title: string;
  date: string;
}

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
  activePanel: "chat" | "export" | "report" | null;

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

  // --- 对话框任务参考（拖拽到 chat-panel 的任务引用） ---
  chatTaskRefs: ChatTaskRef[];

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
  setActivePanel: (p: "chat" | "export" | "report" | null) => void;
  setSelectedReport: (r: Report | null) => void;
  setExportView: (v: "list" | "create") => void;
  setSettingsOpen: (open: boolean) => void;
  /** 重置对话相关的 store 状态并递增 nonce，通知 ChatPanel 清空本地状态 */
  clearConversationState: () => void;
  /** 添加一个任务参考到对话框（去重：同一 taskId 不重复添加） */
  addChatTaskRef: (ref: ChatTaskRef) => void;
  /** 移除指定 id 的任务参考 */
  removeChatTaskRef: (id: string) => void;
  /** 清空所有任务参考 */
  clearChatTaskRefs: () => void;
  /** 设置拖拽排序快照（dragStart 写入，dragEnd 清空） */
  setSortableOrder: (o: Record<string, string[]> | null) => void;
  /** 设置拖拽悬停的目标日期（dragOver 写入，dragEnd 清空） */
  setDragOverDate: (d: string | null) => void;
}

const initialToday = date.formatDate(new Date());

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
  chatTaskRefs: [],
  sortableOrder: null,
  dragOverDate: null,

  setSelectedDate: (d) => set({ selectedDate: d }),
  prevWeek: () => set((s) => ({ weekOffset: s.weekOffset - 1 })),
  nextWeek: () => set((s) => ({ weekOffset: s.weekOffset + 1 })),
  setViewMode: (v) => set({ viewMode: v }),
  setActivePanel: (p) => set({ activePanel: p }),
  setSelectedReport: (r) => set({ selectedReport: r }),
  setExportView: (v) => set({ exportView: v }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  clearConversationState: () =>
    set((s) => ({ clearConversationNonce: s.clearConversationNonce + 1 })),
  addChatTaskRef: (ref) =>
    set((s) =>
      s.chatTaskRefs.some((r) => r.taskId === ref.taskId)
        ? s
        : { chatTaskRefs: [...s.chatTaskRefs, ref] },
    ),
  removeChatTaskRef: (id) =>
    set((s) => ({ chatTaskRefs: s.chatTaskRefs.filter((r) => r.id !== id) })),
  clearChatTaskRefs: () => set({ chatTaskRefs: [] }),
  setSortableOrder: (o) => set({ sortableOrder: o }),
  setDragOverDate: (d) => set({ dragOverDate: d }),
}));
