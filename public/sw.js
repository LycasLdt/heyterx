// heyterx Service Worker
// 保守策略：仅缓存 app shell 与同源静态资源，绕开 /api 与 /_next，
// 以保证鉴权、流式响应与 Turbopack HMR 不受影响。
const CACHE = "heyterx-shell-v1";
const APP_SHELL = ["/"];

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
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 不拦截 API 与 Next 内部资源，避免影响鉴权与 HMR
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) {
    return;
  }

  // 导航请求：网络优先，离线时回退到缓存的 app shell
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () => caches.match("/").then((r) => r || caches.match(req)) || Response.error()
      )
    );
    return;
  }

  // 其他同源静态资源：stale-while-revalidate
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
