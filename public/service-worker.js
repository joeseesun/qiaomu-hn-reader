const CACHE = "hn-qiaomu-v0.7.2";
const ASSETS = [
  "/",
  "/offline.html",
  "/styles.css?v=0.7.2",
  "/lucide-icons.js?v=0.7.2",
  "/app.js?v=0.7.2",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/assets/qiaomu_wechat_public_account_qr.jpg",
  "/assets/qiaomu_reward_qr.png"
];

function shouldCacheApi(url) {
  return url.pathname === "/api/insights"
    || url.pathname === "/api/status"
    || url.pathname === "/api/stories"
    || url.pathname === "/api/topics"
    || /^\/api\/stories\/[^/]+\/comments$/.test(url.pathname);
}

async function fetchAndCache(request, cacheKey = request) {
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    if (!shouldCacheApi(url)) return;
    event.respondWith(
      fetchAndCache(event.request).catch(async () => (
        await caches.match(event.request)
      ) || new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" }
      }))
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetchAndCache(event.request, "/")
        .catch(async () => (await caches.match("/")) || caches.match("/offline.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetchAndCache(event.request))
  );
});
