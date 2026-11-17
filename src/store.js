/**
 * @file src/store.js
 * Единый источник правды (Store) на базе глубокого Proxy (PubSub/Observer)
 * и минимальной Promise-обёртки над браузерной IndexedDB с автосохранением (debounce 300ms).
 */

const DB_NAME = 'electro_shield_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_state';
const STATE_KEY = 'root_state';
const AUTOSAVE_DELAY_MS = 300;

/**
 * Начальное состояние приложения по умолчанию
 * @returns {object}
 */
export function createDefaultState() {
  return {
    activeTab: 'calculator', // 'calculator' | 'lines' | 'shield' | 'audit'
    settings: {
      projectName: 'Щит ЩУ-1',
      network: '3f',
      inputBreakerRating: 40,
      inputBreakerCurve: 'C',
      zSupply: 0.15,
      inputRcd: {
        enabled: true,
        type: 'A-S',
        selective: true,
        in: 63,
        leakage: 100,
      },
      psu24: {
        enabled: true,
        power: 120,
      },
      plcPower: 25,
      relaysPower: 15,
    },
    calculatorDraft: {
      name: 'Линия 1',
      power: 2.0,
      network: '1f',
      length: 25,
      material: 'Cu',
      installation: 'pipe',
      cosPhi: 0.95,
      curve: 'C',
    },
    lines: [],
  };
}

/**
 * Минимальная Promise-обёртка над IndexedDB (с in-memory резервом для сред без браузера, например Node.js)
 */
const memoryFallback = new Map();

function openDatabase() {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error || new Error('Ошибка открытия IndexedDB'));
    };
  });
}

export const db = Object.freeze({
  /**
   * Чтение значения по ключу из IndexedDB
   * @param {string} key
   * @returns {Promise<any>}
   */
  async get(key) {
    const database = await openDatabase();
    if (!database) {
      return memoryFallback.get(key);
    }

    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const objectStore = tx.objectStore(STORE_NAME);
      const req = objectStore.get(key);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(`Ошибка чтения ключа "${key}" из IndexedDB`));
      tx.oncomplete = () => database.close();
    });
  },

  /**
   * Запись значения по ключу в IndexedDB
   * @param {string} key
   * @param {any} val
   * @returns {Promise<void>}
   */
  async set(key, val) {
    const database = await openDatabase();
    if (!database) {
      memoryFallback.set(key, val);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const objectStore = tx.objectStore(STORE_NAME);
      const req = objectStore.put(val, key);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error(`Ошибка записи ключа "${key}" в IndexedDB`));
      tx.oncomplete = () => database.close();
    });
  },

  /**
   * Полная очистка хранилища IndexedDB
   * @returns {Promise<void>}
   */
  async clear() {
    const database = await openDatabase();
    if (!database) {
      memoryFallback.clear();
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const objectStore = tx.objectStore(STORE_NAME);
      const req = objectStore.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Ошибка очистки IndexedDB'));
      tx.oncomplete = () => database.close();
    });
  },
});

/**
 * Сериализация состояния в чистый JSON-объект (без Proxy) для записи в IndexedDB
 * @param {object} obj
 * @returns {object}
 */
function serializeState(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Создание реактивного Store с глубоким Proxy, PubSub и автосохранением в IndexedDB
 */
export function createStore(initialState = createDefaultState()) {
  const listeners = new Set();
  const proxyCache = new WeakMap();
  let rawState = serializeState(initialState);
  let debounceTimer = null;
  let isSilentHydrating = false;

  /**
   * Планирует отложенное сохранение стейта в IndexedDB через 300 мс
   */
  function scheduleAutosave() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      try {
        const snapshot = serializeState(rawState);
        await db.set(STATE_KEY, snapshot);
      } catch (err) {
        console.error('[Store] Ошибка автосохранения в IndexedDB:', err);
      }
    }, AUTOSAVE_DELAY_MS);
  }

  /**
   * Оповещает всех подписчиков и запускает debounce-автосохранение
   * @param {string} path - Путь изменённого свойства
   * @param {any} value - Новое значение
   */
  function notify(path, value) {
    if (isSilentHydrating) return;

    scheduleAutosave();

    for (const listener of listeners) {
      try {
        listener(stateProxy, { path, value });
      } catch (err) {
        console.error('[Store] Ошибка в подписчике:', err);
      }
    }
  }

  /**
   * Рекурсивная обёртка объектов и массивов в Proxy
   * @param {object} target
   * @param {string} basePath
   * @returns {Proxy}
   */
  function createDeepProxy(target, basePath = '') {
    if (typeof target !== 'object' || target === null) {
      return target;
    }

    if (proxyCache.has(target)) {
      return proxyCache.get(target);
    }

    const proxy = new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        if (typeof prop === 'symbol' || prop === 'toJSON') {
          return value;
        }
        if (typeof value === 'object' && value !== null) {
          const nextPath = basePath ? `${basePath}.${String(prop)}` : String(prop);
          return createDeepProxy(value, nextPath);
        }
        return value;
      },

      set(obj, prop, value, receiver) {
        const oldValue = obj[prop];
        const cleanValue =
          typeof value === 'object' && value !== null ? serializeState(value) : value;

        const changed = !Object.is(oldValue, cleanValue);
        const result = Reflect.set(obj, prop, cleanValue, receiver);

        if (changed) {
          // Для массивов не дублируем уведомление при техническом обновлении length,
          // если это часть push/splice, но пропускаем прямое изменение
          const fullPath = basePath ? `${basePath}.${String(prop)}` : String(prop);
          notify(fullPath, cleanValue);
        }

        return result;
      },

      deleteProperty(obj, prop) {
        const hadProp = Object.prototype.hasOwnProperty.call(obj, prop);
        const result = Reflect.deleteProperty(obj, prop);

        if (hadProp && result) {
          const fullPath = basePath ? `${basePath}.${String(prop)}` : String(prop);
          notify(fullPath, undefined);
        }

        return result;
      },
    });

    proxyCache.set(target, proxy);
    return proxy;
  }

  let stateProxy = createDeepProxy(rawState);

  /**
   * Подписка на изменения стейта
   * @param {(state: object, meta: { path: string, value: any }) => void} callback
   * @returns {() => void} Функция отписки
   */
  function subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Подписчик должен быть функцией');
    }
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  /**
   * Инициализация стейта: чтение сохранённых данных из IndexedDB
   * @returns {Promise<object>} Реактивный стейт
   */
  async function init() {
    try {
      const saved = await db.get(STATE_KEY);
      if (saved && typeof saved === 'object') {
        const defaults = createDefaultState();
        isSilentHydrating = true;
        Object.assign(rawState, {
          ...defaults,
          ...saved,
          settings: {
            ...defaults.settings,
            ...(saved.settings || {}),
            inputRcd: {
              ...defaults.settings.inputRcd,
              ...(saved.settings?.inputRcd || {}),
            },
            psu24: {
              ...defaults.settings.psu24,
              ...(saved.settings?.psu24 || {}),
            },
          },
          calculatorDraft: {
            ...defaults.calculatorDraft,
            ...(saved.calculatorDraft || {}),
          },
          lines: Array.isArray(saved.lines) ? saved.lines : [],
        });
        isSilentHydrating = false;

        for (const listener of listeners) {
          listener(stateProxy, { path: 'init', value: stateProxy });
        }
      }
    } catch (err) {
      isSilentHydrating = false;
      console.error('[Store] Ошибка чтения состояния из IndexedDB при init():', err);
    }

    return stateProxy;
  }

  /**
   * Сброс состояния к заводским настройкам и очистка IndexedDB
   * @returns {Promise<void>}
   */
  async function reset() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const defaults = createDefaultState();
    isSilentHydrating = true;
    for (const key of Object.keys(rawState)) {
      delete rawState[key];
    }
    Object.assign(rawState, defaults);
    isSilentHydrating = false;

    await db.clear();
    notify('reset', stateProxy);
  }

  return {
    get state() {
      return stateProxy;
    },
    subscribe,
    init,
    reset,
    db,
  };
}

/**
 * Глобальный экземпляр хранилища приложения «ЭлектроЩит»
 */
export const store = createStore();
export const state = store.state;
export default store;
