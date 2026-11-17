/**
 * @file src/export.js
 * Генерация однолинейной схемы в SVG (с xmlns="http://www.w3.org/2000/svg"),
 * экспорт SVG в PNG через скрытый <canvas> с XMLSerializer и инлайнингом CSS-стилей,
 * и экспорт спецификации щита в CSV с UTF-8 BOM (\uFEFF) и разделителем ';'.
 */

import { calculateDinLayout } from './din.js';
import { calculatePhaseSummary } from './phases.js';
import { normalizeNetwork } from './calc.js';

/**
 * Экранирование спецсимволов для безопасной вставки в XML / SVG
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Генерация однолинейной расчётной схемы щита в формате SVG.
 * Обязательно содержит атрибут xmlns="http://www.w3.org/2000/svg" и полные инлайн-стили.
 *
 * @param {object} state - Состояние щита
 * @returns {string} Строка SVG-разметки
 */
export function generateSingleLineSvg(state = {}) {
  const settings = state.settings || {};
  const lines = Array.isArray(state.lines) ? state.lines : [];
  const dinLayout = calculateDinLayout(state);
  const phaseSummary = calculatePhaseSummary(lines);

  const colWidth = 170;
  const leftMargin = 80;
  const rightMargin = 60;
  const count = Math.max(lines.length, 1);
  const svgWidth = Math.max(760, leftMargin + count * colWidth + rightMargin);
  const svgHeight = 540;
  const busY = 175;
  const centerX = Math.round(svgWidth / 2);

  const linesSvg = lines
    .map((line, i) => {
      const x = leftMargin + i * colWidth + Math.round(colWidth / 2);
      const isEnabled = line.enabled !== false;
      const strokeColor = isEnabled ? '#F3F4F6' : '#6B7280';
      const accentColor = isEnabled ? '#D32F2F' : '#6B7280';
      const net = normalizeNetwork(line.network || '1f');
      const slashCount = net === '3f' ? 3 : 2;

      const slashes = Array.from({ length: slashCount }, (_, sIdx) => {
        const sy = 212 + sIdx * 6;
        return `<line x1="${x - 6}" y1="${sy + 4}" x2="${x + 6}" y2="${sy - 4}" stroke="#9CA3AF" stroke-width="1.5" style="stroke:#9CA3AF;stroke-width:1.5px;" />`;
      }).join('');

      const rcdBlock =
        line.rcd && line.rcd.enabled
          ? `<rect x="${x - 28}" y="280" width="56" height="24" rx="4" fill="#1C1E24" stroke="#4FC3F7" stroke-width="1.5" style="fill:#1C1E24;stroke:#4FC3F7;stroke-width:1.5px;" />
             <text x="${x}" y="296" text-anchor="middle" fill="#4FC3F7" font-family="Arial, sans-serif" font-size="10" font-weight="bold" style="fill:#4FC3F7;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;">УЗО ${escapeXml(line.rcd.type)} ${line.rcd.leakage}мА</text>`
          : '';

      const swBlock =
        line.switching && line.switching !== 'none'
          ? `<rect x="${x - 28}" y="312" width="56" height="22" rx="4" fill="#1C1E24" stroke="#FFB74D" stroke-width="1.5" style="fill:#1C1E24;stroke:#FFB74D;stroke-width:1.5px;" />
             <text x="${x}" y="327" text-anchor="middle" fill="#FFB74D" font-family="Arial, sans-serif" font-size="10" font-weight="bold" style="fill:#FFB74D;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;">${line.switching === 'vfd' ? 'ПЧ (UZ)' : line.switching === 'contactor' ? 'КМ' : 'Реле KL'}</text>`
          : '';

      return `
        <g class="sld-feeder">
          <!-- Узел подключения к шине -->
          <circle cx="${x}" cy="${busY}" r="4" fill="${accentColor}" style="fill:${accentColor};" />
          <line x1="${x}" y1="${busY}" x2="${x}" y2="235" stroke="${strokeColor}" stroke-width="2" style="stroke:${strokeColor};stroke-width:2px;" />
          ${slashes}
          <text x="${x + 10}" y="200" fill="#FFB74D" font-family="Arial, sans-serif" font-size="11" font-weight="bold" style="fill:#FFB74D;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;">${escapeXml(line.phase || 'L1')}</text>

          <!-- Автоматический выключатель QF -->
          <line x1="${x}" y1="235" x2="${x - 10}" y2="258" stroke="${accentColor}" stroke-width="2.5" style="stroke:${accentColor};stroke-width:2.5px;" />
          <circle cx="${x}" cy="262" r="3" fill="${strokeColor}" style="fill:${strokeColor};" />
          <text x="${x + 12}" y="248" fill="#F3F4F6" font-family="Arial, sans-serif" font-size="11" font-weight="bold" style="fill:#F3F4F6;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;">${escapeXml(line.id || `QF${i + 1}`)}</text>
          <text x="${x + 12}" y="262" fill="#9CA3AF" font-family="Arial, sans-serif" font-size="10" style="fill:#9CA3AF;font-family:Arial,sans-serif;font-size:10px;">${escapeXml(line.curve || 'C')}${line.breakerRating || 16}А ${isEnabled ? '' : '(ОТКЛ)'}</text>

          <!-- Линия до потребителя -->
          <line x1="${x}" y1="262" x2="${x}" y2="395" stroke="${strokeColor}" stroke-width="2" style="stroke:${strokeColor};stroke-width:2px;" />
          ${rcdBlock}
          ${swBlock}

          <!-- Параметры кабеля и расчёта -->
          <rect x="${x - 74}" y="344" width="148" height="46" rx="5" fill="#14161B" stroke="#2A2D36" stroke-width="1" style="fill:#14161B;stroke:#2A2D36;stroke-width:1px;" />
          <text x="${x}" y="359" text-anchor="middle" fill="#F3F4F6" font-family="Arial, sans-serif" font-size="10" font-weight="bold" style="fill:#F3F4F6;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;">
            ${escapeXml(line.material || 'Cu')} ${line.section || 1.5} мм² · L=${line.length || 0}м
          </text>
          <text x="${x}" y="373" text-anchor="middle" fill="#9CA3AF" font-family="Arial, sans-serif" font-size="10" style="fill:#9CA3AF;font-family:Arial,sans-serif;font-size:10px;">
            Iр=${(Number(line.current) || 0).toFixed(1)}А · ΔU=${(Number(line.voltageDropPercent) || 0).toFixed(1)}%
          </text>
          <text x="${x}" y="385" text-anchor="middle" fill="#9CA3AF" font-family="Arial, sans-serif" font-size="9" style="fill:#9CA3AF;font-family:Arial,sans-serif;font-size:9px;">
            Iкз=${net === '24dc' ? '—' : (Number(line.shortCircuitCurrent) || 0).toFixed(0)}А · P=${line.power || 0}${net === '24dc' ? 'Вт' : 'кВт'}
          </text>

          <!-- Потребитель -->
          <circle cx="${x}" cy="414" r="14" fill="#1C1E24" stroke="${strokeColor}" stroke-width="2" style="fill:#1C1E24;stroke:${strokeColor};stroke-width:2px;" />
          <text x="${x}" y="418" text-anchor="middle" fill="#F3F4F6" font-family="Arial, sans-serif" font-size="10" font-weight="bold" style="fill:#F3F4F6;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;">${net === '3f' ? 'M3~' : net === '24dc' ? '24V' : '1~'}</text>
          <text x="${x}" y="444" text-anchor="middle" fill="#F3F4F6" font-family="Arial, sans-serif" font-size="11" font-weight="bold" style="fill:#F3F4F6;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;">
            ${escapeXml((line.name || `Линия ${i + 1}`).slice(0, 20))}
          </text>
        </g>
      `;
    })
    .join('');

  const busStartX = leftMargin - 10;
  const busEndX = svgWidth - rightMargin + 10;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="background-color:#121316;font-family:Arial,sans-serif;">
    <rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="#121316" style="fill:#121316;" />

    <!-- Заголовок однолинейной схемы -->
    <text x="24" y="32" fill="#F3F4F6" font-family="Arial, sans-serif" font-size="16" font-weight="bold" style="fill:#F3F4F6;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
      Однолинейная расчётная схема: ${escapeXml(settings.projectName || 'Щит ЩУ-1')}
    </text>
    <text x="24" y="50" fill="#9CA3AF" font-family="Arial, sans-serif" font-size="11" style="fill:#9CA3AF;font-family:Arial,sans-serif;font-size:11px;">
      Ввод: QF0 ${escapeXml(settings.inputBreakerCurve || 'C')}${settings.inputBreakerRating || 40}А · Zввода = ${settings.zSupply || 0.15} Ом · Корпус: ${dinLayout.enclosureSize} мод. (занято ${dinLayout.usedModules} мод. + 20% запас)
    </text>

    <!-- Вводной узел QF0 + FD0 -->
    <line x1="${centerX}" y1="62" x2="${centerX}" y2="92" stroke="#F3F4F6" stroke-width="2.5" style="stroke:#F3F4F6;stroke-width:2.5px;" />
    <line x1="${centerX}" y1="92" x2="${centerX - 12}" y2="118" stroke="#D32F2F" stroke-width="3" style="stroke:#D32F2F;stroke-width:3px;" />
    <circle cx="${centerX}" cy="122" r="4" fill="#F3F4F6" style="fill:#F3F4F6;" />
    <text x="${centerX + 16}" y="106" fill="#F3F4F6" font-family="Arial, sans-serif" font-size="12" font-weight="bold" style="fill:#F3F4F6;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;">
      QF0 ${escapeXml(settings.inputBreakerCurve || 'C')}${settings.inputBreakerRating || 40}А
    </text>
    ${
      settings.inputRcd && settings.inputRcd.enabled !== false
        ? `<text x="${centerX + 16}" y="122" fill="#4FC3F7" font-family="Arial, sans-serif" font-size="11" style="fill:#4FC3F7;font-family:Arial,sans-serif;font-size:11px;">
            FD0 УЗО ${settings.inputRcd.in || 63}А / ${settings.inputRcd.leakage || 100}мА (${escapeXml(settings.inputRcd.type || 'A-S')})
          </text>`
        : ''
    }
    <line x1="${centerX}" y1="122" x2="${centerX}" y2="${busY}" stroke="#F3F4F6" stroke-width="2.5" style="stroke:#F3F4F6;stroke-width:2.5px;" />

    <!-- Распределительные шины L1, L2, L3, N, PE -->
    <line x1="${busStartX}" y1="${busY}" x2="${busEndX}" y2="${busY}" stroke="#D32F2F" stroke-width="3.5" style="stroke:#D32F2F;stroke-width:3.5px;" />
    <line x1="${busStartX}" y1="${busY + 6}" x2="${busEndX}" y2="${busY + 6}" stroke="#4FC3F7" stroke-width="1.5" stroke-dasharray="6,4" style="stroke:#4FC3F7;stroke-width:1.5px;" />
    <line x1="${busStartX}" y1="${busY + 12}" x2="${busEndX}" y2="${busY + 12}" stroke="#81C784" stroke-width="1.5" stroke-dasharray="10,3,2,3" style="stroke:#81C784;stroke-width:1.5px;" />
    <text x="20" y="${busY + 4}" fill="#EF9A9A" font-family="Arial, sans-serif" font-size="11" font-weight="bold" style="fill:#EF9A9A;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;">L1/L2/L3</text>
    <text x="20" y="${busY + 16}" fill="#81C784" font-family="Arial, sans-serif" font-size="10" style="fill:#81C784;font-family:Arial,sans-serif;font-size:10px;">N / PE</text>

    <!-- Отходящие линии -->
    ${linesSvg}

    <!-- Нижний штамп (баланс фаз и подпись) -->
    <rect x="20" y="472" width="${svgWidth - 40}" height="52" rx="6" fill="#1C1E24" stroke="#2A2D36" stroke-width="1.5" style="fill:#1C1E24;stroke:#2A2D36;stroke-width:1.5px;" />
    <text x="36" y="494" fill="#F3F4F6" font-family="Arial, sans-serif" font-size="12" font-weight="bold" style="fill:#F3F4F6;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;">
      Токи по фазам: L1 = ${phaseSummary.L1.toFixed(1)} А | L2 = ${phaseSummary.L2.toFixed(1)} А | L3 = ${phaseSummary.L3.toFixed(1)} А | Перекос фаз: ${phaseSummary.unbalancePercent.toFixed(1)}%
    </text>
    <text x="36" y="512" fill="#9CA3AF" font-family="Arial, sans-serif" font-size="11" style="fill:#9CA3AF;font-family:Arial,sans-serif;font-size:11px;">
      БП 24В: ${settings.psu24?.power || 120} Вт (нагрузка ПЛК+реле: ${(Number(settings.plcPower) || 0) + (Number(settings.relaysPower) || 0)} Вт) · Сформировано в PWA «ЭлектроЩит»
    </text>
  </svg>`;
}

/**
 * Рекурсивно инлайнит вычисленные CSS-стили в клон SVG-элемента перед сериализацией через XMLSerializer,
 * чтобы при рендере на <canvas> PNG гарантированно сохранял цвета, шрифты и толщину линий.
 *
 * @param {Element} sourceEl
 * @param {Element} cloneEl
 */
export function inlineSvgStyles(sourceEl, cloneEl) {
  const styleProps = [
    'fill',
    'stroke',
    'stroke-width',
    'stroke-dasharray',
    'font-family',
    'font-size',
    'font-weight',
    'text-anchor',
    'opacity',
  ];

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const computed = window.getComputedStyle(sourceEl);
    const inlineList = [];

    for (const prop of styleProps) {
      const val = computed.getPropertyValue(prop);
      if (val) {
        inlineList.push(`${prop}:${val}`);
      }
    }

    if (inlineList.length > 0) {
      const existing = cloneEl.getAttribute('style') || '';
      cloneEl.setAttribute('style', `${existing};${inlineList.join(';')}`);
    }
  }

  const srcChildren = sourceEl.children || [];
  const cloneChildren = cloneEl.children || [];
  for (let i = 0; i < srcChildren.length; i++) {
    if (cloneChildren[i]) {
      inlineSvgStyles(srcChildren[i], cloneChildren[i]);
    }
  }
}

/**
 * Экспорт SVG однолинейной схемы в PNG через скрытый <canvas> с использованием XMLSerializer.
 *
 * @param {SVGSVGElement} svgElement - DOM-элемент <svg>
 * @param {string} [filename='electro-shield-schema.png'] - Имя сохраняемого PNG-файла
 * @returns {Promise<Blob>}
 */
export async function exportSvgToPng(svgElement, filename = 'electro-shield-schema.png') {
  if (!svgElement) {
    throw new Error('SVG-элемент для экспорта не найден');
  }

  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Инлайним все CSS-стили элементов перед сериализацией
  inlineSvgStyles(svgElement, clone);

  const width = Number(clone.getAttribute('width')) || svgElement.clientWidth || 800;
  const height = Number(clone.getAttribute('height')) || svgElement.clientHeight || 540;

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2; // 2x разрешение для чётких надписей
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;

      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#121316';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error('Не удалось сформировать PNG из Canvas'));
          return;
        }
        const downloadUrl = URL.createObjectURL(pngBlob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
        resolve(pngBlob);
      }, 'image/png');
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err || new Error('Ошибка загрузки сериализованного SVG в Image'));
    };

    img.src = url;
  });
}

/**
 * Формирует строку CSV-спецификации щита и кабельного журнала.
 * Начинается с UTF-8 BOM маркера (\uFEFF) и использует разделитель ';' для корректного открытия кириллицы в Excel.
 *
 * @param {object} state - Состояние щита
 * @returns {string} CSV-строка с BOM
 */
export function generateBomCsv(state = {}) {
  const BOM = '\uFEFF';
  const SEP = ';';
  const din = calculateDinLayout(state);
  const lines = Array.isArray(state.lines) ? state.lines : [];

  const rows = [
    ['Поз.', 'Категория', 'Наименование / Характеристики', 'Кол-во', 'Ед. изм.', 'Модулей DIN (18мм)', 'Примечание'],
    [
      'Корпус',
      'Шкаф / Бокс',
      `Корпус модульный на ${din.enclosureSize} мод. (занято ${din.usedModules} мод. + 20% запас)`,
      '1',
      'шт.',
      String(din.enclosureSize),
      state.settings?.projectName || 'Щит ЩУ-1',
    ],
  ];

  // Все аппараты на DIN-рейке
  for (const dev of din.devices) {
    rows.push([
      dev.id,
      dev.category.toUpperCase(),
      `${dev.title} — ${dev.subtitle}`,
      '1',
      'шт.',
      String(dev.modules),
      `Фаза: ${dev.phaseLabel} (${dev.widthMm} мм)`,
    ]);
  }

  // Кабельные линии
  for (const line of lines) {
    const net = normalizeNetwork(line.network || '1f');
    const coresCount = net === '3f' ? 5 : net === '24dc' ? 2 : 3;
    rows.push([
      `Кабель ${line.id}`,
      'Кабель',
      `Кабель ${line.material || 'Cu'} ${coresCount}х${line.section || 1.5} мм² (PE ${line.peSection || line.section || 1.5} мм²)`,
      String(line.length || 0),
      'м',
      '0',
      `${line.name || 'Линия'} (Iр=${(Number(line.current) || 0).toFixed(2)}А, ΔU=${(Number(line.voltageDropPercent) || 0).toFixed(2)}%)`,
    ]);
  }

  const csvBody = rows
    .map((cols) =>
      cols
        .map((cell) => {
          const clean = String(cell ?? '').replace(/"/g, '""');
          return clean.includes(SEP) || clean.includes('"') || clean.includes('\n')
            ? `"${clean}"`
            : clean;
        })
        .join(SEP)
    )
    .join('\r\n');

  return BOM + csvBody;
}

/**
 * Скачивание спецификации щита в CSV-файл
 * @param {object} state
 * @param {string} [filename='electro-shield-spec.csv']
 */
export function downloadBomCsv(state, filename = 'electro-shield-spec.csv') {
  const csvContent = generateBomCsv(state);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
