/**
 * @file tests/rules.test.js
 * Модульные тесты движка правил валидации электрощита (Этап 2) на базе node:test и node:assert
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { audit } from '../src/rules.js';

describe('Этап 2: Движок правил валидации электрощита (rules.js)', () => {
  it('C01 (error): срабатывает при заниженном сечении кабеля (I_n > I_доп_скорр)', () => {
    const context = {
      lines: [
        {
          id: 'QF1',
          name: 'Розеточная группа цеха',
          network: '1f',
          material: 'Cu',
          installation: 'pipe',
          section: 1.5, // I_доп = 19 А (в трубе, 2 жилы)
          breakerRating: 25, // 25 А > 19 А -> ошибка C01
        },
      ],
    };

    const verdicts = audit(context);
    const c01 = verdicts.find((v) => v.id === 'C01');

    assert.ok(c01, 'Правило C01 должно сработать');
    assert.equal(c01.severity, 'error');
  });

  it('D01 (error): срабатывает при ошибке селективности УЗО (вышестоящее не типа S и утечка <= нижестоящего)', () => {
    const context = {
      inputRcd: {
        type: 'AC', // не S
        leakage: 30, // 30 мА <= 30 мА
        in: 63,
      },
      lines: [
        {
          id: 'QF2',
          name: 'Линия насоса',
          network: '1f',
          material: 'Cu',
          installation: 'pipe',
          section: 2.5,
          breakerRating: 16,
          rcd: {
            type: 'A',
            leakage: 30,
            in: 25,
          },
        },
      ],
    };

    const verdicts = audit(context);
    const d01 = verdicts.find((v) => v.id === 'D01');

    assert.ok(d01, 'Правило D01 должно сработать');
    assert.equal(d01.severity, 'error');
  });

  it('D01: не срабатывает, когда вышестоящее УЗО типа S и имеет ток утечки больше нижестоящего (100 мА > 30 мА)', () => {
    const context = {
      inputRcd: {
        type: 'A-S',
        selective: true,
        leakage: 100,
        in: 63,
      },
      lines: [
        {
          id: 'QF2',
          name: 'Линия насоса',
          network: '1f',
          material: 'Cu',
          installation: 'pipe',
          section: 2.5,
          breakerRating: 16,
          rcd: {
            type: 'A',
            leakage: 30,
            in: 25,
          },
        },
      ],
    };

    const verdicts = audit(context);
    const d01 = verdicts.find((v) => v.id === 'D01');
    assert.equal(d01, undefined);
  });

  it('Проверяет остальные правила: C03, C04, C06, P05, D03, D05, B01', () => {
    const context = {
      inputBreakerRating: 25, // Для автомата линии 20 А: 25 < 1.6 * 20 (32 А) -> P05 warning
      psu24: { power: 60 }, // 80% = 48 Вт
      plcPower: 30,
      relaysPower: 25, // 30 + 25 = 55 Вт > 48 Вт -> B01 error
      lines: [
        {
          id: 'L1',
          name: 'ПЧ конвейера',
          network: 'vfd',
          material: 'Cu',
          installation: 'pipe',
          section: 1.0, // Силовая цепь Cu < 1.5 мм² -> C03 error
          breakerRating: 20, // 20 А > 14 А (I_доп для 1.0 мм²) -> C01 error
          curve: 'D', // k_max = 20 -> порог 1.1 * 20 * 20 = 440 А
          shortCircuitCurrent: 180, // 180 А < 440 А -> C06 error
          voltageDropPercent: 6.2, // > 5% -> C04 error
          current: 30, // > I_n УЗО (25 А) -> D05 error
          rcd: {
            type: 'AC', // Тип AC на линии с ПЧ -> D03 error
            in: 25,
            leakage: 30,
          },
        },
      ],
    };

    const verdicts = audit(context);
    const ids = verdicts.map((v) => `${v.id}:${v.severity}`);

    assert.ok(ids.includes('C01:error'));
    assert.ok(ids.includes('C03:error'));
    assert.ok(ids.includes('C04:error'));
    assert.ok(ids.includes('C06:error'));
    assert.ok(ids.includes('P05:warning'));
    assert.ok(ids.includes('D03:error'));
    assert.ok(ids.includes('D05:error'));
    assert.ok(ids.includes('B01:error'));
  });
});
