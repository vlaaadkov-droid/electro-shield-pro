/**
 * @file src/phases.js
 * Жадный алгоритм балансировки однофазных нагрузок по фазам L1 / L2 / L3
 * и расчёт токов по фазам и коэффициента перекоса фаз.
 */

import { roundTo, normalizeNetwork } from './calc.js';

export const PHASES = Object.freeze(['L1', 'L2', 'L3']);

/**
 * Вычисляет текущее распределение токов по фазам L1, L2, L3 и перекос фаз (%)
 * без изменения привязки линий к фазам.
 *
 * @param {Array<object>} lines - Массив линий щита
 * @returns {{
 *   L1: number,
 *   L2: number,
 *   L3: number,
 *   maxCurrent: number,
 *   minCurrent: number,
 *   unbalancePercent: number
 * }}
 */
export function calculatePhaseSummary(lines = []) {
  const totals = { L1: 0, L2: 0, L3: 0 };

  for (const line of lines) {
    if (line.enabled === false) continue;
    const current = Number(line.current) || 0;
    if (current <= 0) continue;

    const net = line.network ? normalizeNetwork(line.network) : '1f';

    if (net === '3f') {
      totals.L1 += current;
      totals.L2 += current;
      totals.L3 += current;
    } else if (net === '1f' || net === 'vfd') {
      const phase = PHASES.includes(line.phase) ? line.phase : 'L1';
      totals[phase] += current;
    }
  }

  const l1 = roundTo(totals.L1, 2);
  const l2 = roundTo(totals.L2, 2);
  const l3 = roundTo(totals.L3, 2);

  const maxCurrent = Math.max(l1, l2, l3);
  const minCurrent = Math.min(l1, l2, l3);

  const unbalancePercent =
    maxCurrent > 0 ? roundTo(((maxCurrent - minCurrent) / maxCurrent) * 100, 1) : 0;

  return {
    L1: l1,
    L2: l2,
    L3: l3,
    maxCurrent,
    minCurrent,
    unbalancePercent,
  };
}

/**
 * Жадный алгоритм балансировки фаз:
 * 1. Трёхфазные линии (3f) равномерно нагружают L1, L2, L3 (фаза 'L1-L2-L3').
 * 2. Цепи 24В DC получают маркировку 'DC'.
 * 3. Однофазные линии (1f и ПЧ 1f->3f) сортируются по убыванию расчётного тока
 *    и поочерёдно назначаются на фазу (L1, L2 или L3) с минимальной накопленной нагрузкой.
 *
 * Вызывается ТОЛЬКО по явному нажатию кнопки «Авторасчёт».
 *
 * @param {Array<object>} lines - Массив линий щита
 * @returns {{
 *   lines: Array<object>,
 *   summary: ReturnType<typeof calculatePhaseSummary>
 * }}
 */
export function balancePhases(lines = []) {
  const phaseLoads = { L1: 0, L2: 0, L3: 0 };
  const singlePhaseItems = [];

  for (const line of lines) {
    const current = Number(line.current) || 0;
    const net = line.network ? normalizeNetwork(line.network) : '1f';

    if (net === '3f') {
      line.phase = 'L1-L2-L3';
      phaseLoads.L1 += current;
      phaseLoads.L2 += current;
      phaseLoads.L3 += current;
    } else if (net === '24dc') {
      line.phase = 'DC';
    } else {
      singlePhaseItems.push(line);
    }
  }

  // Сортируем 1ф линии по убыванию тока (без изменения порядка самих линий в массиве щита)
  singlePhaseItems.sort((a, b) => (Number(b.current) || 0) - (Number(a.current) || 0));

  for (const line of singlePhaseItems) {
    const current = Number(line.current) || 0;

    // Находим фазу с минимальным текущим током
    let minPhase = 'L1';
    if (phaseLoads.L2 < phaseLoads[minPhase]) minPhase = 'L2';
    if (phaseLoads.L3 < phaseLoads[minPhase]) minPhase = 'L3';

    line.phase = minPhase;
    phaseLoads[minPhase] += current;
  }

  return {
    lines,
    summary: calculatePhaseSummary(lines),
  };
}
