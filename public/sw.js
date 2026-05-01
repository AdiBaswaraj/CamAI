// ScoutAI Service Worker — caches app shell + model assets for offline use.
const VERSION = 'scoutai-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.svg',
  '/icon-512.svg'
];

// Hosts whose responses are model assets we want to cache for offline use.
const MODEL_HOST_PATTERNS = [
  /tfhub\.dev/,
  /storage\.googleapis\.com/,
  /tessdata\.projectnaptha\.com/,
  /unpkg\.com/,
  /cdn\.jsdelivr\.net/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isModelAsset = MODEL_HOST_PATTERNS.some((re) => re.test(url.hostname));

  if (sameOrigin) {
    // Cache-first for app shell, network fallback.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('/index.html')))
    );
    return;
  }

  if (isModelAsset) {
    // Cache-first persistent model storage.
    event.respondWith(
      caches.open(VERSION + '-models').then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }))
      )
    );
  }
});
