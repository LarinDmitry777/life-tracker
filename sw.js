const scope = self.registration.scope;
const prefix = `life-tracker:${scope}:`;
// Publish changes to the shell and its modules under a new release path.
const release = '9';
const cacheName = `${prefix}${release}`;
const indexUrl = new URL('./index.html', scope).href;
const releasePath = `./release-${release}/`;
const paths = [
  './app.js',
  ...['styles.css', 'app.js', 'schedule.js', 'backup.js', 'reorder.js'].map((path) => releasePath + path),
  './manifest.webmanifest', './assets/miami-dusk.webp', './assets/icon-180.png',
  './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png',
];
const appFiles = new Set(paths.map((path) => new URL(path, scope).href));
const legacyAssets = new Set(['styles.css', 'schedule.js', 'backup.js', 'reorder.js']);

async function fetchShell() {
  const response = await fetch(indexUrl, { cache: 'reload' });
  const marker = `<meta name="life-tracker-release" content="${release}">`;
  if (!response.ok || !(await response.clone().text()).includes(marker)) {
    throw new Error(`Life Tracker: сервер ещё не отдаёт оболочку версии ${release}.`);
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await fetchShell();
    const cache = await caches.open(cacheName);
    const requests = [...appFiles].map((url) => new Request(url, { cache: 'reload' }));
    await cache.addAll(requests);
    await cache.put(indexUrl, shell);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  // A page can still be loading modules from its previous release after claim().
  event.waitUntil(self.clients.claim());
});

async function matchLegacyAsset(url) {
  const names = (await caches.keys())
    .filter((name) => name.startsWith(prefix) && /^[1-7]$/.test(name.slice(prefix.length)))
    .sort().reverse();
  for (const name of names) {
    const entry = await caches.match(url, { cacheName: name });
    if (entry) return entry;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  url.hash = '';
  if (!url.href.startsWith(scope)) return;

  const isShell = url.href === scope || url.href === indexUrl;
  const isCurrentFile = appFiles.has(url.href);
  const relative = url.href.slice(scope.length);
  const previousRelease = /^release-([1-9]\d*)\//.exec(relative)?.[1];
  const isPreviousFile = previousRelease && Number(previousRelease) < Number(release);
  const isLegacyAsset = legacyAssets.has(relative);
  if (!isShell && !isCurrentFile && !isPreviousFile && !isLegacyAsset) return;

  event.respondWith((async () => {
    // Only the current cache may answer navigation and the unversioned recovery script.
    if (isShell) return (await caches.match(indexUrl, { cacheName })) ?? fetchShell();
    if (isCurrentFile) return (await caches.match(url.href, { cacheName })) ?? fetch(event.request);

    const entry = isPreviousFile
      ? await caches.match(url.href, { cacheName: `${prefix}${previousRelease}` })
      : await matchLegacyAsset(url.href);
    return entry ?? fetch(event.request);
  })());
});
