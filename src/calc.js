/**
 * @file src/calc.js
 * Математическое ядро расчёта кабельных линий, защитных аппаратов,
 * падения напряжения и токов однофазного короткого замыкания (петля «фаза-ноль»).
 */

import {
  RESISTIVITY_20,
  BREAKER_RATINGS,
  AMPACITY_TABLES,
} from './norms.js';

/**
 * Округление числа до указанного количества знаков после запятой
 * @param {number} value
 * @param {number} [decimals=2]
 * @returns {number}
 */
export function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Нормализация кода типа сети
 * @param {string} network
 * @returns {'24dc' | '1f' | '3f' | 'vfd'}
 */
export function normalizeNetwork(network) {
  const raw = String(network).trim().toLowerCase();
  if (raw === '24dc' || raw === '24' || raw === '24v' || raw === '24в' || raw === 'dc') {
    return '24dc';
  }
  if (raw === '1f' || raw === '1ф' || raw === '220' || raw === '220v' || raw === '220в') {
    return '1f';
  }
  if (raw === '3f' || raw === '3ф' || raw === '380' || raw === '380v' || raw === '380в') {
    return '3f';
  }
  if (raw === 'vfd' || raw === 'пч' || raw === '1f-3f' || raw === 'vfd_1f') {
    return 'vfd';
  }
  throw new Error(`Неизвестный тип сети: "${network}"`);
}

/**
 * Нормализация материала проводника
 * @param {string} material
 * @returns {'Cu' | 'Al'}
 */
export function normalizeMaterial(material = 'Cu') {
  const raw = String(material).trim().toLowerCase();
  if (raw === 'cu' || raw === 'медь' || raw === 'copper') return 'Cu';
  if (raw === 'al' || raw === 'алюминий' || raw === 'aluminum') return 'Al';
  throw new Error(`Неизвестный материал проводника: "${material}"`);
}

/**
 * Нормализация способа прокладки
 * @param {string} installation
 * @returns {'pipe' | 'open'}
 */
export function normalizeInstallation(installation = 'pipe') {
  const raw = String(installation).trim().toLowerCase();
  if (raw === 'pipe' || raw === 'труба' || raw === 'в трубе' || raw === 'closed' || raw === 'скрыто') {
    return 'pipe';
  }
  if (raw === 'open' || raw === 'открыто' || raw === 'air' || raw === 'воздух') {
    return 'open';
  }
  throw new Error(`Неизвестный способ прокладки: "${installation}"`);
}

/**
 * Расчёт рабочего тока линии, А
 * - 24В DC: I = P / 24 (P в Вт)
 * - 1ф 220В: I = (P_кВт * 1000) / (220 * cosφ)
 * - 3ф 380В: I = (P_кВт * 1000) / (1.732 * 380 * cosφ)
 * - Входной ток ПЧ (1ф 220В -> 3ф 220В): I_вх_пч = (P_дв * 1000 / 220) * 2.2
 *
 * @param {object} params
 * @param {number} params.power - Мощность (кВт для 1ф/3ф/ПЧ; Вт для 24В DC)
 * @param {string} params.network - Тип сети ('24dc' | '1f' | '3f' | 'vfd')
 * @param {number} [params.cosPhi=0.95] - Коэффициент мощности cosφ
 * @returns {number} Расчётный ток, А
 */
export function calculateCurrent({ power, network, cosPhi = 0.95 }) {
  if (typeof power !== 'number' || Number.isNaN(power) || power < 0) {
    throw new Error('Мощность должна быть неотрицательным числом');
  }

  const net = normalizeNetwork(network);

  if (net === '24dc') {
    return roundTo(power / 24, 2);
  }

  if (net === 'vfd') {
    const iVfd = ((power * 1000) / 220) * 2.2;
    return roundTo(iVfd, 2);
  }

  if (typeof cosPhi !== 'number' || Number.isNaN(cosPhi) || cosPhi <= 0 || cosPhi > 1) {
    throw new Error('cosφ должен быть в диапазоне (0, 1]');
  }

  if (net === '1f') {
    const i1f = (power * 1000) / (220 * cosPhi);
    return roundTo(i1f, 2);
  }

  if (net === '3f') {
    const i3f = (power * 1000) / (1.732 * 380 * cosPhi);
    return roundTo(i3f, 2);
  }

  throw new Error(`Неподдерживаемый тип сети: "${network}"`);
}

/**
 * Выбор ближайшего номинала автомата (I_n >= I_расч)
 * @param {number} current - Расчётный ток, А
 * @returns {number} Номинал автомата, А
 */
export function selectBreaker(current) {
  if (typeof current !== 'number' || Number.isNaN(current) || current <= 0) {
    throw new Error('Ток для выбора автомата должен быть положительным числом');
  }
  const rating = BREAKER_RATINGS.find((r) => r >= current);
  if (!rating) {
    throw new Error(`Расчётный ток ${current} А превышает максимальный номинал автомата (125 А)`);
  }
  return rating;
}

/**
 * Подбор минимального сечения кабеля по допустимому длительному току (I_доп >= I_n)
 * @param {object} params
 * @param {number} params.breakerRating - Номинал автомата I_n, А
 * @param {string} [params.material='Cu'] - Материал ('Cu' | 'Al')
 * @param {string} [params.installation='pipe'] - Прокладка ('pipe' | 'open')
 * @param {string} [params.network='1f'] - Сеть ('24dc' | '1f' | '3f' | 'vfd')
 * @returns {{ section: number, allowableCurrent: number }}
 */
export function selectCableSection({
  breakerRating,
  material = 'Cu',
  installation = 'pipe',
  network = '1f',
}) {
  const mat = normalizeMaterial(material);
  const inst = normalizeInstallation(installation);
  const net = normalizeNetwork(network);

  const table = AMPACITY_TABLES[mat];
  const coresKey = net === '3f' ? 'cores3' : 'cores2';

  for (const row of table) {
    const allowableCurrent = row[inst][coresKey];
    if (allowableCurrent >= breakerRating) {
      return {
        section: row.section,
        allowableCurrent,
      };
    }
  }

  throw new Error(
    `Не найдено подходящее сечение (${mat}, ${inst}) для автомата ${breakerRating} А`
  );
}

/**
 * Расчёт падения напряжения ΔU (1ф, 3ф, 24В DC)
 * - 1ф 220В / ПЧ: ΔU_В = 2 * I * ρ20 * L / S; ΔU_% = (ΔU_В / 220) * 100
 * - 3ф 380В:      ΔU_В = 1.732 * I * ρ20 * L / S; ΔU_% = (ΔU_В / 380) * 100
 * - 24В DC:       ΔU_В = 2 * I * ρ20 * L / S; ΔU_% = (ΔU_В / 24) * 100
 *
 * @param {object} params
 * @param {number} params.current - Рабочий ток линии I, А
 * @param {number} params.length - Длина линии L, м
 * @param {number} params.section - Сечение жилы S, мм²
 * @param {string} [params.material='Cu'] - Материал проводника ('Cu' | 'Al')
 * @param {string} [params.network='1f'] - Тип сети ('1f' | '3f' | '24dc' | 'vfd')
 * @returns {{ volts: number, percent: number }}
 */
export function calculateVoltageDrop({
  current,
  length,
  section,
  material = 'Cu',
  network = '1f',
}) {
  if (section <= 0) {
    throw new Error('Сечение проводника должно быть больше 0');
  }
  if (length < 0) {
    throw new Error('Длина линии не может быть отрицательной');
  }

  const mat = normalizeMaterial(material);
  const net = normalizeNetwork(network);
  const rho = RESISTIVITY_20[mat];

  let factor;
  let nominalVoltage;

  if (net === '3f') {
    factor = 1.732;
    nominalVoltage = 380;
  } else if (net === '24dc') {
    factor = 2;
    nominalVoltage = 24;
  } else {
    // '1f' или 'vfd' (вход 1ф 220В)
    factor = 2;
    nominalVoltage = 220;
  }

  const deltaUVolts = (factor * current * rho * length) / section;
  const deltaUPercent = (deltaUVolts / nominalVoltage) * 100;

  return {
    volts: roundTo(deltaUVolts, 2),
    percent: roundTo(deltaUPercent, 2),
  };
}

/**
 * Определение сечения защитного проводника S_PE по ПУЭ п. 1.7.126
 * - S_PE = S при S <= 16
 * - S_PE = 16 при 16 < S <= 35
 * - S_PE = S / 2 при S > 35
 *
 * @param {number} section - Сечение фазного проводника S, мм²
 * @returns {number} Сечение S_PE, мм²
 */
export function getPeSection(section) {
  if (section <= 0) {
    throw new Error('Сечение фазного проводника должно быть положительным');
  }
  if (section <= 16) return section;
  if (section <= 35) return 16;
  return section / 2;
}

/**
 * Расчёт минимального тока однофазного КЗ (петля «фаза-ноль»), А
 * Формула: I_кз = 220 / (Z_ввода + 1.5 * ρ20 * (L/S + L/S_PE))
 *
 * @param {object} params
 * @param {number} params.length - Длина линии L, м
 * @param {number} params.section - Сечение фазного проводника S, мм²
 * @param {string} [params.material='Cu'] - Материал проводника ('Cu' | 'Al')
 * @param {number} [params.zSupply=0.15] - Полное сопротивление питающего ввода Z_ввода, Ом
 * @returns {number} Минимальный ток КЗ I_кз, А
 */
export function calculateShortCircuit({
  length,
  section,
  material = 'Cu',
  zSupply = 0.15,
}) {
  if (section <= 0) {
    throw new Error('Сечение проводника должно быть больше 0');
  }
  if (length < 0) {
    throw new Error('Длина линии не может быть отрицательной');
  }
  if (zSupply < 0) {
    throw new Error('Сопротивление ввода Z_ввода не может быть отрицательным');
  }

  const mat = normalizeMaterial(material);
  const rho20 = RESISTIVITY_20[mat];
  const sPe = getPeSection(section);

  const zLine = 1.5 * rho20 * (length / section + length / sPe);
  const zTotal = zSupply + zLine;
  const ikz = 220 / zTotal;

  return roundTo(ikz, 2);
}

/**
 * Главная функция расчёта кабельной линии
 * @param {object} params
 * @param {number} params.power - Мощность нагрузки (кВт для 1ф/3ф/ПЧ, Вт для 24В DC)
 * @param {string} params.network - Тип сети ('1f' | '3f' | '24dc' | 'vfd')
 * @param {number} params.length - Длина линии, м
 * @param {string} [params.material='Cu'] - Материал жил ('Cu' | 'Al')
 * @param {string} [params.installation='pipe'] - Способ прокладки ('pipe' | 'open')
 * @param {number} [params.cosPhi=0.95] - Коэффициент мощности cosφ
 * @param {number} [params.zSupply=0.15] - Сопротивление ввода Z_ввода, Ом
 * @returns {{
 *   current: number,
 *   breakerRating: number,
 *   section: number,
 *   peSection: number,
 *   allowableCurrent: number,
 *   voltageDropPercent: number,
 *   voltageDropVolts: number,
 *   shortCircuitCurrent: number
 * }}
 */
export function calculateLine({
  power,
  network,
  length,
  material = 'Cu',
  installation = 'pipe',
  cosPhi = 0.95,
  zSupply = 0.15,
}) {
  const current = calculateCurrent({ power, network, cosPhi });
  const breakerRating = selectBreaker(current);
  const { section, allowableCurrent } = selectCableSection({
    breakerRating,
    material,
    installation,
    network,
  });

  const peSection = getPeSection(section);
  const drop = calculateVoltageDrop({
    current,
    length,
    section,
    material,
    network,
  });

  const shortCircuitCurrent = calculateShortCircuit({
    length,
    section,
    material,
    zSupply,
  });

  return {
    current,
    breakerRating,
    section,
    peSection,
    allowableCurrent,
    voltageDropPercent: drop.percent,
    voltageDropVolts: drop.volts,
    shortCircuitCurrent,
  };
}
