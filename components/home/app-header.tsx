"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { useHomeStore } from "@/lib/home/store";
import { initials } from "@/lib/home/constants";

/** 顶部标题栏：Logo + 账号下拉菜单（设置 / 退出登录） */
export function AppHeader() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const setSettingsOpen = useHomeStore((s) => s.setSettingsOpen);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-2">
        <svg
          width="512"
          height="512"
          viewBox="0 0 512 512"
          fill="none"
          className="size-8"
        >
          <g>
            <path
              d="M150 0L362 0C444.854 0 512 67.146 512 150L512 362C512 444.854 444.854 512 362 512L150 512C67.146 512 0 444.854 0 362L0 150C0 67.146 67.146 0 150 0L150 0Z"
              fill="#F7F7F7"
              transform="matrix(1 0 0 -1 0 512)"
            />
            <g transform="translate(88 130)">
              <path
                d="M0 12C0 5.37258 5.37258 0 12 0C18.6274 0 24 5.37258 24 12C24 18.6274 18.6274 24 12 24C5.37258 24 0 18.6274 0 12Z"
                fill="#808080"
                fillRule="evenodd"
                fillOpacity="0.851"
                transform="translate(87.933 117.244)"
              />
              <path
                d="M0 12C0 5.37258 5.37259 0 12 0C18.6274 0 24 5.37258 24 12C24 18.6274 18.6274 24 12 24C5.37259 24 0 18.6274 0 12Z"
                fill="#808080"
                fillRule="evenodd"
                fillOpacity="0.851"
                transform="translate(224.718 84.676)"
              />
              <path
                d="M1.90799 116.197C1.90799 116.197 -14.9878 188.381 51.7766 172.505C118.541 156.628 281.917 -1.52588e-05 281.917 -1.52588e-05"
                fill="none"
                strokeWidth="16"
                stroke="#1CB02D"
                strokeLinecap="round"
                transform="matrix(0.906 0.423 -0.423 0.906 79.946 63.237)"
              />
              <path
                d="M33.9228 167.724C33.9228 167.724 -26.8388 85.8071 14.2782 52.425C55.3953 19.043 77.8907 79.7913 129.999 66.7642C182.108 53.737 173.966 3.38496e-06 222.818 0C271.67 0 299.76 26.8685 325.407 66.7642C351.054 106.66 325.407 159.583 325.407 159.583"
                fill="none"
                strokeWidth="16"
                stroke="#808080"
                strokeLinecap="round"
              />
              <path
                d="M0 9.77036C0 9.77036 14.4677 18.9881 31.5658 16.5455C48.6639 14.1029 68.3925 0 68.3925 0"
                fill="none"
                strokeWidth="16"
                stroke="#929292"
                strokeLinecap="round"
                transform="matrix(1 0 0 1 140.042 161.211)"
              />
            </g>
          </g>
        </svg>
        <span className="text-lg font-semibold tracking-tight">heyterx</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-2 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="账号菜单"
            />
          }
        >
          <Avatar>
            <AvatarImage
              src={user?.image ?? undefined}
              alt={user?.name ?? "用户"}
            />
            <AvatarFallback>
              {initials(user?.name ?? user?.email ?? "")}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{user?.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {user?.email}
                </span>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings className="size-4" />
              <span>设置</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
              <LogOut className="size-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
