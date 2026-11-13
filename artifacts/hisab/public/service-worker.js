const CACHE_NAME = "hisab-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const baseUrl = self.registration.scope;
      const manifestUrl = new URL("manifest.json", baseUrl);
      const cache = await caches.open(CACHE_NAME);
      const urls = [baseUrl, new URL("index.html", baseUrl).href];

      try {
        const response = await fetch(manifestUrl);
        if (response.ok) {
          const manifest = await response.json();
          for (const entry of Object.values(manifest)) {
            for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
              if (typeof file === "string") {
                urls.push(new URL(file, baseUrl).href);
              }
            }
          }
          urls.push(manifestUrl.href);
        }
      } catch {
        // The HTML shell remains useful if the optional build manifest is absent.
      }

      await cache.addAll([...new Set(urls)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("hisab-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const shell = await caches.match(new URL("index.html", self.registration.scope));
        if (shell) return shell;
        throw new Error("Offline page is not cached yet.");
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
