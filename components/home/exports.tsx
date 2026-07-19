"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  Calendar,
  ChevronLeft,
  Download,
  FileText,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, fetcher } from "@/lib/utils";
import { useHomeStore } from "@/lib/home/store";
import type { TaskSegment, TasksResponse } from "@/lib/home/constants";

/**
 * 导出条目类型（与 /api/export?list=1 返回结构一致）。
 * 服务端从 Blob pathname 中解析，客户端直接消费。
 */
type ExportEntry = {
  pathname: string;
  filename: string;
  title: string;
  startDate: string;
  endDate: string;
  count: number;
  createdAt: string;
  size: number;
};

/** SWR key for the exports list（多组件共享缓存，删除/重命名/新增后 mutate 同一 key） */
const EXPORTS_KEY = "/api/export?list=1";

/** 触发浏览器下载（私有 Blob 经 /api/export 中转鉴权） */
function triggerDownload(pathname: string, filename: string) {
  const url = `/api/export?path=${encodeURIComponent(pathname)}&filename=${encodeURIComponent(filename)}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 单条导出卡片 + 右键 ContextMenu（下载 / 重命名 / 删除） */
function ExportCard({
  item,
  onRename,
  onDelete,
}: {
  item: ExportEntry;
  onRename: (item: ExportEntry) => void;
  onDelete: (item: ExportEntry) => void;
}) {
  const downloadUrl = `/api/export?path=${encodeURIComponent(item.pathname)}&filename=${encodeURIComponent(item.filename)}`;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <a
            href={downloadUrl}
            download={item.filename}
            className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted"
          />
        }
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.title}</div>
          <div className="text-xs text-muted-foreground">
            {item.startDate} ~ {item.endDate} · {item.count} 项任务
          </div>
        </div>
        <Download className="size-4 shrink-0 text-muted-foreground" />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          render={
            <a
              href={downloadUrl}
              download={item.filename}
              className="flex w-full items-center gap-2"
            />
          }
        >
          <Download className="size-4" />
          <span>下载</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRename(item)}>
          <Pencil className="size-4" />
          <span>重命名</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete(item)}>
          <Trash2 className="size-4" />
          <span>删除</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** 导出 Sheet 第 1 层：最近导出列表 + 「新增导出」按钮 */
function ExportListView({
  onAdd,
  onRename,
  onDelete,
}: {
  onAdd: () => void;
  onRename: (item: ExportEntry) => void;
  onDelete: (item: ExportEntry) => void;
}) {
  const { data, isLoading } = useSWR<{ exports: ExportEntry[] }>(
    EXPORTS_KEY,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const exports = data?.exports ?? [];

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Download className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">导出</h2>
      </div>
      <div className="px-4 pt-4">
        <Button onClick={onAdd} className="w-full" size="sm">
          <Plus className="size-4" />
          <span>新增导出</span>
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-4">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : exports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有导出记录。点击上方「新增导出」生成一份任务计划 PDF。
            </p>
          ) : (
            exports.map((item) => (
              <ExportCard
                key={item.pathname}
                item={item}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </>
  );
}

/** 导出 Sheet 第 2 层：选择导出项目（任务段 / 自定义日期范围） */
function ExportCreateView({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (item: ExportEntry) => void;
}) {
  const today = useHomeStore((s) => s.today);
  // 共享 useTasks 的 SWR 缓存，但不触发自动全量拉取（按需加载安全网）
  const { data: tasksData } = useSWR<TasksResponse>("/api/tasks", fetcher, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const segments = tasksData?.segments ?? [];

  const [mode, setMode] = useState<"segment" | "range">(
    segments.length > 0 ? "segment" : "range",
  );
  const [segmentId, setSegmentId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);
  const [submitting, setSubmitting] = useState(false);

  const selectedSegment = segments.find((s) => s.id === segmentId);
  const canSubmit =
    !submitting &&
    (mode === "segment"
      ? !!selectedSegment
      : !!startDate && !!endDate && startDate <= endDate);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const payload =
      mode === "segment" && selectedSegment
        ? {
            startDate: selectedSegment.startDate,
            endDate: selectedSegment.endDate,
            segmentId: selectedSegment.id,
          }
        : { startDate, endDate };
    setSubmitting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? `导出失败: ${res.status}`);
      }
      const data = (await res.json()) as { export: ExportEntry };
      // 自动下载 + 回到列表
      triggerDownload(data.export.pathname, data.export.filename);
      toast.success(`已导出 ${data.export.count} 项任务`);
      onCreated(data.export);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setSubmitting(false);
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
          选择导出项目
        </h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {/* 导出方式切换 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={segments.length === 0}
              onClick={() => setMode("segment")}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                mode === "segment"
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Layers className="size-4" />
                <span>任务段</span>
              </div>
              <span className="text-xs text-muted-foreground">
                导出某个任务段的全部任务
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("range")}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                mode === "range"
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Calendar className="size-4" />
                <span>日期范围</span>
              </div>
              <span className="text-xs text-muted-foreground">
                自定义起止日期导出
              </span>
            </button>
          </div>

          {/* 任务段选择 */}
          {mode === "segment" && (
            <div className="space-y-2">
              <Label>选择任务段</Label>
              {segments.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  还没有任务段。请先在任务面板中创建任务段，或切换到「日期范围」导出。
                </p>
              ) : (
                <Select
                  items={segments.map((seg: TaskSegment) => ({
                    value: seg.id,
                    label: `${seg.name}（${seg.startDate} ~ ${seg.endDate}）`,
                  }))}
                  value={segmentId}
                  onValueChange={(v) => setSegmentId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择任务段…" />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.map((seg: TaskSegment) => (
                      <SelectItem key={seg.id} value={seg.id}>
                        {seg.name}（{seg.startDate} ~ {seg.endDate}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedSegment && (
                <p className="text-xs text-muted-foreground">
                  将导出 {selectedSegment.startDate} ~ {selectedSegment.endDate}{" "}
                  范围内的任务，PDF 标题为「{selectedSegment.name}」。
                </p>
              )}
            </div>
          )}

          {/* 日期范围选择 */}
          {mode === "range" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="export-start-date">起始日期</Label>
                <Input
                  id="export-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="export-end-date">结束日期</Label>
                <Input
                  id="export-end-date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              {startDate && endDate && startDate <= endDate && (
                <p className="text-xs text-muted-foreground">
                  将导出 {startDate} ~ {endDate} 范围内的任务。
                </p>
              )}
              {startDate > endDate && (
                <p className="text-xs text-destructive">
                  起始日期不能晚于结束日期
                </p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="border-t p-4">
        <Button className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? "导出中…" : "导出"}
        </Button>
      </div>
    </>
  );
}

/** 重命名对话框 */
function RenameDialog({
  item,
  open,
  onOpenChange,
  onConfirm,
}: {
  item: ExportEntry | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (pathname: string, title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 每次 item 变化时重置输入框
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (item && item.pathname !== lastKey) {
    setTitle(item.title);
    setLastKey(item.pathname);
  }

  const handleConfirm = async () => {
    if (!item) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onConfirm(item.pathname, trimmed);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>重命名导出</AlertDialogTitle>
          <AlertDialogDescription>
            修改这份导出在列表中的显示名称。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="导出名称"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={submitting || !title.trim()}
          >
            {submitting ? "保存中…" : "保存"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 删除确认对话框 */
function DeleteDialog({
  item,
  open,
  onOpenChange,
  onConfirm,
}: {
  item: ExportEntry | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (pathname: string) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!item) return;
    setSubmitting(true);
    try {
      await onConfirm(item.pathname);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除导出</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{item?.title}」吗？该导出的 PDF
            文件也会一并删除，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "删除中…" : "删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 导出面板（内联）：从 store 读取视图状态，useSWR 拉取列表 */
export function ExportPanel() {
  const view = useHomeStore((s) => s.exportView);
  const setView = useHomeStore((s) => s.setExportView);
  const { mutate } = useSWRConfig();

  const [renaming, setRenaming] = useState<ExportEntry | null>(null);
  const [deleting, setDeleting] = useState<ExportEntry | null>(null);

  const handleRename = async (pathname: string, title: string) => {
    const res = await fetch(
      `/api/export?path=${encodeURIComponent(pathname)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    if (!res.ok) {
      toast.error(`重命名失败: ${res.status}`);
      return;
    }
    await mutate(EXPORTS_KEY);
    toast.success("已重命名");
  };

  const handleDelete = async (pathname: string) => {
    const res = await fetch(
      `/api/export?path=${encodeURIComponent(pathname)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error(`删除失败: ${res.status}`);
      return;
    }
    await mutate(EXPORTS_KEY);
    toast.success("已删除");
  };

  const handleCreated = async (_item: ExportEntry) => {
    // 刷新列表并回到主界面
    await mutate(EXPORTS_KEY);
    setView("list");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {view === "create" ? (
        <ExportCreateView
          onBack={() => setView("list")}
          onCreated={handleCreated}
        />
      ) : (
        <ExportListView
          onAdd={() => setView("create")}
          onRename={(item) => setRenaming(item)}
          onDelete={(item) => setDeleting(item)}
        />
      )}
      <RenameDialog
        item={renaming}
        open={!!renaming}
        onOpenChange={(v) => !v && setRenaming(null)}
        onConfirm={handleRename}
      />
      <DeleteDialog
        item={deleting}
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
