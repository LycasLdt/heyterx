"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useTheme } from "next-themes";
import {
  Bot,
  Info,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { PreferencesPatch, UserPreferences } from "@/lib/db/schema";

type Section = "general" | "agent" | "danger" | "about";

const SECTIONS: Array<{
  key: Section;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "general", label: "通用", icon: SettingsIcon },
  { key: "agent", label: "Agent", icon: Bot },
  { key: "danger", label: "危险", icon: TriangleAlert },
  { key: "about", label: "关于", icon: Info },
];

const APP_VERSION = "0.1.0";

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json()) as Promise<{ preferences: UserPreferences }>;

export function SettingsDialog({
  open,
  onOpenChange,
  onConversationCleared,
  onAccountDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConversationCleared: () => void;
  onAccountDeleted: () => void;
}) {
  const [section, setSection] = useState<Section>("general");
  const { data, mutate } = useSWR(open ? "/api/preferences" : null, fetcher, {
    revalidateOnFocus: false,
  });
  const prefs = data?.preferences;

  // 跟踪内部 Select / AlertDialog 是否打开。Select 默认 modal=true 会通过
  // react-remove-scroll 设置 body 子元素 pointer-events:none，导致 DialogContent
  // 透传点击到 overlay。这里在子层打开时阻止 Dialog 被外部交互关闭。
  const innerLayerOpenRef = useRef(false);
  const handleInnerLayerOpenChange = (open: boolean) => {
    innerLayerOpenRef.current = open;
  };

  /** 部分更新偏好并同步本地缓存 */
  const patch = async (p: PreferencesPatch) => {
    const res = await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: p }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { preferences: UserPreferences };
    mutate({ preferences: json.preferences }, { revalidate: false });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SidebarProvider
          className="min-h-[420px]"
          style={
            {
              "--sidebar-width": "13rem",
            } as React.CSSProperties
          }
        >
          {/* 左侧导航：shadcn Sidebar（collapsible=none 在 Dialog 内静态展示） */}
          <Sidebar collapsible="none" className="border-r">
            <SidebarHeader className="px-5 py-4 font-semibold">设置</SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SECTIONS.map((s) => {
                      const Icon = s.icon;
                      return (
                        <SidebarMenuItem key={s.key}>
                          <SidebarMenuButton
                            isActive={section === s.key}
                            onClick={() => setSection(s.key)}
                            className="gap-2"
                          >
                            <Icon className="size-4" />
                            <span>{s.label}</span>
                            {s.key === "danger" && (
                              <TriangleAlert className="ml-auto size-3 text-destructive" />
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          {/* 右侧面板 */}
          <main className="flex-1 overflow-y-auto px-6 py-4 mt-4">
            {!prefs ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                加载中…
              </p>
            ) : section === "general" ? (
              <GeneralPanel
                prefs={prefs}
                onPatch={patch}
                onInnerLayerOpenChange={handleInnerLayerOpenChange}
              />
            ) : section === "agent" ? (
              <AgentPanel prefs={prefs} onPatch={patch} />
            ) : section === "danger" ? (
              <DangerPanel
                onConversationCleared={onConversationCleared}
                onAccountDeleted={onAccountDeleted}
                onDone={() => onOpenChange(false)}
                onInnerLayerOpenChange={handleInnerLayerOpenChange}
              />
            ) : (
              <AboutPanel />
            )}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 通用面板 ---------------- */
function GeneralPanel({
  prefs,
  onPatch,
  onInnerLayerOpenChange,
}: {
  prefs: UserPreferences;
  onPatch: (p: PreferencesPatch) => Promise<void>;
  onInnerLayerOpenChange: (open: boolean) => void;
}) {
  const { setTheme } = useTheme();
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">主题</h3>
        <Select
          value={prefs.general.theme}
          onOpenChange={onInnerLayerOpenChange}
          onValueChange={(v) => {
            const theme = v as UserPreferences["general"]["theme"];
            setTheme(theme);
            onPatch({ general: { theme } });
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">白天</SelectItem>
            <SelectItem value="dark">暗黑</SelectItem>
            <SelectItem value="system">跟随系统</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          选择应用界面配色，跟随系统会根据系统设置自动切换。
        </p>
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">默认任务视图</h3>
        <RadioGroup
          value={prefs.general.defaultTaskView}
          onValueChange={(v) =>
            onPatch({
              general: {
                defaultTaskView:
                  v as UserPreferences["general"]["defaultTaskView"],
              },
            })
          }
          className="space-y-2"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="view-list" value="list" />
            <Label htmlFor="view-list">列表视图</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="view-quadrant" value="quadrant" />
            <Label htmlFor="view-quadrant">四象限视图</Label>
          </div>
        </RadioGroup>
        <p className="text-xs text-muted-foreground">
          打开应用时默认展示的任务排列方式。
        </p>
      </section>
    </div>
  );
}

/* ---------------- Agent 面板 ---------------- */
function AgentPanel({
  prefs,
  onPatch,
}: {
  prefs: UserPreferences;
  onPatch: (p: PreferencesPatch) => Promise<void>;
}) {
  const [roleDraft, setRoleDraft] = useState(prefs.agent.role);
  const [skillsDraft, setSkillsDraft] = useState<string[]>(prefs.agent.skills);
  const [saving, setSaving] = useState(false);

  // 外部 preferences 变化时同步本地 draft
  useEffect(() => {
    setRoleDraft(prefs.agent.role);
    setSkillsDraft(prefs.agent.skills);
  }, [prefs]);

  const dirty =
    roleDraft !== prefs.agent.role ||
    JSON.stringify(skillsDraft) !== JSON.stringify(prefs.agent.skills);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onPatch({
        agent: {
          role: roleDraft,
          skills: skillsDraft.filter((s) => s.trim()),
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">角色设置</h3>
        <p className="text-xs text-muted-foreground">
          给 Agent 配置一个角色设定（作为提示词注入对话）。留空则使用默认。
        </p>
        <Textarea
          value={roleDraft}
          onChange={(e) => setRoleDraft(e.target.value)}
          placeholder="例如：你是一位温柔耐心的学习伙伴，擅长用鼓励的语气陪伴我完成每日任务…"
          className="min-h-24"
        />
      </section>

      <Separator />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">技能设置</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSkillsDraft([...skillsDraft, ""])}
          >
            <Plus className="size-4" /> 添加技能
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          为 Agent 添加多项技能提示词，保存后下次对话生效。
        </p>
        <div className="space-y-2">
          {skillsDraft.length === 0 ? (
            <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
              暂无技能，点击「添加技能」新建。
            </p>
          ) : (
            skillsDraft.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <Textarea
                  value={s}
                  onChange={(e) =>
                    setSkillsDraft(
                      skillsDraft.map((x, j) => (j === i ? e.target.value : x))
                    )
                  }
                  placeholder={`技能 ${i + 1} 的提示词…`}
                  className="min-h-16"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setSkillsDraft(skillsDraft.filter((_, j) => j !== i))
                  }
                  aria-label="删除技能"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- 危险面板 ---------------- */
function DangerPanel({
  onConversationCleared,
  onAccountDeleted,
  onDone,
  onInnerLayerOpenChange,
}: {
  onConversationCleared: () => void;
  onAccountDeleted: () => void;
  onDone: () => void;
  onInnerLayerOpenChange: (open: boolean) => void;
}) {
  const [busyConv, setBusyConv] = useState(false);
  const [busyAcc, setBusyAcc] = useState(false);

  const clearConversations = async () => {
    setBusyConv(true);
    try {
      await fetch("/api/conversations", { method: "DELETE" });
      onConversationCleared();
      onDone();
    } finally {
      setBusyConv(false);
    }
  };

  const deleteAccount = async () => {
    setBusyAcc(true);
    try {
      await fetch("/api/account", { method: "DELETE" });
      onAccountDeleted();
    } finally {
      setBusyAcc(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">删除对话</h3>
        <p className="text-xs text-muted-foreground">
          清空所有历史对话记录，此操作不可恢复。
        </p>
        <AlertDialog onOpenChange={onInnerLayerOpenChange}>
          <Button variant="destructive" asChild disabled={busyConv}>
            <AlertDialogTrigger>删除全部对话</AlertDialogTrigger>
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除全部对话？</AlertDialogTitle>
              <AlertDialogDescription>
                此操作将永久清除所有历史对话，且无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busyConv}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={clearConversations}
                disabled={busyConv}
              >
                {busyConv ? "删除中…" : "确认删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">删除账号</h3>
        <p className="text-xs text-muted-foreground">
          永久删除你的账号及其下全部任务、对话、报告数据，不可恢复。
        </p>
        <AlertDialog onOpenChange={onInnerLayerOpenChange}>
          <Button variant="destructive" asChild disabled={busyAcc}>
            <AlertDialogTrigger>删除账号</AlertDialogTrigger>
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除账号？</AlertDialogTitle>
              <AlertDialogDescription>
                这将永久删除你的账号与所有关联数据（任务、对话、报告、任务段），
                且无法恢复。如确认，请点击下方按钮。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busyAcc}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={deleteAccount}
                disabled={busyAcc}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {busyAcc ? "删除中…" : "永久删除账号"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
}

/* ---------------- 关于面板 ---------------- */
function AboutPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">关于 heyterx</h3>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">版本</dt>
          <dd className="font-mono">v{APP_VERSION}</dd>
        </div>
      </dl>
      <Separator />
      <p className="text-xs leading-relaxed text-muted-foreground">
        heyterx 是一款以「五育均衡」为核心的任务管理助手，
        通过 AI 帮助你按日期规划任务、生成周报月报与阶段报告，
        并以「心理绿芽指数」量化你的成长状态。
      </p>
    </div>
  );
}
