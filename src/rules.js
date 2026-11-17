/**
 * @file src/rules.js
 * Движок правил валидации электрощита и кабельных линий (Этап 2).
 * Проверяет контекст щита по правилам C01, C03, C04, C06, P05, D01, D03, D05, B01.
 */

import { AMPACITY_TABLES } from './norms.js';
import {
  normalizeMaterial,
  normalizeInstallation,
  normalizeNetwork,
  calculateVoltageDrop,
  calculateShortCircuit,
} from './calc.js';

/**
 * Кратности электромагнитного расцепителя k_max по характеристикам автоматов
 */
export const TRIP_CURVE_K_MAX = Object.freeze({
  B: 5,
  C: 10,
  D: 20,
  АЗД: 14,
  AZD: 14,
});

/**
 * Вспомогательное получение допустимого длительного тока кабеля из таблиц ПУЭ
 * @param {object} line
 * @returns {number | null}
 */
function resolveAllowableCurrent(line) {
  if (typeof line.allowableCurrentAdjusted === 'number') {
    return line.allowableCurrentAdjusted;
  }
  if (typeof line.iDopAdjusted === 'number') {
    return line.iDopAdjusted;
  }

  const kCorr = typeof line.correctionFactor === 'number' ? line.correctionFactor : 1;

  if (typeof line.allowableCurrent === 'number') {
    return line.allowableCurrent * kCorr;
  }
  if (typeof line.iDop === 'number') {
    return line.iDop * kCorr;
  }

  if (typeof line.section !== 'number') {
    return null;
  }

  const mat = normalizeMaterial(line.material || 'Cu');
  const inst = normalizeInstallation(line.installation || 'pipe');
  const net = line.network ? normalizeNetwork(line.network) : '1f';
  const coresKey = net === '3f' ? 'cores3' : 'cores2';

  const row = AMPACITY_TABLES[mat].find((r) => r.section === line.section);
  if (!row) return null;

  return row[inst][coresKey] * kCorr;
}

/**
 * Правило C01 (error): Номинал автомата превышает допустимый ток кабеля (I_n > I_доп_скорр)
 */
function checkRuleC01(context) {
  const verdicts = [];
  const lines = Array.isArray(context.lines) ? context.lines : [];

  for (const line of lines) {
    const inRating = line.breakerRating ?? line.in ?? line.In ?? line.breaker?.rating;
    const iDop = resolveAllowableCurrent(line);

    if (typeof inRating === 'number' && typeof iDop === 'number' && inRating > iDop) {
      const label = line.name || line.id || 'Линия';
      verdicts.push({
        id: 'C01',
        severity: 'error',
        message: `${label}: номинал автомата (${inRating} А) превышает длительно допустимый ток кабеля (${iDop} А).`,
      });
    }
  }

  return verdicts;
}

/**
 * Правило C03 (error): Медь < 1.5 мм² в силовых цепях; Алюминий < 2.5 мм² вообще
 */
function checkRuleC03(context) {
  const verdicts = [];
  const lines = Array.isArray(context.lines) ? context.lines : [];

  for (const line of lines) {
    if (typeof line.section !== 'number') continue;

    const mat = normalizeMaterial(line.material || 'Cu');
    const net = line.network ? normalizeNetwork(line.network) : '1f';
    const isControlCircuit =
      line.circuitType === 'control' ||
      line.isControl === true ||
      (net === '24dc' && line.isPower !== true);
    const label = line.name || line.id || 'Линия';

    if (mat === 'Al' && line.section < 2.5) {
      verdicts.push({
        id: 'C03',
        severity: 'error',
        message: `${label}: применение алюминиевых проводников сечением менее 2.5 мм² (${line.section} мм²) запрещено ПУЭ.`,
      });
    } else if (mat === 'Cu' && !isControlCircuit && line.section < 1.5) {
      verdicts.push({
        id: 'C03',
        severity: 'error',
        message: `${label}: сечение медного кабеля в силовых цепях (${line.section} мм²) меньше минимально допустимых 1.5 мм².`,
      });
    }
  }

  return verdicts;
}

/**
 * Правило C04 (warning/error): Падение напряжения ΔU > 5% (error), 3..5% (warning)
 */
function checkRuleC04(context) {
  const verdicts = [];
  const lines = Array.isArray(context.lines) ? context.lines : [];

  for (const line of lines) {
    let deltaU = line.voltageDropPercent ?? line.voltageDrop ?? line.deltaU;

    if (
      typeof deltaU !== 'number' &&
      typeof line.current === 'number' &&
      typeof line.length === 'number' &&
      typeof line.section === 'number' &&
      line.section > 0
    ) {
      const drop = calculateVoltageDrop({
        current: line.current,
        length: line.length,
        section: line.section,
        material: line.material || 'Cu',
        network: line.network || '1f',
      });
      deltaU = drop.percent;
    }

    if (typeof deltaU !== 'number') continue;
    const label = line.name || line.id || 'Линия';

    if (deltaU > 5) {
      verdicts.push({
        id: 'C04',
        severity: 'error',
        message: `${label}: падение напряжения ΔU = ${deltaU}% превышает предельно допустимые 5%.`,
      });
    } else if (deltaU >= 3) {
      verdicts.push({
        id: 'C04',
        severity: 'warning',
        message: `${label}: падение напряжения ΔU = ${deltaU}% находится в пограничной зоне (3–5%).`,
      });
    }
  }

  return verdicts;
}

/**
 * Правило C06 (error): Ток КЗ < 1.1 * k_max * I_n (где k_max: B=5, C=10, D=20, АЗД=14)
 */
function checkRuleC06(context) {
  const verdicts = [];
  const lines = Array.isArray(context.lines) ? context.lines : [];
  const zSupplyDefault = context.zSupply ?? context.input?.zSupply ?? 0.15;

  for (const line of lines) {
    const inRating = line.breakerRating ?? line.in ?? line.In ?? line.breaker?.rating;
    if (typeof inRating !== 'number') continue;

    const net = line.network ? normalizeNetwork(line.network) : '1f';
    if (net === '24dc' && typeof line.shortCircuitCurrent !== 'number' && typeof line.ikz !== 'number') {
      continue;
    }

    const rawCurve = String(
      line.curve ?? line.breakerCurve ?? line.characteristic ?? line.breaker?.curve ?? 'C'
    )
      .trim()
      .toUpperCase();

    const kMax = TRIP_CURVE_K_MAX[rawCurve];
    if (!kMax) continue;

    let ikz = line.shortCircuitCurrent ?? line.ikz ?? line.iKz;
    if (
      typeof ikz !== 'number' &&
      typeof line.length === 'number' &&
      typeof line.section === 'number' &&
      line.section > 0
    ) {
      ikz = calculateShortCircuit({
        length: line.length,
        section: line.section,
        material: line.material || 'Cu',
        zSupply: line.zSupply ?? zSupplyDefault,
      });
    }

    if (typeof ikz !== 'number') continue;

    const minTripCurrent = Math.round(1.1 * kMax * inRating * 100) / 100;
    if (ikz < minTripCurrent) {
      const label = line.name || line.id || 'Линия';
      verdicts.push({
        id: 'C06',
        severity: 'error',
        message: `${label}: минимальный ток КЗ (${ikz} А) меньше тока гарантированного срабатывания расцепителя ${rawCurve}${inRating} (${minTripCurrent} А). Не обеспечено отключение при КЗ.`,
      });
    }
  }

  return verdicts;
}

/**
 * Правило P05 (warning): Селективность ввода. I_ввод < 1.6 * I_линии_макс
 */
function checkRuleP05(context) {
  const verdicts = [];
  const inputIn =
    context.inputBreakerRating ??
    context.mainBreakerRating ??
    context.input?.breakerRating ??
    context.input?.in ??
    context.inInput;

  if (typeof inputIn !== 'number') return verdicts;

  const lines = Array.isArray(context.lines) ? context.lines : [];
  let maxLineIn = typeof context.maxLineBreakerRating === 'number' ? context.maxLineBreakerRating : 0;

  for (const line of lines) {
    const lineIn = line.breakerRating ?? line.in ?? line.In ?? line.breaker?.rating;
    if (typeof lineIn === 'number' && lineIn > maxLineIn) {
      maxLineIn = lineIn;
    }
  }

  if (maxLineIn > 0 && inputIn < 1.6 * maxLineIn) {
    verdicts.push({
      id: 'P05',
      severity: 'warning',
      message: `Нарушена селективность вводного автомата (${inputIn} А) относительно максимального линейного автомата (${maxLineIn} А): требуется I_ввод >= ${Math.round(1.6 * maxLineIn * 10) / 10} А.`,
    });
  }

  return verdicts;
}

/**
 * Правило D01 (error): Селективность УЗО.
 * Если вышестоящее УЗО не типа S и/или имеет ток утечки <= нижестоящего УЗО.
 */
function checkRuleD01(context) {
  const verdicts = [];
  const upstreamDefault =
    context.inputRcd ?? context.upstreamRcd ?? context.mainRcd ?? context.input?.rcd ?? null;

  const pairs = [];

  // 1. Пары из линий (line.rcd + line.upstreamRcd или вводное УЗО)
  const lines = Array.isArray(context.lines) ? context.lines : [];
  for (const line of lines) {
    const downRcd = line.rcd;
    const upRcd = line.upstreamRcd ?? upstreamDefault;
    if (downRcd && upRcd) {
      pairs.push({
        label: line.name || line.id || 'Линия',
        up: upRcd,
        down: downRcd,
      });
    }
  }

  // 2. Пары из групп УЗО (context.rcdGroups / context.groups / context.rcds)
  const groups = Array.isArray(context.rcdGroups)
    ? context.rcdGroups
    : Array.isArray(context.groups)
      ? context.groups
      : [];

  for (const group of groups) {
    const downRcd = group.rcd ?? group;
    const upRcd = group.upstreamRcd ?? upstreamDefault;
    if (downRcd && upRcd && (downRcd.leakage !== undefined || downRcd.iDeltaN !== undefined)) {
      pairs.push({
        label: group.name || group.id || 'Группа УЗО',
        up: upRcd,
        down: downRcd,
      });
    }
  }

  for (const { label, up, down } of pairs) {
    const upLeakage = up.leakage ?? up.iDeltaN ?? up.deltaI;
    const downLeakage = down.leakage ?? down.iDeltaN ?? down.deltaI;
    const upSelective =
      up.selective === true ||
      String(up.selectivity ?? '').toUpperCase() === 'S' ||
      String(up.type ?? '').toUpperCase().includes('S');

    const isLeakageBad =
      typeof upLeakage === 'number' &&
      typeof downLeakage === 'number' &&
      upLeakage <= downLeakage;

    if (!upSelective || isLeakageBad) {
      verdicts.push({
        id: 'D01',
        severity: 'error',
        message: `${label}: нарушена селективность УЗО (вышестоящее УЗО должно быть селективным типа S и иметь уставку тока утечки больше нижестоящего: ${upLeakage ?? '?'} мА vs ${downLeakage ?? '?'} мА).`,
      });
    }
  }

  return verdicts;
}

/**
 * Правило D03 (error): УЗО формы AC на линии с ПЧ (требовать B или A)
 */
function checkRuleD03(context) {
  const verdicts = [];
  const lines = Array.isArray(context.lines) ? context.lines : [];

  for (const line of lines) {
    const isVfdLine =
      (line.network && normalizeNetwork(line.network) === 'vfd') ||
      line.hasVfd === true ||
      line.loadType === 'vfd';

    if (!isVfdLine) continue;

    const rcd = line.rcd ?? context.inputRcd ?? context.input?.rcd;
    if (!rcd) continue;

    const rcdWaveform = String(rcd.waveform ?? rcd.form ?? rcd.type ?? 'AC')
      .trim()
      .toUpperCase()
      .replace(/[-_\s]*S$/i, ''); // на случай 'AC-S' / 'A-S'

    if (rcdWaveform === 'AC') {
      const label = line.name || line.id || 'Линия с ПЧ';
      verdicts.push({
        id: 'D03',
        severity: 'error',
        message: `${label}: запрещено применение УЗО типа AC на линии с частотным преобразователем (ПЧ). Требуется тип A или B.`,
      });
    }
  }

  return verdicts;
}

/**
 * Правило D05 (error): Расчётный ток группы > I_n УЗО (защита УЗО от перегрузки)
 */
function checkRuleD05(context) {
  const verdicts = [];
  const lines = Array.isArray(context.lines) ? context.lines : [];

  // Проверка УЗО, заданных непосредственно на линиях
  for (const line of lines) {
    if (!line.rcd) continue;
    const rcdIn = line.rcd.in ?? line.rcd.In ?? line.rcd.rating ?? line.rcd.nominalCurrent;
    const lineCurrent = line.groupCurrent ?? line.current;

    if (typeof rcdIn === 'number' && typeof lineCurrent === 'number' && lineCurrent > rcdIn) {
      const label = line.name || line.id || 'Линия';
      verdicts.push({
        id: 'D05',
        severity: 'error',
        message: `${label}: расчётный ток (${lineCurrent} А) превышает номинальный рабочий ток УЗО (${rcdIn} А). УЗО не защищено от перегрузки.`,
      });
    }
  }

  // Проверка групповых УЗО (context.rcdGroups / context.groups)
  const groups = Array.isArray(context.rcdGroups)
    ? context.rcdGroups
    : Array.isArray(context.groups)
      ? context.groups
      : [];

  for (const group of groups) {
    const rcd = group.rcd ?? group;
    const rcdIn = rcd.in ?? rcd.In ?? rcd.rating ?? rcd.nominalCurrent;
    if (typeof rcdIn !== 'number') continue;

    let groupCurrent = group.current ?? group.totalCurrent;
    if (typeof groupCurrent !== 'number' && Array.isArray(group.lines)) {
      groupCurrent = group.lines.reduce((sum, l) => sum + (Number(l.current) || 0), 0);
    }

    if (typeof groupCurrent === 'number' && groupCurrent > rcdIn) {
      const label = group.name || group.id || 'Группа УЗО';
      verdicts.push({
        id: 'D05',
        severity: 'error',
        message: `${label}: суммарный расчётный ток группы (${groupCurrent} А) превышает номинальный ток УЗО (${rcdIn} А).`,
      });
    }
  }

  return verdicts;
}

/**
 * Правило B01 (error): Баланс 24V. Сумма мощностей реле и ПЛК > 80% мощности БП 24V.
 */
function checkRuleB01(context) {
  const verdicts = [];

  const psuPower =
    typeof context.psu24 === 'number'
      ? context.psu24
      : context.psu24?.power ??
        context.powerSupply24V?.power ??
        context.psuPower ??
        context.input?.psuPower ??
        null;

  if (typeof psuPower !== 'number' || psuPower <= 0) {
    return verdicts;
  }

  let totalLoad24 = 0;

  if (typeof context.total24VLoadPower === 'number') {
    totalLoad24 = context.total24VLoadPower;
  } else {
    if (typeof context.plcPower === 'number') totalLoad24 += context.plcPower;
    if (typeof context.relaysPower === 'number') totalLoad24 += context.relaysPower;
    if (typeof context.psu24?.loadPower === 'number') totalLoad24 += context.psu24.loadPower;

    if (Array.isArray(context.loads24V)) {
      for (const item of context.loads24V) {
        totalLoad24 += Number(item.power) || 0;
      }
    }

    const lines = Array.isArray(context.lines) ? context.lines : [];
    for (const line of lines) {
      if (line.network && normalizeNetwork(line.network) === '24dc') {
        totalLoad24 += Number(line.power) || 0;
      }
    }
  }

  const maxAllowed = Math.round(psuPower * 0.8 * 100) / 100;
  if (totalLoad24 > maxAllowed) {
    verdicts.push({
      id: 'B01',
      severity: 'error',
      message: `Превышен бюджет мощности БП 24V: суммарная нагрузка ПЛК и реле (${totalLoad24} Вт) превышает 80% мощности блока питания (${maxAllowed} Вт из ${psuPower} Вт).`,
    });
  }

  return verdicts;
}

/**
 * Список всех правил аудита
 */
export const RULES = Object.freeze([
  checkRuleC01,
  checkRuleC03,
  checkRuleC04,
  checkRuleC06,
  checkRuleP05,
  checkRuleD01,
  checkRuleD03,
  checkRuleD05,
  checkRuleB01,
]);

/**
 * Прогоняет контекст электрощита через массив правил и возвращает массив вердиктов
 * @param {object} context - Данные ввода и массив линий щита
 * @returns {Array<{ id: string, severity: 'error' | 'warning', message: string }>}
 */
export function audit(context = {}) {
  const verdicts = [];
  for (const ruleFn of RULES) {
    const result = ruleFn(context);
    if (Array.isArray(result) && result.length > 0) {
      verdicts.push(...result);
    }
  }
  return verdicts;
}
