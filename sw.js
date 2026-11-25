const scope = self.registration.scope;
const prefix = `life-tracker:${scope}:`;
const cacheName = `${prefix}3`;
const paths = [
  './', './index.html', './styles.css', './app.js', './schedule.js',
  './manifest.webmanifest', './assets/miami-dusk.webp', './assets/icon-180.png',
  './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png',
];
const appFiles = new Set(paths.map((path) => new URL(path, scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(paths)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName).map(
      (name) => caches.delete(name),
    ));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  url.hash = '';
  if (!appFiles.has(url.href)) return;

  event.respondWith((async () => {
    // Keep the shell and its dependencies on the same cached version.
    const cache = await caches.open(cacheName);
    return (await cache.match(url.href)) ?? fetch(event.request);
  })());
});
