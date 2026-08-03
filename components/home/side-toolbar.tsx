"use client";

import { Bot, Download, FileText, ListTodo, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHomeStore } from "@/lib/home/store";

type PanelId = "task" | "chat" | "export" | "report";

const ITEMS: { id: PanelId; icon: typeof Bot; label: string }[] = [
  { id: "task", icon: ListTodo, label: "任务" },
  { id: "chat", icon: Bot, label: "Agent" },
  { id: "export", icon: Download, label: "导出" },
  { id: "report", icon: FileText, label: "报告" },
];

/**
 * 右侧 icon 导航栏：桌面端竖直排列在右侧，手机端水平排列在最下方。
 * 点击图标切换对应面板；再次点击当前激活项则收起（回到仅任务面板）。
 *
 * - 「任务」入口固定在最上方，仅在选中了要编辑的任务时显示
 * - 手机端：图标水平居中显示在底部 bar
 * - 桌面端：图标竖直排列在顶部，「设置」项固定在最下端
 *
 * 使用 shadcn Sidebar（collapsible="none"）实现，通过响应式 class 覆盖
 * 默认的竖直布局，在手机端切换为水平排列。
 */
export function SideToolbar() {
  const activePanel = useHomeStore((s) => s.activePanel);
  const setActivePanel = useHomeStore((s) => s.setActivePanel);
  const editingTask = useHomeStore((s) => s.editingTask);
  const setSettingsOpen = useHomeStore((s) => s.setSettingsOpen);

  const renderItem = (item: (typeof ITEMS)[number]) => {
    // 任务编辑面板入口：没有选中的任务时不显示
    if (item.id === "task" && !editingTask) return null;
    const isActive = activePanel === item.id;
    return (
      <SidebarMenuItem key={item.id}>
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuButton
                isActive={isActive}
                onClick={() => setActivePanel(isActive ? null : item.id)}
                className="justify-center"
              />
            }
          >
            <item.icon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar
      collapsible="none"
      className="h-auto w-full shrink-0 flex-row border-t md:h-full md:w-(--sidebar-width) md:flex-col md:border-l md:border-t-0"
    >
      <SidebarContent className="flex-row justify-center md:flex-col">
        <SidebarGroup className="flex-row justify-center md:flex-col">
          <SidebarGroupContent>
            <SidebarMenu className="flex-row justify-center md:flex-col">
              {ITEMS.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* 设置：仅桌面端，固定在最下端 */}
        <SidebarGroup className="hidden md:flex md:mt-auto">
          <SidebarGroupContent>
            <SidebarMenu className="flex-col">
              <SidebarMenuItem>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        onClick={() => setSettingsOpen(true)}
                        className="justify-center"
                      />
                    }
                  >
                    <Settings className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="left" sideOffset={8}>
                    设置
                  </TooltipContent>
                </Tooltip>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
