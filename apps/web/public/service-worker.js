/*
 * Kill switch for the legacy Σ service worker, which was registered at this
 * path when the old app lived on this domain. Browsers re-fetch the registered
 * script on navigation; this version wipes the legacy caches, unregisters
 * itself and reloads open tabs so the current app (sw.js) can take over.
 * Workbox caches belonging to the current app are kept.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith('workbox-')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
