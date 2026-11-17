/**
 * @file sw.js
 * Service Worker PWA-приложения «ЭлектроЩит».
 * Реализует стратегию Cache-First для 100% офлайн-работы на GitHub Pages (относительные пути ./),
 * очистку устаревших кэшей при событии activate и бесшовное обновление по кнопке пользователя.
 */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `electro-shield-cache-${CACHE_VERSION}`;

/**
 * Полный перечень статических ресурсов приложения (все пути строго относительные для GitHub Pages)
 */
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/norms.js',
  './src/calc.js',
  './src/rules.js',
  './src/store.js',
  './src/phases.js',
  './src/autosize.js',
  './src/din.js',
  './src/export.js',
  './src/ui/line.js',
  './src/ui/shield.js',
];

/**
 * Установка Service Worker: предкэширование всех модулей и статики
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

/**
 * Активация новой версии Service Worker: удаление старых версий кэша
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((oldName) => caches.delete(oldName))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Перехват сетевых запросов по стратегии Cache-First
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Офлайн-режим: ресурс недоступен', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        });
    })
  );
});

/**
 * Обработка команды принудительной активации новой версии от UI ("Доступна новая версия, обновить")
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
