"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bot,
  Info,
  Mic2,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  SelectGroup,
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type {
  AskMode,
  MigrationMode,
  ModelApiFormat,
  ModelConfig,
  PreferencesPatch,
  UserPreferences,
} from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { useHomeStore } from "@/lib/home/store";

type Section = "general" | "agent" | "danger" | "about";
type PreferencesResponse = { preferences: UserPreferences };

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
const THEMES = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "白天" },
  { value: "dark", label: "暗黑" },
];
const API_FORMATS = [
  { value: "openai", label: "OpenAI 格式（/v1/chat/completions）" },
  { value: "claude", label: "Claude 格式（/v1/messages）" },
];
const MIGRATION_MODES = [
  { value: "none", label: "不迁移" },
  { value: "important", label: "仅迁移重要任务" },
  { value: "all", label: "全部迁移" },
];
const ASK_MODES = [
  { value: "always", label: "总是" },
  { value: "minimal", label: "尽可能不" },
  { value: "never", label: "绝不" },
];

const APP_VERSION = "0.5.3";

export function SettingsDialog() {
  const router = useRouter();
  const open = useHomeStore((s) => s.settingsOpen);
  const setOpen = useHomeStore((s) => s.setSettingsOpen);
  const clearConversationState = useHomeStore((s) => s.clearConversationState);
  const [section, setSection] = useState<Section>("general");
  const { data, mutate } = useSWR<PreferencesResponse>(
    open ? "/api/preferences" : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );
  const prefs = data?.preferences;

  // 当前登录用户 id（用于在前端加解密模型 apiKey）
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";

  // 跟踪内部 Select / AlertDialog 是否打开。Select 默认 modal=true 会通过
  // react-remove-scroll 设置 body 子元素 pointer-events:none，导致 DialogContent
  // 透传点击到 overlay。这里在子层打开时阻止 Dialog 被外部交互关闭。
  const innerLayerOpenRef = useRef(false);
  const handleInnerLayerOpenChange = (open: boolean) => {
    innerLayerOpenRef.current = open;
  };

  /** 部分更新偏好并同步本地缓存。如有 models.configs，会先在前端加密 apiKey */
  const patch = async (p: PreferencesPatch) => {
    let finalPatch = p;
    if (p.models?.configs && userId) {
      // 加密每个 config 的 apiKey 后再上送
      const { encryptForUser, isEncrypted } = await import("@/lib/crypto");
      const encryptedConfigs = await Promise.all(
        p.models.configs.map(async (c) => ({
          ...c,
          apiKey: isEncrypted(c.apiKey)
            ? c.apiKey // 已是密文则不再重复加密
            : await encryptForUser(c.apiKey, userId),
        })),
      );
      finalPatch = { ...p, models: { ...p.models, configs: encryptedConfigs } };
    }
    const res = await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: finalPatch }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { preferences: UserPreferences };
    mutate({ preferences: json.preferences }, { revalidate: false });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <SidebarProvider
          className="min-h-[80vh]"
          style={
            {
              "--sidebar-width": "13rem",
            } as React.CSSProperties
          }
        >
          {/* 左侧导航：shadcn Sidebar（collapsible=none 在 Dialog 内静态展示） */}
          <Sidebar collapsible="none" className="border-r">
            <SidebarHeader className="px-5 py-4 font-semibold">
              设置
            </SidebarHeader>
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
          <main className="flex-1 overflow-y-auto px-6 py-4 mt-4 max-h-[80vh]">
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
              <AgentPanel
                prefs={prefs}
                onPatch={patch}
                userId={userId}
                onInnerLayerOpenChange={handleInnerLayerOpenChange}
              />
            ) : section === "danger" ? (
              <DangerPanel
                onConversationCleared={clearConversationState}
                onAccountDeleted={() => {
                  authClient.signOut().then(() => router.replace("/login"));
                }}
                onDone={() => setOpen(false)}
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
          items={THEMES}
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
            <SelectGroup>
              <SelectItem key="白天" value="light">
                白天
              </SelectItem>
              <SelectItem key="暗黑" value="dark">
                暗黑
              </SelectItem>
              <SelectItem key="跟随系统" value="system">
                跟随系统
              </SelectItem>
            </SelectGroup>
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
  userId,
  onInnerLayerOpenChange,
}: {
  prefs: UserPreferences;
  onPatch: (p: PreferencesPatch) => Promise<void>;
  userId: string;
  onInnerLayerOpenChange: (open: boolean) => void;
}) {
  const [roleDraft, setRoleDraft] = useState(prefs.agent.role);
  const [saving, setSaving] = useState(false);

  // 外部 preferences 变化时同步本地 draft
  useEffect(() => {
    setRoleDraft(prefs.agent.role);
  }, [prefs]);

  const dirty = roleDraft !== prefs.agent.role;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onPatch({
        agent: {
          role: roleDraft,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <ModelsSection prefs={prefs} onPatch={onPatch} userId={userId} />
      <Separator />
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">行为</h3>
        {/* 第一组：新一天问候 + 迁移方式 */}
        <div className="flex flex-col gap-4 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">新的一天问候</p>
              <p className="text-xs text-muted-foreground">
                打开应用时是否触发问候与过去未完成任务的迁移流程
              </p>
            </div>
            <Switch
              checked={prefs.agent.behavior?.greetingEnabled ?? true}
              onCheckedChange={(v) =>
                onPatch({
                  agent: {
                    behavior: { greetingEnabled: v === true },
                  },
                })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-sm">迁移方式</Label>
              <p className="text-xs text-muted-foreground">
                新的一天打开应用时，如何处理过去未完成的任务。
              </p>
            </div>
            <Select
              items={MIGRATION_MODES}
              value={prefs.agent.behavior?.migrationMode ?? "important"}
              onOpenChange={onInnerLayerOpenChange}
              onValueChange={(v) => {
                onPatch({
                  agent: {
                    behavior: {
                      migrationMode: v as MigrationMode,
                    },
                  },
                });
              }}
              disabled={!(prefs.agent.behavior?.greetingEnabled ?? true)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MIGRATION_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <div className="flex flex-col gap-1">
                        {m.label}
                        {m.value === "important" && (
                          <p className="text-xs text-muted-foreground">
                            跳过不重要且不紧急的琐事
                          </p>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* 第二组：提问模式 */}
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <Label className="text-sm">提问模式</Label>
              <p className="text-xs text-muted-foreground">
                控制 Agent 在信息模糊时是否主动向你提问。
              </p>
            </div>
            <Select
              items={ASK_MODES}
              value={prefs.agent.behavior?.askMode ?? "minimal"}
              onOpenChange={onInnerLayerOpenChange}
              onValueChange={(v) => {
                onPatch({
                  agent: {
                    behavior: { askMode: v as AskMode },
                  },
                });
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ASK_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <Separator />

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
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ---------------- 模型设置组 ---------------- */
function genId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ModelsSection({
  prefs,
  onPatch,
  userId,
}: {
  prefs: UserPreferences;
  onPatch: (p: PreferencesPatch) => Promise<void>;
  userId: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const configs = prefs.models?.configs ?? [];
  const defaultId = prefs.models?.defaultModelId;

  const setDefault = async (id: string) => {
    await onPatch({ models: { defaultModelId: id } });
  };

  const addConfig = async (cfg: ModelConfig | Omit<ModelConfig, "id">) => {
    const item: ModelConfig = { ...cfg, id: genId() } as ModelConfig;
    await onPatch({
      models: { configs: [...configs, item] },
    });
    setAddOpen(false);
  };

  const updateConfig = async (cfg: ModelConfig | Omit<ModelConfig, "id">) => {
    if (!("id" in cfg)) return;
    await onPatch({
      models: {
        configs: configs.map((c) => (c.id === cfg.id ? cfg : c)),
      },
    });
    setEditing(null);
  };

  const deleteConfig = async (id: string) => {
    const next = configs.filter((c) => c.id !== id);
    const patch: PreferencesPatch = {
      models: { configs: next },
    };
    if (defaultId === id) {
      patch.models!.defaultModelId = "";
    }
    await onPatch(patch);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">模型</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-4" /> 添加模型
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        选择默认对话模型与配置自定义模型。语音识别默认使用 MiMo-V2.5-ASR。
      </p>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">默认模型</Label>
        <Select
          value={defaultId || "__builtin__"}
          onValueChange={(v) =>
            setDefault(
              (v ?? "__builtin__") === "__builtin__" ? "" : (v as string),
            )
          }
          items={[
            {
              label: "deepseek-v4-flash",
              value: "__builtin__",
            },
            ...configs?.map((config) => ({
              label: config.name,
              value: config.id,
            })),
          ]}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem key="内置" value="__builtin__">
              内置 DeepSeek（deepseek-v4-flash）
            </SelectItem>
            {configs?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.multimodal ? " · 多模态" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">已配置模型</Label>
        {configs.length === 0 ? (
          <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
            暂无自定义模型，点击「添加模型」新建。
          </p>
        ) : (
          <div className="space-y-1.5">
            {configs.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate font-medium">
                    {c.name}
                    {c.multimodal && (
                      <Sparkles className="size-3 text-primary" />
                    )}
                  </div>
                  <div className="truncate text-muted-foreground">
                    {c.apiFormat === "openai" ? "OpenAI" : "Claude"} ·{" "}
                    {c.modelId} · {c.baseURL}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="编辑"
                  onClick={() => setEditing(c)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="删除"
                  onClick={() => deleteConfig(c.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {(addOpen || editing) && (
        <ModelEditDialog
          initial={editing}
          userId={userId}
          onClose={() => {
            setAddOpen(false);
            setEditing(null);
          }}
          onSubmit={editing ? updateConfig : addConfig}
        />
      )}
    </section>
  );
}

/* ---------------- 模型编辑 dialog ---------------- */
function ModelEditDialog({
  initial,
  userId,
  onClose,
  onSubmit,
}: {
  initial: ModelConfig | null;
  userId: string;
  onClose: () => void;
  onSubmit: (cfg: ModelConfig | Omit<ModelConfig, "id">) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [apiFormat, setApiFormat] = useState<ModelApiFormat>(
    initial?.apiFormat ?? "openai",
  );
  const [modelId, setModelId] = useState(initial?.modelId ?? "");
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? "");
  // initial?.apiKey 是 "enc:" 密文，初始留空，在 effect 中解密后回填
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDecrypting, setApiKeyDecrypting] = useState(!!initial?.apiKey);
  const [multimodal, setMultimodal] = useState(initial?.multimodal ?? false);
  const [saving, setSaving] = useState(false);

  // 编辑现有 config 时把 DB 中的密文 apiKey 解密回填到输入框
  useEffect(() => {
    if (!initial?.apiKey || !userId) {
      setApiKeyDecrypting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { decryptForUser, isEncrypted } = await import("@/lib/crypto");
      const plain = isEncrypted(initial.apiKey)
        ? await decryptForUser(initial.apiKey, userId)
        : initial.apiKey;
      if (!cancelled) {
        setApiKey(plain);
        setApiKeyDecrypting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial?.apiKey, userId]);

  const valid =
    name.trim() && modelId.trim() && baseURL.trim() && apiKey.trim();

  const handle = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (initial) {
        await onSubmit({
          ...initial,
          name: name.trim(),
          apiFormat,
          modelId: modelId.trim(),
          baseURL: baseURL.trim(),
          apiKey: apiKey.trim(),
          multimodal,
        });
      } else {
        await onSubmit({
          name: name.trim(),
          apiFormat,
          modelId: modelId.trim(),
          baseURL: baseURL.trim(),
          apiKey: apiKey.trim(),
          multimodal,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "编辑模型" : "添加自定义模型"}</DialogTitle>
          <DialogDescription>
            配置一个自定义对话模型，支持 OpenAI 兼容与 Claude（Anthropic）格式。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如「GPT-4o 多模态」"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">API 格式</Label>
            <Select
              value={apiFormat}
              onValueChange={(v) => setApiFormat(v as ModelApiFormat)}
              items={API_FORMATS}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key="OpenAI 格式" value="openai">
                  OpenAI 格式（/v1/chat/completions）
                </SelectItem>
                <SelectItem key="Claude 格式" value="claude">
                  Claude 格式（/v1/messages）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">模型 ID</Label>
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="如 gpt-4o、claude-3-5-sonnet-20241022"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">调用地址（Base URL）</Label>
            <Input
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="如 https://api.openai.com/v1"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyDecrypting ? "解密中…" : "sk-..."}
              disabled={apiKeyDecrypting}
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={multimodal}
              onCheckedChange={(v) => setMultimodal(!!v)}
            />
            <span>支持多模态（图片 / 音频 / 视频附件）</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handle} disabled={!valid || saving}>
            {saving ? "保存中…" : initial ? "保存" : "添加"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
          <AlertDialogTrigger
            render={<Button variant="destructive" disabled={busyConv} />}
          >
            删除全部对话
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除全部对话？</AlertDialogTitle>
              <AlertDialogDescription>
                此操作将永久清除所有历史对话，且无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                variant="outline"
                size="default"
                disabled={busyConv}
              >
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                variant="default"
                size="default"
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
          <AlertDialogTrigger
            render={<Button variant="destructive" disabled={busyAcc} />}
          >
            删除账号
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除账号？</AlertDialogTitle>
              <AlertDialogDescription>
                这将永久删除你的账号与所有关联数据（任务、对话、报告、任务段），
                且无法恢复。如确认，请点击下方按钮。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                variant="outline"
                size="default"
                disabled={busyAcc}
              >
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                variant="default"
                size="default"
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
        heyterx 是一款以「五育均衡」为核心的任务管理助手， 通过 AI
        帮助你按日期规划任务、生成周报月报与阶段报告，
        并以「心理绿芽指数」量化你的成长状态。
      </p>
    </div>
  );
}
