/**
 * @file src/ui/shield.js
 * Вкладка 2 — Конструктор электрощита:
 * - управление отходящими линиями (добавить, удалить, дублировать, редактировать);
 * - кнопка «Авторасчёт» (вызывает autosize.js + жадную балансировку фаз phases.js);
 * - фоновая валидация через rules.js с выводом красных/жёлтых алертов ПУЭ вверху списка.
 */

import { store } from '../store.js';
import { BREAKER_RATINGS, SECTIONS_CU, SECTIONS_AL } from '../norms.js';
import { autosizeShield, autosizeLine, recalculateLineMetrics } from '../autosize.js';
import { calculatePhaseSummary } from '../phases.js';
import { audit } from '../rules.js';
import { renderDinRail } from '../din.js';
import { generateSingleLineSvg, exportSvgToPng, downloadBomCsv } from '../export.js';

/**
 * Генератор уникального идентификатора линии
 */
function nextLineId(lines) {
  const maxNum = lines.reduce((acc, l) => {
    const m = String(l.id || '').match(/(\d+)$/);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `QF${maxNum + 1}`;
}

/**
 * Создаёт новую линию по умолчанию (и сразу рассчитывает её базовые параметры)
 * @param {Array<object>} existingLines
 * @param {number} [zSupply=0.15]
 * @returns {object}
 */
export function createNewLine(existingLines = [], zSupply = 0.15) {
  const id = nextLineId(existingLines);
  const index = existingLines.length + 1;
  const line = {
    id,
    name: `Линия ${index}`,
    network: '1f',
    power: 2.0,
    length: 20,
    material: 'Cu',
    installation: 'pipe',
    cosPhi: 0.95,
    phase: 'L1',
    curve: 'C',
    breakerRating: 16,
    section: 1.5,
    peSection: 1.5,
    switching: 'none', // 'none' | 'contactor' | 'vfd' | 'relay'
    rcd: {
      enabled: false,
      type: 'A',
      in: 25,
      leakage: 30,
    },
  };

  return autosizeLine(line, zSupply);
}

/**
 * Собирает контекст щита из стейта для передачи в audit(context)
 */
export function buildAuditContext(state) {
  const settings = state.settings || {};
  const zSupply = Number(settings.zSupply) || 0.15;
  const lines = (state.lines || []).map((line) => ({
    ...line,
    hasVfd: line.network === 'vfd' || line.switching === 'vfd',
    rcd: line.rcd && line.rcd.enabled ? line.rcd : null,
  }));

  return {
    zSupply,
    inputBreakerRating: Number(settings.inputBreakerRating) || 40,
    inputRcd: settings.inputRcd && settings.inputRcd.enabled ? settings.inputRcd : null,
    psu24: settings.psu24 && settings.psu24.enabled ? { power: Number(settings.psu24.power) || 120 } : null,
    plcPower: Number(settings.plcPower) || 0,
    relaysPower: Number(settings.relaysPower) || 0,
    lines,
  };
}

/**
 * Отрисовка блока алертов ПУЭ вверху конструктора щита
 */
function renderAlertsBanner(container, verdicts) {
  if (!container) return;

  if (!verdicts || verdicts.length === 0) {
    container.innerHTML = `
      <div class="shield-alert status-ok">
        <strong>✓ ПУЭ в норме:</strong> ошибок селективности, сечений, токов КЗ и баланса 24В не обнаружено.
      </div>
    `;
    return;
  }

  container.innerHTML = verdicts
    .map((v) => {
      const cls = v.severity === 'error' ? 'status-error' : 'status-warning';
      const icon = v.severity === 'error' ? '⛔' : '⚠️';
      return `
        <div class="shield-alert ${cls}">
          <span class="alert-code">[${v.id}]</span>
          <span>${icon} ${v.message}</span>
        </div>
      `;
    })
    .join('');
}

/**
 * Отрисовка сводки по фазам L1 / L2 / L3 и перекосу фаз
 */
function renderPhaseBar(refs, lines) {
  const summary = calculatePhaseSummary(lines);
  if (refs.phaseL1) refs.phaseL1.innerText = `${summary.L1.toFixed(1)} А`;
  if (refs.phaseL2) refs.phaseL2.innerText = `${summary.L2.toFixed(1)} А`;
  if (refs.phaseL3) refs.phaseL3.innerText = `${summary.L3.toFixed(1)} А`;
  if (refs.phaseUnbalance) {
    refs.phaseUnbalance.innerText = `${summary.unbalancePercent.toFixed(1)}%`;
    refs.phaseUnbalance.classList.remove('status-ok', 'status-warning', 'status-error');
    const level =
      summary.unbalancePercent > 30
        ? 'status-error'
        : summary.unbalancePercent > 15
          ? 'status-warning'
          : 'status-ok';
    refs.phaseUnbalance.classList.add(level);
  }
}

/**
 * Генерирует HTML-карточку одной линии щита
 */
function createLineCardElement(line, index) {
  const card = document.createElement('div');
  card.className = 'card shield-line-card';
  card.dataset.index = String(index);
  card.dataset.lineId = line.id;

  const sectionsList = line.material === 'Al' ? SECTIONS_AL : SECTIONS_CU;
  const rcdMode = !line.rcd || !line.rcd.enabled ? 'none' : line.rcd.type || 'A';

  card.innerHTML = `
    <div class="line-card-header">
      <div class="line-id-group">
        <span class="line-badge">${line.id}</span>
        <input
          type="text"
          class="control control-compact line-name-input"
          data-field="name"
          value="${line.name || ''}"
          placeholder="Название линии"
        />
      </div>
      <div class="line-actions">
        <button type="button" class="btn-icon" data-action="duplicate" title="Дублировать линию">⧉</button>
        <button type="button" class="btn-icon btn-danger" data-action="delete" title="Удалить линию">✕</button>
      </div>
    </div>

    <div class="form-grid line-form-grid">
      <div class="form-group">
        <label>Сеть / Тип</label>
        <select class="control" data-field="network">
          <option value="1f" ${line.network === '1f' ? 'selected' : ''}>1ф 220В</option>
          <option value="3f" ${line.network === '3f' ? 'selected' : ''}>3ф 380В</option>
          <option value="vfd" ${line.network === 'vfd' ? 'selected' : ''}>ПЧ (1ф→3ф)</option>
          <option value="24dc" ${line.network === '24dc' ? 'selected' : ''}>24В DC</option>
        </select>
      </div>

      <div class="form-group">
        <label class="js-power-label">${line.network === '24dc' ? 'Мощность, Вт' : 'Мощность, кВт'}</label>
        <input
          type="number"
          inputmode="decimal"
          step="0.1"
          min="0.01"
          class="control tabular-nums"
          data-field="power"
          value="${line.power ?? 1.5}"
        />
      </div>

      <div class="form-group">
        <label>Длина, м</label>
        <input
          type="number"
          inputmode="decimal"
          step="1"
          min="1"
          class="control tabular-nums"
          data-field="length"
          value="${line.length ?? 20}"
        />
      </div>

      <div class="form-group">
        <label>Фаза</label>
        <select class="control" data-field="phase" ${line.network === '3f' || line.network === '24dc' ? 'disabled' : ''}>
          <option value="L1" ${line.phase === 'L1' ? 'selected' : ''}>L1</option>
          <option value="L2" ${line.phase === 'L2' ? 'selected' : ''}>L2</option>
          <option value="L3" ${line.phase === 'L3' ? 'selected' : ''}>L3</option>
          <option value="L1-L2-L3" ${line.network === '3f' || line.phase === 'L1-L2-L3' ? 'selected' : ''}>L1-L2-L3</option>
          <option value="DC" ${line.network === '24dc' || line.phase === 'DC' ? 'selected' : ''}>24V DC</option>
        </select>
      </div>

      <div class="form-group">
        <label>Автомат (кривая / In)</label>
        <div class="inline-pair">
          <select class="control" data-field="curve">
            <option value="B" ${line.curve === 'B' ? 'selected' : ''}>B</option>
            <option value="C" ${line.curve === 'C' ? 'selected' : ''}>C</option>
            <option value="D" ${line.curve === 'D' ? 'selected' : ''}>D</option>
            <option value="АЗД" ${line.curve === 'АЗД' ? 'selected' : ''}>АЗД</option>
          </select>
          <select class="control tabular-nums" data-field="breakerRating">
            ${BREAKER_RATINGS.map(
              (r) => `<option value="${r}" ${Number(line.breakerRating) === r ? 'selected' : ''}>${r} А</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>Кабель (жила / мм²)</label>
        <div class="inline-pair">
          <select class="control" data-field="material">
            <option value="Cu" ${line.material !== 'Al' ? 'selected' : ''}>Cu</option>
            <option value="Al" ${line.material === 'Al' ? 'selected' : ''}>Al</option>
          </select>
          <select class="control tabular-nums" data-field="section">
            ${sectionsList
              .map(
                (s) => `<option value="${s}" ${Number(line.section) === s ? 'selected' : ''}>${s}</option>`
              )
              .join('')}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>Коммутация</label>
        <select class="control" data-field="switching">
          <option value="none" ${line.switching === 'none' ? 'selected' : ''}>Нет (прямое)</option>
          <option value="contactor" ${line.switching === 'contactor' ? 'selected' : ''}>Контактор КМ</option>
          <option value="vfd" ${line.switching === 'vfd' ? 'selected' : ''}>ПЧ (Частотник)</option>
          <option value="relay" ${line.switching === 'relay' ? 'selected' : ''}>Реле 24В</option>
        </select>
      </div>

      <div class="form-group">
        <label>Дифзащита (УЗО 30мА)</label>
        <select class="control" data-field="rcdMode">
          <option value="none" ${rcdMode === 'none' ? 'selected' : ''}>Без УЗО</option>
          <option value="A" ${rcdMode === 'A' ? 'selected' : ''}>УЗО тип A (30 мА)</option>
          <option value="AC" ${rcdMode === 'AC' ? 'selected' : ''}>УЗО тип AC (30 мА)</option>
          <option value="B" ${rcdMode === 'B' ? 'selected' : ''}>УЗО тип B (30 мА)</option>
        </select>
      </div>
    </div>

    <div class="line-metrics-strip tabular-nums">
      <span>I<sub>р</sub>: <strong class="js-m-current">${(Number(line.current) || 0).toFixed(2)}</strong> А</span>
      <span>I<sub>доп</sub>: <strong class="js-m-idop">${line.allowableCurrent ?? '—'}</strong> А</span>
      <span>ΔU: <strong class="js-m-vdrop">${(Number(line.voltageDropPercent) || 0).toFixed(2)}</strong>%</span>
      <span>I<sub>кз</sub>: <strong class="js-m-ikz">${line.network === '24dc' ? '—' : (Number(line.shortCircuitCurrent) || 0).toFixed(0)}</strong> А</span>
    </div>
  `;

  return card;
}

/**
 * Обновляет только числовые метрики внутри уже существующей карточки линии (без потери фокуса инпута!)
 */
function updateLineCardMetricsOnly(cardEl, line) {
  if (!cardEl || !line) return;
  const curEl = cardEl.querySelector('.js-m-current');
  const idopEl = cardEl.querySelector('.js-m-idop');
  const vdropEl = cardEl.querySelector('.js-m-vdrop');
  const ikzEl = cardEl.querySelector('.js-m-ikz');
  const powerLabel = cardEl.querySelector('.js-power-label');

  if (curEl) curEl.innerText = (Number(line.current) || 0).toFixed(2);
  if (idopEl) idopEl.innerText = String(line.allowableCurrent ?? '—');
  if (vdropEl) vdropEl.innerText = (Number(line.voltageDropPercent) || 0).toFixed(2);
  if (ikzEl) {
    ikzEl.innerText =
      line.network === '24dc' ? '—' : (Number(line.shortCircuitCurrent) || 0).toFixed(0);
  }
  if (powerLabel) {
    powerLabel.innerText = line.network === '24dc' ? 'Мощность, Вт' : 'Мощность, кВт';
  }
}

/**
 * Инициализация UI Вкладки 2 (Конструктор щита)
 */
export function initShieldUI() {
  const shieldSection = document.getElementById('tab-shield');
  if (!shieldSection) return;

  // Создаём статический каркас Вкладки 2 один раз
  shieldSection.innerHTML = `
    <div id="shield-alerts-container" class="shield-alerts-container"></div>

    <!-- Карточка вводных аппаратов и баланса фаз -->
    <div class="card">
      <div class="result-header">
        <h2 class="card-title">Ввод щита и баланс фаз</h2>
        <button type="button" id="btn-autosize" class="btn-primary">⚙️ Авторасчёт</button>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label for="shield-input-breaker">Вводной автомат, А</label>
          <select id="shield-input-breaker" class="control tabular-nums">
            ${BREAKER_RATINGS.map((r) => `<option value="${r}">${r} А</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="shield-input-rcd">Вводное УЗО</label>
          <select id="shield-input-rcd" class="control">
            <option value="A-S_100">Селективное S (100 мА)</option>
            <option value="A-S_300">Селективное S (300 мА)</option>
            <option value="AC_30">Обычное AC (30 мА)</option>
            <option value="none">Без вводного УЗО</option>
          </select>
        </div>

        <div class="form-group">
          <label for="shield-psu-power">БП 24В DC, Вт</label>
          <input id="shield-psu-power" type="number" step="10" min="15" value="120" class="control tabular-nums" />
        </div>

        <div class="form-group">
          <label for="shield-plc-power">ПЛК + Реле 24В, Вт</label>
          <input id="shield-plc-power" type="number" step="5" min="0" value="40" class="control tabular-nums" />
        </div>
      </div>

      <div class="phase-summary-grid tabular-nums">
        <div class="phase-pill"><span>L1:</span> <strong id="phase-val-l1">0.0 А</strong></div>
        <div class="phase-pill"><span>L2:</span> <strong id="phase-val-l2">0.0 А</strong></div>
        <div class="phase-pill"><span>L3:</span> <strong id="phase-val-l3">0.0 А</strong></div>
        <div class="phase-pill"><span>Перекос:</span> <strong id="phase-val-unbalance" class="status-pill status-ok">0.0%</strong></div>
      </div>
    </div>

    <!-- Заголовок списка линий и кнопка добавления -->
    <div class="lines-toolbar">
      <h2 class="card-title">Отходящие линии (<span id="shield-lines-count">0</span>)</h2>
      <button type="button" id="btn-add-line" class="btn-secondary">+ Добавить линию</button>
    </div>

    <div id="shield-lines-list" class="shield-lines-list"></div>
  `;

  const refs = {
    alertsContainer: document.getElementById('shield-alerts-container'),
    btnAutosize: document.getElementById('btn-autosize'),
    btnAddLine: document.getElementById('btn-add-line'),
    inputBreakerSelect: document.getElementById('shield-input-breaker'),
    inputRcdSelect: document.getElementById('shield-input-rcd'),
    psuPowerInput: document.getElementById('shield-psu-power'),
    plcPowerInput: document.getElementById('shield-plc-power'),
    phaseL1: document.getElementById('phase-val-l1'),
    phaseL2: document.getElementById('phase-val-l2'),
    phaseL3: document.getElementById('phase-val-l3'),
    phaseUnbalance: document.getElementById('phase-val-unbalance'),
    linesCount: document.getElementById('shield-lines-count'),
    linesList: document.getElementById('shield-lines-list'),
  };

  /**
   * Полный рендер списка карточек линий (при добавлении, удалении, дублировании, авторасчёте или init)
   */
  function renderLinesListFull() {
    const lines = store.state.lines || [];
    refs.linesCount.innerText = String(lines.length);
    refs.linesList.innerHTML = '';

    if (lines.length === 0) {
      refs.linesList.innerHTML = `
        <div class="card empty-shield-card">
          <p class="muted-text">В щите пока нет отходящих линий. Нажмите «+ Добавить линию» для начала проектирования.</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    lines.forEach((line, idx) => {
      fragment.appendChild(createLineCardElement(line, idx));
    });
    refs.linesList.appendChild(fragment);
  }

  /**
   * Синхронизация шапки настроек щита, фаз и фонового аудита ПУЭ
   */
  function refreshShieldStatus() {
    const settings = store.state.settings || {};
    const activeEl = document.activeElement;

    if (refs.inputBreakerSelect && activeEl !== refs.inputBreakerSelect) {
      refs.inputBreakerSelect.value = String(settings.inputBreakerRating || 40);
    }
    if (refs.psuPowerInput && activeEl !== refs.psuPowerInput) {
      refs.psuPowerInput.value = String(settings.psu24?.power ?? 120);
    }
    if (refs.plcPowerInput && activeEl !== refs.plcPowerInput) {
      const sum24 = (Number(settings.plcPower) || 0) + (Number(settings.relaysPower) || 0);
      refs.plcPowerInput.value = String(sum24);
    }

    renderPhaseBar(refs, store.state.lines || []);

    const auditCtx = buildAuditContext(store.state);
    const verdicts = audit(auditCtx);
    renderAlertsBanner(refs.alertsContainer, verdicts);
  }

  // Кнопка «+ Добавить линию»
  refs.btnAddLine.addEventListener('click', () => {
    const zSupply = store.state.settings?.zSupply ?? 0.15;
    const newLine = createNewLine(store.state.lines, zSupply);
    store.state.lines.push(newLine);
    renderLinesListFull();
    refreshShieldStatus();
  });

  // Кнопка «Авторасчёт» — запускает autosizeShield (включая жадную балансировку фаз)
  refs.btnAutosize.addEventListener('click', () => {
    autosizeShield(store.state);
    renderLinesListFull();
    refreshShieldStatus();
  });

  // Изменение параметров вводного щита
  refs.inputBreakerSelect.addEventListener('change', (e) => {
    store.state.settings.inputBreakerRating = Number(e.target.value);
    refreshShieldStatus();
  });

  refs.inputRcdSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'none') {
      store.state.settings.inputRcd.enabled = false;
    } else if (val === 'AC_30') {
      store.state.settings.inputRcd.enabled = true;
      store.state.settings.inputRcd.type = 'AC';
      store.state.settings.inputRcd.selective = false;
      store.state.settings.inputRcd.leakage = 30;
    } else {
      const leakage = val === 'A-S_300' ? 300 : 100;
      store.state.settings.inputRcd.enabled = true;
      store.state.settings.inputRcd.type = 'A-S';
      store.state.settings.inputRcd.selective = true;
      store.state.settings.inputRcd.leakage = leakage;
    }
    refreshShieldStatus();
  });

  refs.psuPowerInput.addEventListener('input', (e) => {
    store.state.settings.psu24.power = parseFloat(e.target.value) || 0;
    refreshShieldStatus();
  });

  refs.plcPowerInput.addEventListener('input', (e) => {
    store.state.settings.plcPower = parseFloat(e.target.value) || 0;
    store.state.settings.relaysPower = 0;
    refreshShieldStatus();
  });

  // Делегирование кликов по кнопкам «Дублировать» и «Удалить» в списке линий
  refs.linesList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const card = btn.closest('.shield-line-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    const lines = store.state.lines;
    if (!lines[index]) return;

    const action = btn.dataset.action;
    if (action === 'delete') {
      lines.splice(index, 1);
      renderLinesListFull();
      refreshShieldStatus();
    } else if (action === 'duplicate') {
      const clone = JSON.parse(JSON.stringify(lines[index]));
      clone.id = nextLineId(lines);
      clone.name = `${lines[index].name} (копия)`;
      lines.splice(index + 1, 0, clone);
      renderLinesListFull();
      refreshShieldStatus();
    }
  });

  // Делегирование ввода/изменения полей карточки линии (без пересоздания DOM и без авто-переброса фаз!)
  const handleLineFieldEvent = (e) => {
    const target = e.target;
    const field = target.dataset?.field;
    if (!field) return;

    const card = target.closest('.shield-line-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    const line = store.state.lines[index];
    if (!line) return;

    if (field === 'name') {
      line.name = target.value;
    } else if (field === 'power' || field === 'length') {
      line[field] = parseFloat(target.value) || 0;
    } else if (field === 'breakerRating' || field === 'section') {
      line[field] = parseFloat(target.value);
    } else if (field === 'rcdMode') {
      if (target.value === 'none') {
        line.rcd.enabled = false;
      } else {
        line.rcd.enabled = true;
        line.rcd.type = target.value;
        line.rcd.in = Math.max(Number(line.breakerRating) || 16, 25);
        line.rcd.leakage = 30;
      }
    } else {
      line[field] = target.value;
      if (field === 'network') {
        if (target.value === '3f') line.phase = 'L1-L2-L3';
        else if (target.value === '24dc') line.phase = 'DC';
        else if (!['L1', 'L2', 'L3'].includes(line.phase)) line.phase = 'L1';
      }
    }

    recalculateLineMetrics(line, store.state.settings?.zSupply ?? 0.15);

    if (field === 'material' || field === 'network') {
      renderLinesListFull();
    } else {
      updateLineCardMetricsOnly(card, line);
    }

    refreshShieldStatus();
  };

  refs.linesList.addEventListener('input', handleLineFieldEvent);
  refs.linesList.addEventListener('change', handleLineFieldEvent);

  // Подписка на инициализацию/сброс Store и переключение на вкладку Аудит/Экспорт
  const auditSection = document.getElementById('tab-audit');
  if (auditSection) {
    auditSection.innerHTML = `
      <div class="card">
        <h2 class="card-title">Интерактивная DIN-рейка (1 мод = 18 мм)</h2>
        <p class="muted-text" style="margin-bottom: 12px;">Нажмите на любой отходящий автомат QF для включения/отключения нагрузки и проверки токов по фазам.</p>
        <div id="din-rail-mount"></div>
      </div>

      <div class="card">
        <div class="result-header">
          <h2 class="card-title">Однолинейная схема и Спецификация</h2>
          <div class="export-actions-bar">
            <button type="button" id="btn-export-png" class="btn-primary">🖼 Скачать PNG</button>
            <button type="button" id="btn-export-csv" class="btn-secondary">📄 Спецификация CSV</button>
          </div>
        </div>
        <div id="svg-schema-mount" class="svg-preview-box"></div>
      </div>
    `;
  }

  const dinMount = document.getElementById('din-rail-mount');
  const svgMount = document.getElementById('svg-schema-mount');
  const btnExportPng = document.getElementById('btn-export-png');
  const btnExportCsv = document.getElementById('btn-export-csv');

  function renderDinAndSchema() {
    if (dinMount) {
      renderDinRail(dinMount, store.state, () => {
        renderPhaseBar(refs, store.state.lines || []);
        if (svgMount) {
          svgMount.innerHTML = generateSingleLineSvg(store.state);
        }
      });
    }
    if (svgMount) {
      svgMount.innerHTML = generateSingleLineSvg(store.state);
    }
  }

  btnExportPng?.addEventListener('click', () => {
    const svgEl = svgMount?.querySelector('svg');
    if (svgEl) {
      exportSvgToPng(svgEl, 'electro-shield-schema.png');
    }
  });

  btnExportCsv?.addEventListener('click', () => {
    downloadBomCsv(store.state, 'electro-shield-spec.csv');
  });

  store.subscribe((currentState, meta) => {
    if (meta.path === 'init' || meta.path === 'reset') {
      renderLinesListFull();
      refreshShieldStatus();
      renderDinAndSchema();
    } else if (meta.path === 'activeTab' && currentState.activeTab === 'audit') {
      renderDinAndSchema();
    }
  });

  renderLinesListFull();
  refreshShieldStatus();
  renderDinAndSchema();
}

