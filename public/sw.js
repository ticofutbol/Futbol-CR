// Service worker: permite abrir la app instalada sin conexión.
// Siempre intenta la red primero (para mostrar los datos del día) y solo si falla usa la última copia guardada.
const CACHE = 'futbol-cr-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Solo archivos de este sitio y las fuentes de Google; los escudos de ESPN los guarda el navegador.
  if (url.origin !== location.origin && !url.hostname.endsWith('fonts.googleapis.com') && !url.hostname.endsWith('fonts.gstatic.com')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // La página siempre se revalida con GitHub (que permite guardarla 10 min): así se ve la versión del día.
      const res = req.mode === 'navigate'
        ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        : await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      throw err;
    }
  })());
});
