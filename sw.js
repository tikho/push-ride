const CACHE_NAME = 'push-ride-m10-v1';

const SHELL = [
  './',
  './index.html',
  './config.js',
  './game.js',
  './sw.js',
];

const OPTIONAL = [
  './assets/stand.png',
  './assets/jump.png',
  './assets/flip.png',
  './assets/board.png',
  'https://telegram.org/js/telegram-web-app.js',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(SHELL).then(function () {
          return Promise.all(
            OPTIONAL.map(function (url) {
              return cache.add(url).catch(function () {});
            })
          );
        });
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;

      return fetch(event.request)
        .then(function (response) {
          if (!response || !response.ok) return response;
          const url = new URL(event.request.url);
          const sameOrigin = url.origin === self.location.origin;
          const telegram = url.hostname === 'telegram.org';
          if (sameOrigin || telegram) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(function () {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return Response.error();
        });
    })
  );
});
