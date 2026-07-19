"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker，使应用具备 PWA 可安装性、基础离线 app shell 与
 * 任务提醒后台通知能力。仅在生产环境注册，避免开发环境下与 Turbopack HMR
 * 缓存冲突。测试 PWA：`pnpm build && pnpm start`（localhost 视为安全上下文）。
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          // 请求通知权限（用于任务提醒）；用户拒绝则静默，不阻塞使用
          if (
            "Notification" in window &&
            Notification.permission === "default"
          ) {
            Notification.requestPermission().catch(() => {});
          }
          // 通知 SW 立即检查一次到期提醒
          reg.active?.postMessage("check-reminders");
        })
        .catch(() => {
          /* 注册失败静默处理，不影响正常使用 */
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
