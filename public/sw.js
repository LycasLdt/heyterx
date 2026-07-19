const CACHE = "heyterx-shell-v1";
const APP_SHELL = ["/"];
const REMINDER_CHECK_INTERVAL = 60_000; // 每 60 秒检查一次到期提醒

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
      .then(() => startReminderLoop())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () => caches.match("/").then((r) => r || caches.match(req)) || Response.error()
      )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

// ---- 任务提醒：定期轮询到期提醒并推送浏览器通知 ----

let reminderTimer = null;

async function checkReminders() {
  try {
    const res = await fetch("/api/reminders/due", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    const due = data.due || [];
    for (const item of due) {
      await self.registration.showNotification("任务提醒", {
        body: item.title,
        tag: `task-${item.id}`,
        data: { url: "/" },
        renotify: true,
      });
    }
  } catch {
    /* 静默失败，下次轮询重试 */
  }
}

function startReminderLoop() {
  if (reminderTimer) clearInterval(reminderTimer);
  // 启动时立即检查一次，之后定时轮询
  checkReminders();
  reminderTimer = setInterval(checkReminders, REMINDER_CHECK_INTERVAL);
}

// SW 唤醒事件（页面消息、通知点击等）时重置轮询，保证 SW 存活期间持续检查
self.addEventListener("message", (event) => {
  if (event.data === "check-reminders") {
    startReminderLoop();
  }
});

// 点击通知后聚焦/打开应用
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
