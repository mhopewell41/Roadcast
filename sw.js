const CACHE = 'roadcast-shell-v5';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=0.2.1',
  './nav-voice.css?v=0.4.0',
  './app.js?v=0.2.1',
  './places-reroute-patch.js?v=0.3.0',
  './nav-voice-patch.js?v=0.4.0',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event =>
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
);

self.addEventListener('activate', event =>
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  )
);

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
