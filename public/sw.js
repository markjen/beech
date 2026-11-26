// Offline support for the web build.
// - page navigations: network first, fall back to the cached shell when offline
// - everything else from this origin (hashed JS/CSS, icons): cache first
// Vite gives built assets content hashes, so a new deploy just adds new files;
// old ones are pruned when this file's CACHE version changes.
// /api/* always goes to the network.
// - push: inbox notifications (docs/INBOX_NOTIFICATIONS.md); a tap opens the inbox
const CACHE = 'beech-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // the API is live, per-user data: never serve it from a cache
  if (url.pathname.includes('/api/')) return;
  // which build is newest: always ask the network (src/platform/version.ts)
  if (url.pathname.endsWith('/version.json')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Web push: the server sends { title, body, tag } (server/src/push.ts).
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    /* not ours */
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'beech', {
      body: msg.body || 'Something new in your inbox',
      tag: msg.tag || 'beech-inbox',
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL('./?inbox=1', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          w.postMessage({ type: 'open-inbox' });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
