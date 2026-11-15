const name = "lai-offline-v3";
const shell = ["chat.html", "chat.css", "chat.js", "ai-worker.js", "menu.css", "Roboto-Variable.ttf", "runtime/katex.mjs"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(name).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("lai-offline-") && key !== name).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.headers.has("range")) return;
  const url = new URL(event.request.url);
  const scope = self.registration.scope;
  if (!url.href.startsWith(scope)) return;
  const path = url.href.slice(scope.length).split("?")[0];
  const offlinePath = path.startsWith("runtime/wllama");
  if (!offlinePath && path && !shell.includes(path) && path !== "index.html") return;
  event.respondWith((async () => {
    const cache = await caches.open(name);
    if (offlinePath) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }
    const key = path === "" || path === "index.html" ? "chat.html" : event.request;
    try {
      const response = await fetch(event.request);
      if (response.ok && key === event.request) {
        event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
      }
      return response;
    } catch (error) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw error;
    }
  })());
});
