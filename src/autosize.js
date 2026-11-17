/**
 * @file src/autosize.js
 * Автоматический подбор автоматов, сечений кабелей, УЗО, параметров ввода
 * и запуск жадной балансировки фаз по кнопке «Авторасчёт».
 */

import { BREAKER_RATINGS, AMPACITY_TABLES } from './norms.js';
import {
  calculateCurrent,
  selectBreaker,
  calculateVoltageDrop,
  calculateShortCircuit,
  getPeSection,
  normalizeMaterial,
  normalizeInstallation,
  normalizeNetwork,
} from './calc.js';
import { TRIP_CURVE_K_MAX } from './rules.js';
import { balancePhases } from './phases.js';

const RCD_RATINGS = Object.freeze([16, 25, 40, 63, 80, 100]);

/**
 * Подбирает номинал УЗО (I_n УЗО >= max(I_n АВ, I_расч))
 * @param {number} requiredCurrent
 * @returns {number}
 */
export function selectRcdRating(requiredCurrent) {
  return RCD_RATINGS.find((r) => r >= requiredCurrent) || 100;
}

/**
 * Пересчитывает только электрические метрики линии (ток, ΔU, I_кз, I_доп)
 * при ручном редактировании без перезаписи выбранного пользователем автомата, сечения или фазы.
 *
 * @param {object} line
 * @param {number} [zSupply=0.15]
 * @returns {object}
 */
export function recalculateLineMetrics(line, zSupply = 0.15) {
  const power = Number(line.power) || 0;
  const length = Number(line.length) || 0;
  const cosPhi = Number(line.cosPhi) || 0.95;
  const network = normalizeNetwork(line.network || '1f');
  const material = normalizeMaterial(line.material || 'Cu');
  const installation = normalizeInstallation(line.installation || 'pipe');

  const current = power > 0 ? calculateCurrent({ power, network, cosPhi }) : 0;
  const section = Number(line.section) || 1.5;
  const peSection = getPeSection(section);

  const table = AMPACITY_TABLES[material];
  const coresKey = network === '3f' ? 'cores3' : 'cores2';
  const row = table.find((r) => r.section === section);
  const allowableCurrent = row ? row[installation][coresKey] : 0;

  const drop =
    section > 0 && length >= 0
      ? calculateVoltageDrop({ current, length, section, material, network })
      : { volts: 0, percent: 0 };

  const shortCircuitCurrent =
    network !== '24dc' && section > 0 && length >= 0
      ? calculateShortCircuit({ length, section, material, zSupply })
      : 0;

  line.current = current;
  line.peSection = peSection;
  line.allowableCurrent = allowableCurrent;
  line.voltageDropPercent = drop.percent;
  line.voltageDropVolts = drop.volts;
  line.shortCircuitCurrent = shortCircuitCurrent;

  return line;
}

/**
 * Полный автоподбор параметров одной линии (автомат, сечение с учётом ПУЭ C01/C03/C04/C06, УЗО)
 * @param {object} line
 * @param {number} [zSupply=0.15]
 * @returns {object}
 */
export function autosizeLine(line, zSupply = 0.15) {
  const power = Math.max(Number(line.power) || 0.1, 0.01);
  const length = Math.max(Number(line.length) || 1, 0);
  const cosPhi = Number(line.cosPhi) > 0 && Number(line.cosPhi) <= 1 ? Number(line.cosPhi) : 0.95;

  // Если выбрана коммутация ПЧ на 1ф линии — учитываем тип сети 'vfd'
  if (line.switching === 'vfd' && normalizeNetwork(line.network || '1f') === '1f') {
    line.network = 'vfd';
  }

  const network = normalizeNetwork(line.network || '1f');
  const material = normalizeMaterial(line.material || 'Cu');
  const installation = normalizeInstallation(line.installation || 'pipe');
  const curve = line.curve || 'C';

  const current = calculateCurrent({ power, network, cosPhi });
  const breakerRating = selectBreaker(current);

  // Минимальное сечение по ПУЭ (правило C03: Cu >= 1.5 мм² в силовых цепях, Al >= 2.5 мм²)
  const minSectionNorm = material === 'Al' ? 2.5 : network === '24dc' ? 0.5 : 1.5;

  const table = AMPACITY_TABLES[material];
  const coresKey = network === '3f' ? 'cores3' : 'cores2';
  const kMax = TRIP_CURVE_K_MAX[String(curve).toUpperCase()] || 10;
  const minTripCurrent = 1.1 * kMax * breakerRating;

  let chosenRow = table[table.length - 1];

  for (const row of table) {
    if (row.section < minSectionNorm) continue;

    const iDop = row[installation][coresKey];
    if (iDop < breakerRating) continue; // Правило C01

    const drop = calculateVoltageDrop({
      current,
      length,
      section: row.section,
      material,
      network,
    });
    if (drop.percent > 5) continue; // Правило C04 (не допускать ΔU > 5%)

    if (network !== '24dc') {
      const ikz = calculateShortCircuit({
        length,
        section: row.section,
        material,
        zSupply,
      });
      // Если сечение позволяет обеспечить срабатывание ЭМ-расцепителя (C06)
      if (ikz >= minTripCurrent) {
        chosenRow = row;
        break;
      }
    } else {
      chosenRow = row;
      break;
    }

    chosenRow = row;
  }

  line.current = current;
  line.breakerRating = breakerRating;
  line.curve = curve;
  line.section = chosenRow.section;
  line.peSection = getPeSection(chosenRow.section);
  line.allowableCurrent = chosenRow[installation][coresKey];

  const finalDrop = calculateVoltageDrop({
    current,
    length,
    section: chosenRow.section,
    material,
    network,
  });
  line.voltageDropPercent = finalDrop.percent;
  line.voltageDropVolts = finalDrop.volts;
  line.shortCircuitCurrent =
    network === '24dc'
      ? 0
      : calculateShortCircuit({
          length,
          section: chosenRow.section,
          material,
          zSupply,
        });

  // Автоподбор УЗО на линии (если включено или если это линия с ПЧ)
  if (line.rcd && line.rcd.enabled !== false) {
    const isVfd = network === 'vfd' || line.switching === 'vfd';
    if (isVfd && (!line.rcd.type || line.rcd.type.toUpperCase() === 'AC')) {
      line.rcd.type = 'A'; // Правило D03: тип A или B для ПЧ
    }
    line.rcd.in = selectRcdRating(Math.max(breakerRating, current)); // Правило D05
    line.rcd.leakage = line.rcd.leakage || 30;
  }

  return line;
}

/**
 * Авторасчёт всего электрощита:
 * 1. Подбирает автоматы, сечения кабелей и УЗО для всех линий.
 * 2. Запускает жадную балансировку фаз L1 / L2 / L3.
 * 3. Подбирает селективный вводной автомат (P05), селективное вводное УЗО S-типа (D01)
 *    и мощность блока питания 24В с запасом >= 25% (B01).
 *
 * @param {object} state - Состояние щита из Store
 * @returns {object} Обновлённое состояние
 */
export function autosizeShield(state) {
  const zSupply = Number(state.settings?.zSupply) || 0.15;
  const lines = Array.isArray(state.lines) ? state.lines : [];

  let maxLineBreaker = 0;
  let maxDownstreamLeakage = 0;
  let total24VPower = (Number(state.settings?.plcPower) || 0) + (Number(state.settings?.relaysPower) || 0);

  for (const line of lines) {
    autosizeLine(line, zSupply);

    if (line.breakerRating > maxLineBreaker) {
      maxLineBreaker = line.breakerRating;
    }
    if (line.rcd && line.rcd.enabled !== false && line.rcd.leakage > maxDownstreamLeakage) {
      maxDownstreamLeakage = line.rcd.leakage;
    }
    if (normalizeNetwork(line.network || '1f') === '24dc') {
      total24VPower += Number(line.power) || 0;
    }
  }

  // Жадная балансировка фаз (ТОЛЬКО при вызове Авторасчёта)
  const { summary: phaseSummary } = balancePhases(lines);

  // Подбор вводного автомата по селективности (I_ввод >= 1.6 * I_линии_макс и >= I_фазы_макс)
  if (state.settings) {
    const requiredInputCurrent = Math.max(
      1.6 * maxLineBreaker,
      phaseSummary.maxCurrent,
      16
    );
    const inputBreaker =
      BREAKER_RATINGS.find((r) => r >= requiredInputCurrent) ||
      BREAKER_RATINGS[BREAKER_RATINGS.length - 1];
    state.settings.inputBreakerRating = inputBreaker;

    // Селективное вводное УЗО (тип A-S, ток утечки >= 100 мА и > нижестоящих УЗО)
    if (state.settings.inputRcd && state.settings.inputRcd.enabled !== false) {
      state.settings.inputRcd.type = 'A-S';
      state.settings.inputRcd.selective = true;
      state.settings.inputRcd.in = selectRcdRating(inputBreaker);
      state.settings.inputRcd.leakage = maxDownstreamLeakage >= 100 ? 300 : 100;
    }

    // Подбор мощности БП 24В (правило B01: нагрузка <= 80% мощности БП)
    if (state.settings.psu24 && total24VPower > 0) {
      const standardPsuPowers = [30, 60, 120, 240, 480, 960];
      const minPsuPower = total24VPower / 0.8;
      state.settings.psu24.power =
        standardPsuPowers.find((p) => p >= minPsuPower) || Math.ceil(minPsuPower / 60) * 60;
    }
  }

  return state;
}
