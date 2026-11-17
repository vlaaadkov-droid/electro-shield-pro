/**
 * @file src/din.js
 * Интерактивная DIN-рейка в масштабе (1 модуль = 18 мм):
 * - расчёт состава и ширины модульных аппаратов щита (+20% запас для выбора корпуса);
 * - интерактивное включение/отключение отходящих автоматов с мгновенным пересчётом токов по фазам без удаления линии.
 */

import { store } from './store.js';
import { calculatePhaseSummary } from './phases.js';
import { normalizeNetwork } from './calc.js';

/**
 * Стандартная ширина одного DIN-модуля, мм
 */
export const DIN_MODULE_MM = 18;

/**
 * Стандартный ряд ёмкости модульных корпусов (боксов), модулей
 */
export const ENCLOSURE_SIZES = Object.freeze([8, 12, 18, 24, 36, 48, 54, 72, 96, 120, 144]);

/**
 * Рассчитывает список всех аппаратов на DIN-рейке, их ширину в модулях и мм,
 * общую сумму модулей, 20% запас и рекомендуемый размер корпуса щита.
 *
 * @param {object} state - Состояние щита
 * @returns {{
 *   devices: Array<{
 *     id: string,
 *     title: string,
 *     subtitle: string,
 *     category: 'input' | 'rcd' | 'psu' | 'plc' | 'breaker' | 'switching',
 *     modules: number,
 *     widthMm: number,
 *     phaseLabel: string,
 *     lineIndex: number | null,
 *     enabled: boolean,
 *     interactive: boolean
 *   }>,
 *   usedModules: number,
 *   totalWidthMm: number,
 *   recommendedModulesWithReserve: number,
 *   enclosureSize: number
 * }}
 */
export function calculateDinLayout(state = {}) {
  const settings = state.settings || {};
  const lines = Array.isArray(state.lines) ? state.lines : [];
  const devices = [];

  // 1. Вводной автомат
  const isThreePhaseSupply = (settings.network || '3f') === '3f';
  const inputBreakerModules = isThreePhaseSupply ? 3 : 2;
  devices.push({
    id: 'QF0',
    title: 'QF0 Ввод',
    subtitle: `${settings.inputBreakerCurve || 'C'}${settings.inputBreakerRating || 40}А`,
    category: 'input',
    modules: inputBreakerModules,
    widthMm: inputBreakerModules * DIN_MODULE_MM,
    phaseLabel: isThreePhaseSupply ? 'L1-L3' : '1P+N',
    lineIndex: null,
    enabled: true,
    interactive: false,
  });

  // 2. Вводное УЗО (если включено)
  if (settings.inputRcd && settings.inputRcd.enabled !== false) {
    const rcdModules = isThreePhaseSupply ? 4 : 2;
    devices.push({
      id: 'FD0',
      title: 'FD0 УЗО',
      subtitle: `${settings.inputRcd.in || 63}А/${settings.inputRcd.leakage || 100}мА ${settings.inputRcd.type || 'A-S'}`,
      category: 'rcd',
      modules: rcdModules,
      widthMm: rcdModules * DIN_MODULE_MM,
      phaseLabel: isThreePhaseSupply ? '4P' : '2P',
      lineIndex: null,
      enabled: true,
      interactive: false,
    });
  }

  // 3. Блок питания 24В DC (если включён)
  if (settings.psu24 && settings.psu24.enabled !== false && Number(settings.psu24.power) > 0) {
    const psuPower = Number(settings.psu24.power) || 120;
    const psuModules = psuPower <= 60 ? 2 : psuPower <= 120 ? 3 : 4;
    devices.push({
      id: 'G1',
      title: 'G1 БП 24В',
      subtitle: `${psuPower} Вт`,
      category: 'psu',
      modules: psuModules,
      widthMm: psuModules * DIN_MODULE_MM,
      phaseLabel: '24VDC',
      lineIndex: null,
      enabled: true,
      interactive: false,
    });
  }

  // 4. ПЛК / Модуль автоматики (если задана мощность ПЛК/реле)
  if ((Number(settings.plcPower) || 0) > 0) {
    devices.push({
      id: 'A1',
      title: 'A1 ПЛК',
      subtitle: `${settings.plcPower} Вт`,
      category: 'plc',
      modules: 4,
      widthMm: 4 * DIN_MODULE_MM,
      phaseLabel: '24VDC',
      lineIndex: null,
      enabled: true,
      interactive: false,
    });
  }

  // 5. Аппараты отходящих линий
  lines.forEach((line, idx) => {
    const net = normalizeNetwork(line.network || '1f');
    const isEnabled = line.enabled !== false;
    const breakerMods = net === '3f' ? 3 : 1;

    // Отходящий автомат (интерактивный — клик переключает Вкл/Откл)
    devices.push({
      id: line.id || `QF${idx + 1}`,
      title: `${line.id || `QF${idx + 1}`}`,
      subtitle: `${line.curve || 'C'}${line.breakerRating || 16}А`,
      category: 'breaker',
      modules: breakerMods,
      widthMm: breakerMods * DIN_MODULE_MM,
      phaseLabel: line.phase || (net === '3f' ? 'L1-L3' : net === '24dc' ? 'DC' : 'L1'),
      lineIndex: idx,
      enabled: isEnabled,
      interactive: true,
    });

    // Дифзащита (УЗО) линии
    if (line.rcd && line.rcd.enabled) {
      const lineRcdMods = net === '3f' ? 4 : 2;
      devices.push({
        id: `FD${idx + 1}`,
        title: `FD${idx + 1} УЗО`,
        subtitle: `${line.rcd.in || 25}А/${line.rcd.leakage || 30}мА ${line.rcd.type || 'A'}`,
        category: 'rcd',
        modules: lineRcdMods,
        widthMm: lineRcdMods * DIN_MODULE_MM,
        phaseLabel: net === '3f' ? '4P' : '2P',
        lineIndex: idx,
        enabled: isEnabled,
        interactive: false,
      });
    }

    // Коммутационный аппарат (Контактор КМ / ПЧ / Реле)
    if (line.switching && line.switching !== 'none') {
      let swMods = 1;
      let swTitle = `KL${idx + 1}`;
      let swSub = 'Реле 24В';

      if (line.switching === 'contactor') {
        swMods = net === '3f' ? 3 : 2;
        swTitle = `KM${idx + 1}`;
        swSub = 'Контактор';
      } else if (line.switching === 'vfd') {
        swMods = 4;
        swTitle = `UZ${idx + 1}`;
        swSub = `ПЧ ${line.power || 1.5}кВт`;
      }

      devices.push({
        id: swTitle,
        title: swTitle,
        subtitle: swSub,
        category: 'switching',
        modules: swMods,
        widthMm: swMods * DIN_MODULE_MM,
        phaseLabel: line.phase || 'L1',
        lineIndex: idx,
        enabled: isEnabled,
        interactive: false,
      });
    }
  });

  const usedModules = devices.reduce((sum, d) => sum + d.modules, 0);
  const totalWidthMm = usedModules * DIN_MODULE_MM;

  // Запас +20% для выбора корпуса щита
  const recommendedModulesWithReserve = Math.ceil(usedModules * 1.2);
  const enclosureSize =
    ENCLOSURE_SIZES.find((size) => size >= recommendedModulesWithReserve) ||
    Math.ceil(recommendedModulesWithReserve / 12) * 12;

  return {
    devices,
    usedModules,
    totalWidthMm,
    recommendedModulesWithReserve,
    enclosureSize,
  };
}

/**
 * Переключает состояние отходящего автомата (Вкл / Откл) по индексу линии
 * и возвращает обновлённую сводку токов по фазам (без удаления линии из щита).
 *
 * @param {object} state
 * @param {number} lineIndex
 * @returns {ReturnType<typeof calculatePhaseSummary>}
 */
export function toggleLineBreaker(state, lineIndex) {
  const line = state.lines?.[lineIndex];
  if (line) {
    line.enabled = line.enabled === false;
  }
  return calculatePhaseSummary(state.lines || []);
}

/**
 * Отрисовка интерактивной DIN-рейки в указанный DOM-контейнер
 * @param {HTMLElement} container
 * @param {object} state
 * @param {() => void} [onToggle] - Колбэк после переключения автомата
 */
export function renderDinRail(container, state = store.state, onToggle) {
  if (!container) return;

  const layout = calculateDinLayout(state);
  const phaseSummary = calculatePhaseSummary(state.lines || []);
  const pxPerModule = 38; // Масштаб: 1 модуль (18 мм) = 38 px

  const devicesHtml = layout.devices
    .map((dev) => {
      const widthPx = dev.modules * pxPerModule;
      const offClass = dev.enabled ? 'din-device-on' : 'din-device-off';
      const interactiveAttr = dev.interactive
        ? `data-line-index="${dev.lineIndex}" role="button" tabindex="0" title="Нажмите для Вкл/Откл автомата"`
        : '';

      return `
        <div
          class="din-device din-cat-${dev.category} ${offClass} ${dev.interactive ? 'din-interactive' : ''}"
          style="width: ${widthPx}px; min-width: ${widthPx}px;"
          ${interactiveAttr}
        >
          <div class="din-screw-row"><span class="din-screw"></span></div>
          <div class="din-title">${dev.title}</div>
          <div class="din-sub">${dev.subtitle}</div>
          <div class="din-lever-slot">
            <div class="din-lever ${dev.enabled ? 'lever-on' : 'lever-off'}">
              ${dev.enabled ? 'I ВКЛ' : 'O ОТКЛ'}
            </div>
          </div>
          <div class="din-meta tabular-nums">${dev.modules}м (${dev.widthMm}мм) · ${dev.phaseLabel}</div>
          <div class="din-screw-row"><span class="din-screw"></span></div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="din-summary-bar tabular-nums">
      <div class="din-stat">
        <span class="metric-label">Занято модулей (18 мм)</span>
        <strong>${layout.usedModules} мод. (${layout.totalWidthMm} мм)</strong>
      </div>
      <div class="din-stat">
        <span class="metric-label">С запасом +20%</span>
        <strong>${layout.recommendedModulesWithReserve} мод.</strong>
      </div>
      <div class="din-stat">
        <span class="metric-label">Корпус щита</span>
        <strong class="din-enclosure-badge">Бокс на ${layout.enclosureSize} мод.</strong>
      </div>
    </div>

    <div class="din-rail-viewport">
      <div class="din-rail-metal">
        <div class="din-devices-row">
          ${devicesHtml}
        </div>
      </div>
    </div>

    <div class="phase-summary-grid tabular-nums">
      <div class="phase-pill"><span>Активно L1:</span> <strong>${phaseSummary.L1.toFixed(1)} А</strong></div>
      <div class="phase-pill"><span>Активно L2:</span> <strong>${phaseSummary.L2.toFixed(1)} А</strong></div>
      <div class="phase-pill"><span>Активно L3:</span> <strong>${phaseSummary.L3.toFixed(1)} А</strong></div>
      <div class="phase-pill"><span>Перекос:</span> <strong>${phaseSummary.unbalancePercent.toFixed(1)}%</strong></div>
    </div>
  `;

  // Обработчик клика по отходящим автоматам (Вкл/Откл без удаления линии)
  container.querySelectorAll('.din-interactive[data-line-index]').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.lineIndex);
      toggleLineBreaker(state, idx);
      renderDinRail(container, state, onToggle);
      if (typeof onToggle === 'function') {
        onToggle();
      }
    });
  });
}
