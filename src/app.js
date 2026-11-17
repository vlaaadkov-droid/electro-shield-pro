/**
 * @file src/app.js
 * Главная точка входа PWA-приложения «ЭлектроЩит»:
 * - инициализирует модули вкладок UI;
 * - регистрирует Service Worker (./sw.js);
 * - отслеживает появление обновления SW и показывает интерактивную кнопку
 *   «Доступна новая версия, обновить».
 */

import { initLineUI } from './ui/line.js';
import { initShieldUI } from './ui/shield.js';

/**
 * Отображает плашку-кнопку обновления при обнаружении нового Service Worker в статусе waiting
 * @param {ServiceWorker} waitingWorker
 */
function showUpdateBanner(waitingWorker) {
  if (!waitingWorker || document.getElementById('pwa-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.className = 'pwa-update-banner';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary pwa-update-btn';
  btn.innerText = '🔄 Доступна новая версия, обновить';

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.innerText = 'Обновление...';
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });

  banner.appendChild(btn);
  document.body.appendChild(banner);
}

/**
 * Регистрация Service Worker и подписка на обновления версии
 */
export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');

    // Если новая версия уже ожидает активации
    if (registration.waiting) {
      showUpdateBanner(registration.waiting);
    }

    // Отслеживаем загрузку новой версии sw.js
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (
          newWorker.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          showUpdateBanner(newWorker);
        }
      });
    });

    // Перезагружаем страницу, как только новый Service Worker перехватил управление
    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isRefreshing) return;
      isRefreshing = true;
      window.location.reload();
    });
  } catch (err) {
    console.error('[PWA] Ошибка регистрации Service Worker:', err);
  }
}

/**
 * Запуск всего приложения
 */
export async function bootstrapApp() {
  await initLineUI();
  initShieldUI();
  await registerServiceWorker();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrapApp());
  } else {
    bootstrapApp();
  }
}
