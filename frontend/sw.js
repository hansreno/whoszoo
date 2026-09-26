// WhosWhoZoo service worker.
//
// This exists for exactly ONE reason: Chromium will not fire
// `beforeinstallprompt` — the event behind the in-app "Install" banner —
// unless the page has a registered service worker with a fetch handler.
// Without that, installing is only reachable through the browser's own
// ⋮ menu, which is what we're trying to get away from.
//
// ⚠ IT CACHES NOTHING, ON PURPOSE. The fetch handler below never calls
// respondWith(), so every request goes to the network exactly as it would
// with no service worker at all. That matters: WhosWhoZoo updates by
// hard-refresh (it's what update-notes.html tells people to do) and the
// frontend is versioned by hand with ?v=X.Y.Z cache busters. A caching
// service worker would sit in front of all of that and is the classic way
// to serve someone a stale app forever. Do not add caching here without
// solving the update path first.
//
// Offline support is deliberately absent too — memory lives in Cloudflare
// KV, chat goes to the worker and auth is server-side, so there is very
// little this app can honestly do without a network. Caching memory
// content locally would also cut against storing the session in
// sessionStorage specifically so it clears on tab close.
//
// ⚠ This file is served two completely different ways and must work in
// both: via the [assets] binding on a `wrangler deploy` instance, and
// inlined into the `_F` object for every web-wizard install (see
// landing/scripts/generate-worker-template.mjs — sw.js MUST be listed
// there, or wizard installs 404 and silently get no install prompt).
// worker-helpers.test.mjs pins that listing.
//
// Registration lives in frontend/app.js. Note that a registered service
// worker is sticky: removing this file is not enough to undo it, a future
// release would have to ship an explicit unregister step.

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Presence is the entire point — see the header comment. Calling
// respondWith() here would start intercepting traffic; not calling it
// leaves the browser's default networking completely untouched.
self.addEventListener("fetch", () => {});
