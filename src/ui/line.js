/**
 * @file src/ui/line.js
 * Модуль UI Вкладки 1 (расчёт одиночной линии) и переключения нижней навигации.
 * Никогда не пересоздаёт поля ввода через innerHTML — обновляет только innerText результатов,
 * гарантируя сохранение фокуса мобильной клавиатуры.
 */

import { store } from '../store.js';
import { calculateLine } from '../calc.js';
import { audit } from '../rules.js';

/**
 * Предустановки типов нагрузки (сеть + типовой cosφ)
 */
const LOAD_TYPE_PRESETS = Object.freeze({
  '1f_active': { network: '1f', cosPhi: 0.98, powerUnitLabel: 'Мощность, кВт' },
  '1f_motor':  { network: '1f', cosPhi: 0.80, powerUnitLabel: 'Мощность, кВт' },
  '3f_motor':  { network: '3f', cosPhi: 0.85, powerUnitLabel: 'Мощность, кВт' },
  '3f_active': { network: '3f', cosPhi: 0.99, powerUnitLabel: 'Мощность, кВт' },
  'vfd_1f':    { network: 'vfd', cosPhi: 0.95, powerUnitLabel: 'Мощность двиг., кВт' },
  '24dc':      { network: '24dc', cosPhi: 1.0, powerUnitLabel: 'Мощность, Вт' },
});

/**
 * Кэширование ссылок на статические DOM-узлы
 */
function getDomRefs() {
  return {
    // Навигация и секции вкладок
    navButtons: Array.from(document.querySelectorAll('.nav-btn[data-tab]')),
    tabs: {
      calculator: document.getElementById('tab-calculator'),
      shield: document.getElementById('tab-shield'),
      audit: document.getElementById('tab-audit'),
    },

    // Поля ввода (Вкладка 1)
    loadTypeSelect: document.getElementById('input-load-type'),
    powerLabel: document.getElementById('label-power'),
    powerInput: document.getElementById('input-power'),
    lengthInput: document.getElementById('input-length'),
    materialSelect: document.getElementById('input-material'),
    installationSelect: document.getElementById('input-installation'),
    cosPhiInput: document.getElementById('input-cosphi'),
    curveSelect: document.getElementById('input-curve'),

    // Поля вывода результата (обновляются только через innerText и classList)
    headerStatusPill: document.getElementById('line-status-pill'),
    resultCard: document.getElementById('result-card'),
    verdictBadge: document.getElementById('res-verdict-badge'),
    resCurrent: document.getElementById('res-current'),
    resBreaker: document.getElementById('res-breaker'),
    resSection: document.getElementById('res-section'),
    resAllowable: document.getElementById('res-allowable'),
    resVdropPercent: document.getElementById('res-vdrop-percent'),
    resVdropVolts: document.getElementById('res-vdrop-volts'),
    resIkz: document.getElementById('res-ikz'),
    resSummaryText: document.getElementById('res-summary-text'),
  };
}

/**
 * Применение класса светофора ('status-ok' | 'status-warning' | 'status-error') к элементу
 * @param {HTMLElement} el
 * @param {'ok' | 'warning' | 'error'} level
 */
function applyStatusClass(el, level) {
  if (!el) return;
  el.classList.remove('status-ok', 'status-warning', 'status-error');
  el.classList.add(`status-${level}`);
}

/**
 * Перерисовка активной вкладки нижней навигации
 */
function renderActiveTab(refs, activeTab) {
  for (const btn of refs.navButtons) {
    const isCurrent = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', isCurrent);
  }
  for (const [tabKey, sectionEl] of Object.entries(refs.tabs)) {
    if (!sectionEl) continue;
    sectionEl.hidden = tabKey !== activeTab;
  }
}

/**
 * Мгновенный пересчёт линии и обновление текстовых полей карточки результата
 */
export function renderLineResult(refs, state) {
  const draft = state.calculatorDraft;
  const zSupply = state.settings?.zSupply ?? 0.15;

  const power = Number(draft.power);
  const length = Number(draft.length);
  const cosPhi = Number(draft.cosPhi);
  const material = draft.material || 'Cu';
  const installation = draft.installation || 'pipe';
  const network = draft.network || '1f';
  const curve = draft.curve || 'C';

  // Обновляем подпись единицы мощности (кВт или Вт для 24В DC)
  if (refs.powerLabel) {
    refs.powerLabel.innerText =
      network === '24dc' ? 'Мощность, Вт' : network === 'vfd' ? 'Мощность двиг., кВт' : 'Мощность, кВт';
  }

  if (refs.cosPhiInput) {
    refs.cosPhiInput.disabled = network === '24dc' || network === 'vfd';
  }

  if (!(power > 0) || !(length >= 0) || !(cosPhi > 0 && cosPhi <= 1)) {
    refs.resCurrent.innerText = '—';
    refs.resBreaker.innerText = '—';
    refs.resSection.innerText = '—';
    refs.resAllowable.innerText = '—';
    refs.resVdropPercent.innerText = '—';
    refs.resVdropVolts.innerText = '—';
    refs.resIkz.innerText = '—';
    refs.resSummaryText.innerText = 'Введите корректные положительные значения мощности, длины и cosφ.';
    refs.verdictBadge.innerText = 'ВНИМАНИЕ';
    refs.headerStatusPill.innerText = 'ВНИМАНИЕ';
    applyStatusClass(refs.resultCard, 'warning');
    applyStatusClass(refs.verdictBadge, 'warning');
    applyStatusClass(refs.headerStatusPill, 'warning');
    return;
  }

  try {
    const calcResult = calculateLine({
      power,
      network,
      length,
      material,
      installation,
      cosPhi,
      zSupply,
    });

    // Прогоняем рассчитанную линию через движок правил (Этап 2)
    const verdicts = audit({
      zSupply,
      lines: [
        {
          id: 'QF1',
          name: draft.name || 'Линия',
          network,
          material,
          installation,
          length,
          curve,
          current: calcResult.current,
          breakerRating: calcResult.breakerRating,
          section: calcResult.section,
          allowableCurrent: calcResult.allowableCurrent,
          voltageDropPercent: calcResult.voltageDropPercent,
          shortCircuitCurrent: calcResult.shortCircuitCurrent,
        },
      ],
    });

    // Точечное обновление только innerText у полей с результатами
    refs.resCurrent.innerText = calcResult.current.toFixed(2);
    refs.resBreaker.innerText = `${curve}${calcResult.breakerRating}`;
    refs.resSection.innerText = `${calcResult.section} / ${calcResult.peSection}`;
    refs.resAllowable.innerText = String(calcResult.allowableCurrent);
    refs.resVdropPercent.innerText = calcResult.voltageDropPercent.toFixed(2);
    refs.resVdropVolts.innerText = calcResult.voltageDropVolts.toFixed(2);
    refs.resIkz.innerText =
      network === '24dc' ? '—' : calcResult.shortCircuitCurrent.toFixed(1);

    const hasError = verdicts.some((v) => v.severity === 'error');
    const hasWarning = verdicts.some((v) => v.severity === 'warning');

    let statusLevel = 'ok';
    let statusLabel = 'НОРМА';

    if (hasError) {
      statusLevel = 'error';
      statusLabel = 'ОШИБКА';
    } else if (hasWarning) {
      statusLevel = 'warning';
      statusLabel = 'ВНИМАНИЕ';
    }

    refs.verdictBadge.innerText = statusLabel;
    refs.headerStatusPill.innerText = statusLabel;

    applyStatusClass(refs.resultCard, statusLevel);
    applyStatusClass(refs.verdictBadge, statusLevel);
    applyStatusClass(refs.headerStatusPill, statusLevel);

    if (verdicts.length === 0) {
      refs.resSummaryText.innerText =
        'Все параметры линии соответствуют требованиям ПУЭ (длительный ток, ΔU и отключение при КЗ).';
    } else {
      refs.resSummaryText.innerText = verdicts.map((v) => `[${v.id}] ${v.message}`).join('\n');
    }
  } catch (err) {
    refs.resCurrent.innerText = '—';
    refs.resBreaker.innerText = '—';
    refs.resSection.innerText = '—';
    refs.resAllowable.innerText = '—';
    refs.resVdropPercent.innerText = '—';
    refs.resVdropVolts.innerText = '—';
    refs.resIkz.innerText = '—';
    refs.resSummaryText.innerText = err.message || 'Ошибка расчёта параметров линии.';
    refs.verdictBadge.innerText = 'ОШИБКА';
    refs.headerStatusPill.innerText = 'ОШИБКА';
    applyStatusClass(refs.resultCard, 'error');
    applyStatusClass(refs.verdictBadge, 'error');
    applyStatusClass(refs.headerStatusPill, 'error');
  }
}

/**
 * Синхронизация значений статических инпутов из стейта при первом запуске / init() из IndexedDB
 * (Не затрагивает элемент, находящийся в фокусе)
 */
function syncInputsFromState(refs, state) {
  const draft = state.calculatorDraft;
  const activeEl = document.activeElement;

  if (refs.powerInput && activeEl !== refs.powerInput) {
    refs.powerInput.value = String(draft.power ?? 2.0);
  }
  if (refs.lengthInput && activeEl !== refs.lengthInput) {
    refs.lengthInput.value = String(draft.length ?? 25);
  }
  if (refs.materialSelect && activeEl !== refs.materialSelect) {
    refs.materialSelect.value = draft.material || 'Cu';
  }
  if (refs.installationSelect && activeEl !== refs.installationSelect) {
    refs.installationSelect.value = draft.installation || 'pipe';
  }
  if (refs.cosPhiInput && activeEl !== refs.cosPhiInput) {
    refs.cosPhiInput.value = String(draft.cosPhi ?? 0.95);
  }
  if (refs.curveSelect && activeEl !== refs.curveSelect) {
    refs.curveSelect.value = draft.curve || 'C';
  }
}

/**
 * Инициализация UI Вкладки 1 и подписка на Store
 */
export async function initLineUI() {
  const refs = getDomRefs();

  // Подписка на реактивный Store
  store.subscribe((currentState, meta) => {
    if (meta.path === 'init' || meta.path === 'reset') {
      syncInputsFromState(refs, currentState);
    }
    renderActiveTab(refs, currentState.activeTab);
    renderLineResult(refs, currentState);
  });

  // Обработчики нижней навигации
  for (const btn of refs.navButtons) {
    btn.addEventListener('click', () => {
      store.state.activeTab = btn.dataset.tab;
    });
  }

  // Обработчик смены предустановки типа нагрузки
  refs.loadTypeSelect?.addEventListener('change', (e) => {
    const preset = LOAD_TYPE_PRESETS[e.target.value];
    if (!preset) return;
    store.state.calculatorDraft.network = preset.network;
    store.state.calculatorDraft.cosPhi = preset.cosPhi;
    if (refs.cosPhiInput) {
      refs.cosPhiInput.value = String(preset.cosPhi);
    }
  });

  // Мгновенные обработчики ввода без потери фокуса
  refs.powerInput?.addEventListener('input', (e) => {
    store.state.calculatorDraft.power = parseFloat(e.target.value);
  });

  refs.lengthInput?.addEventListener('input', (e) => {
    store.state.calculatorDraft.length = parseFloat(e.target.value);
  });

  refs.materialSelect?.addEventListener('change', (e) => {
    store.state.calculatorDraft.material = e.target.value;
  });

  refs.installationSelect?.addEventListener('change', (e) => {
    store.state.calculatorDraft.installation = e.target.value;
  });

  refs.cosPhiInput?.addEventListener('input', (e) => {
    store.state.calculatorDraft.cosPhi = parseFloat(e.target.value);
  });

  refs.curveSelect?.addEventListener('change', (e) => {
    store.state.calculatorDraft.curve = e.target.value;
  });

  // Чтение сохранённого стейта из IndexedDB и первичный рендер
  await store.init();
  syncInputsFromState(refs, store.state);
  renderActiveTab(refs, store.state.activeTab);
  renderLineResult(refs, store.state);
}

