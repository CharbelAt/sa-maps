// Service worker: app shell cache-first (so the app opens instantly / offline),
// map glyphs + fonts stale-while-revalidate. Tiles, routing and search stay network-only.

const VERSION = 'samaps-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'config.js', 'css/sa.css',
  'vendor/maplibre-gl/maplibre-gl.js', 'vendor/maplibre-gl/maplibre-gl.css',
  'js/main.js', 'js/settings.js', 'js/mapstyle.js', 'js/radar.js', 'js/hud.js', 'js/nav.js',
  'js/instructions.js', 'js/geo.js', 'js/location.js', 'js/sim.js', 'js/crew.js', 'js/lines.js',
  'js/voice.js', 'js/sfx.js', 'js/util.js', 'js/clips.js',
  'assets/app/icon-192.png', 'assets/app/favicon.svg',
  'assets/avatars/cj.svg', 'assets/avatars/smoke.svg',
  'assets/blips/player.svg', 'assets/blips/destination.svg', 'assets/blips/north.svg',
  'assets/blips/home.svg', 'assets/blips/work.svg', 'assets/blips/favorite.svg',
  'assets/blips/food.svg', 'assets/blips/result.svg', 'assets/blips/pin.svg',
  'assets/hud/star.svg', 'assets/hud/star-empty.svg', 'assets/hud/fist.svg',
  ...['depart', 'arrive', 'straight', 'turn-left', 'turn-right', 'slight-left', 'slight-right',
    'sharp-left', 'sharp-right', 'uturn-left', 'uturn-right', 'merge-left', 'merge-right',
    'ramp-left', 'ramp-right', 'fork-left', 'fork-right', 'keep-left', 'keep-right',
    'roundabout-cw', 'roundabout-ccw'].map((k) => `assets/maneuver/${k}.svg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'samaps-runtime').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Shell: network first for HTML (pick up deploys), cache first for the rest.
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('index.html', copy));
        return res;
      }).catch(() => caches.match('index.html')));
      return;
    }
    // Stale-while-revalidate: instant from cache, refreshed in the background so a
    // new deploy shows up on the next launch.
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }));
    return;
  }

  const runtime = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
    || (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/fonts/'));
  if (runtime) {
    e.respondWith(caches.open('samaps-runtime').then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
