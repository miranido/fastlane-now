/* Fast Lane Now — service worker.
 *
 * Two jobs: receive push messages, and keep the shell openable offline.
 */

const SHELL_CACHE = "fastlane-shell-v1";
const SHELL_ASSETS = ["/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* Network-first for page loads so the app is never stale, with the last good
 * copy as the offline fallback. Everything else goes straight to the network. */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const locale = payload.locale === "en" ? "en" : "he";
  const title = payload.title || (locale === "en" ? "Fast Lane" : "נתיב עכשיו");

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      // Same tag means a new price replaces the previous notification rather
      // than stacking up; renotify still buzzes the phone.
      tag: payload.tag || "fastlane-price",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      lang: locale,
      dir: locale === "he" ? "rtl" : "ltr",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus an open tab if we already have one.
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
