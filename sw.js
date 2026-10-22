// オフライン対応。アプリ本体はキャッシュ優先、曲データはネットワーク優先。
// __BUILD__ はデプロイ時にコミットIDへ置き換わる（scripts/build-site.mjs）。
const VERSION = '__BUILD__';
const SHELL_CACHE = `shell-${VERSION}`;
const SONG_CACHE = 'songs';
const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/app.js',
  'assets/parser.js',
  'assets/chords.js',
  'assets/style.css',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'data/guitar-chords.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  if (path === 'songs.json' || path.startsWith('songs/')) {
    event.respondWith(networkFirst(req));
  } else if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
  } else {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(SONG_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
