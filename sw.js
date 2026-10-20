// Sport local — service worker : l'appli s'ouvre même sans réseau.
// Réseau d'abord pour les fichiers du site (toujours la dernière version),
// copie locale en secours. Les données (Supabase, cartes, météo) ne sont pas mises en cache ici.
const CACHE = 'sport-local-v6';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './css/style.css',
  './js/00-base.js',
  './js/01-position.js',
  './js/02-lieux.js',
  './js/03-carte.js',
  './js/04-assistant.js',
  './js/05-fiche-lieu.js',
  './js/06-compte.js',
  './js/07-sessions.js',
  './js/08-amis-messagerie.js',
  './js/09-profil.js',
  './js/10-parcours.js',
  './js/11-navigation.js',
  './js/12-lieux-extras.js',
  './js/13-activites-groupes-notifications.js',
  './js/14-demarrage.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
