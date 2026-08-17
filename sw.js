const CACHE = 'roadcast-shell-v14';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=0.2.1',
  './nav-voice.css?v=0.4.0',
  './drive-experience.css?v=0.4.1',
  './traffic-routing.css?v=0.6.0',
  './app.js?v=0.2.1',
  './places-reroute-patch.js?v=0.3.0',
  './voice-runtime-patch.js?v=0.7.0',
  './nav-voice-patch.js?v=0.7.0',
  './drive-experience-patch.js?v=0.4.2',
  './map-interaction-patch.js?v=0.4.3',
  './rotation-fix-patch.js?v=0.4.4',
  './reroute-choice-patch.js?v=0.7.0',
  './weather-intelligence-patch.js?v=0.7.0',
  './traffic-routing-patch.js?v=0.7.0',
  './handsfree-assistant-patch.js?v=0.7.0',
  './family-drive-patch.js?v=0.7.0',
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
