/**
 * Minimal service worker — its only real job is to make the browser's install criteria
 * ("Add to Home Screen" / the `beforeinstallprompt` event, see app.js) actually fire; Chrome
 * requires a registered service worker with a fetch handler for a page to be considered an
 * installable PWA (MASTER_SPEC.md §12a "Web Client Architecture").
 *
 * Caches the static shell (HTML/CSS/JS/icons) so the app shell still opens instantly offline
 * or on a flaky connection — but every `/api/*` and `/health` request always goes straight to
 * the network, never the cache. Serving a stale cached response for auth/orchestrator/skills
 * would silently show old data as if it were live, which is exactly the "fake success"
 * MASTER_SPEC.md Product Principle #4 forbids; a real network failure there should surface
 * as the honest error app.js already shows, not a stale cache hit.
 */
const CACHE_NAME = "zarvis-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/app.js", "/styles.css", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    return; // network-only — never intercept API calls, see the note above.
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
