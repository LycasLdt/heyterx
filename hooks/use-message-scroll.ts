"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { HISTORY_LOAD_BATCH } from "@/lib/home/constants";

/**
 * chat-panel 消息滚动容器的全部滚动逻辑。
 *
 * 职责：
 * 1) 刚进入时默认显示当天信息：消息首次就绪时，折叠掉今天之前的所有历史消息
 *    （若当天没有消息，则只显示最近一批，避免一次性渲染全部历史）。
 * 2) 上滑释放更多（不是全部）信息：滚动到顶部附近时按 HISTORY_LOAD_BATCH
 *    批量释放更早的消息，并保持视口位置不跳动。
 * 3) 自动吸底：模型输出（消息流式更新、内容尺寸变化）时，若滚动位于最下方
 *    附近（autoStick），自动吸附到底部；用户上滑后不再强制吸底。
 *
 * 返回 scrollRef / contentRef（分别挂在滚动容器与内容元素上）、
 * hiddenCount（头部折叠的消息条数，调用方据此 slice 消息列表）、
 * handleScroll（滚动容器 onScroll）、reset（清空对话时复位全部滚动状态）。
 */
export function useMessageScroll({
  messages,
  today,
}: {
  /** 完整的原始消息列表（未做折叠切片） */
  messages: UIMessage[];
  /** 客户端今天 YYYY-MM-DD */
  today: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** 是否吸附到底部（用户滚动到最下方附近时为 true） */
  const autoStickRef = useRef(true);
  /** 上滑加载更多前的滚动位置快照，用于释放后还原视口 */
  const pendingScrollRestoreRef = useRef<{
    prevScrollHeight: number;
    prevScrollTop: number;
  } | null>(null);
  /** 防止一次滚动连续触发多批释放 */
  const loadingMoreRef = useRef(false);
  /** 头部折叠的消息条数 */
  const [hiddenCount, setHiddenCount] = useState(0);
  /** 首次进入的「默认显示当天」折叠是否已初始化 */
  const initializedRef = useRef(false);

  // --- 1) 刚进入时默认显示当天信息 ---
  // 消息首次从空变为非空（indexedDB / SWR 历史加载完成）时，
  // 折叠掉今天之前的所有消息。用 useLayoutEffect 保证在绘制前完成折叠，
  // 避免「先闪现全部历史再收起」。
  useLayoutEffect(() => {
    if (initializedRef.current || messages.length === 0) return;
    initializedRef.current = true;
    const firstTodayIndex = messages.findIndex((m) => {
      const meta = m.metadata as { createdAt?: string } | undefined;
      const dateStr = meta?.createdAt?.split("T")[0] ?? today;
      return dateStr >= today;
    });
    if (firstTodayIndex === -1) {
      // 当天还没有消息：只显示最近一批，其余折叠
      setHiddenCount(Math.max(0, messages.length - HISTORY_LOAD_BATCH));
    } else if (firstTodayIndex > 0) {
      setHiddenCount(firstTodayIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, today]);

  // --- 消息被删除变少时收敛折叠量，避免可见列表被切空 ---
  useEffect(() => {
    if (messages.length > 0 && hiddenCount >= messages.length) {
      setHiddenCount(Math.max(0, messages.length - 1));
    }
  }, [messages, hiddenCount]);

  // --- 3) 自动吸底：消息更新（含流式输出）时，若位于最下方则吸附 ---
  // hiddenCount 变化也触发：初始化折叠后需要吸底显示当天最新消息；
  // 上滑释放更多时 autoStickRef 已为 false，不会误吸底。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoStickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, hiddenCount]);

  // --- 3) 内容尺寸变化（如 markdown 图片加载、工具卡片展开）时跟随吸底 ---
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (autoStickRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // --- 2) 上滑释放更多后还原视口位置（内容变高多少，scrollTop 补多少） ---
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const restore = pendingScrollRestoreRef.current;
    if (!restore) return;
    pendingScrollRestoreRef.current = null;
    const added = el.scrollHeight - restore.prevScrollHeight;
    el.scrollTop = restore.prevScrollTop + added;
    loadingMoreRef.current = false;
  }, [hiddenCount]);

  // --- 滚动事件：维护吸底状态；接近顶部时按批释放更多历史消息 ---
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    autoStickRef.current = atBottom;
    if (el.scrollTop < 50 && hiddenCount > 0 && !loadingMoreRef.current) {
      loadingMoreRef.current = true;
      pendingScrollRestoreRef.current = {
        prevScrollHeight: el.scrollHeight,
        prevScrollTop: el.scrollTop,
      };
      // 每次只释放一批（不是全部），可多次上滑逐批加载
      setHiddenCount((c) => Math.max(0, c - HISTORY_LOAD_BATCH));
    }
  };

  /** 清空对话时复位全部滚动状态（下次加载历史时重新按当天初始化） */
  const reset = () => {
    setHiddenCount(0);
    autoStickRef.current = true;
    pendingScrollRestoreRef.current = null;
    loadingMoreRef.current = false;
    initializedRef.current = false;
  };

  return { scrollRef, contentRef, hiddenCount, handleScroll, reset };
}
