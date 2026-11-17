/**
 * @file tests/calc.test.js
 * Модульные тесты математического ядра (Этап 1) на базе node:test и node:assert
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RESISTIVITY_20,
  BREAKER_RATINGS,
  SECTIONS_CU,
  SECTIONS_AL,
  AMPACITY_CU,
  AMPACITY_AL,
} from '../src/norms.js';

import {
  calculateCurrent,
  calculateVoltageDrop,
  calculateShortCircuit,
  getPeSection,
  selectBreaker,
  selectCableSection,
  calculateLine,
} from '../src/calc.js';

describe('Этап 1: Нормативная база (norms.js)', () => {
  it('содержит полные ряды сечений Cu (0.5..50) и Al (2.5..50) без пропусков', () => {
    assert.deepEqual(SECTIONS_CU, [0.5, 0.75, 1.0, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50]);
    assert.deepEqual(SECTIONS_AL, [2.5, 4, 6, 10, 16, 25, 35, 50]);
    assert.equal(AMPACITY_CU.length, 12);
    assert.equal(AMPACITY_AL.length, 8);
  });

  it('содержит стандартный ряд номиналов автоматов и удельные сопротивления ρ20', () => {
    assert.deepEqual(
      BREAKER_RATINGS,
      [1, 2, 3, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125]
    );
    assert.equal(RESISTIVITY_20.Cu, 0.0175);
    assert.equal(RESISTIVITY_20.Al, 0.028);
  });
});

describe('Этап 1: Расчёт токов, ΔU, I_кз и подбор линии (calc.js)', () => {
  it('1ф 220В, 2 кВт, cosφ 0.95 -> ток 9.57 А', () => {
    const current = calculateCurrent({
      power: 2,
      network: '1f',
      cosPhi: 0.95,
    });
    assert.equal(current, 9.57);
  });

  it('3ф 380В, 5.5 кВт, cosφ 0.85 -> корректный расчёт тока', () => {
    const current = calculateCurrent({
      power: 5.5,
      network: '3f',
      cosPhi: 0.85,
    });
    // 5500 / (1.732 * 380 * 0.85) = 5500 / 559.436 = 9.83 А
    assert.equal(current, 9.83);
  });

  it('24В DC, 120 Вт -> ток 5 А', () => {
    const current = calculateCurrent({
      power: 120,
      network: '24dc',
    });
    assert.equal(current, 5);
  });

  it('Входной ток ПЧ (1ф 220В -> 3ф 220В), двигатель 1.5 кВт -> 15 А', () => {
    const current = calculateCurrent({
      power: 1.5,
      network: 'vfd',
    });
    // (1.5 * 1000 / 220) * 2.2 = 15 А
    assert.equal(current, 15);
  });

  it('ΔU 3ф: 380В, 50м, 20А, Cu 4мм² -> 1.99%', () => {
    const drop = calculateVoltageDrop({
      current: 20,
      length: 50,
      section: 4,
      material: 'Cu',
      network: '3f',
    });
    assert.equal(drop.percent, 1.99);
    assert.equal(drop.volts, 7.58);
  });

  it('Ток КЗ: Cu 1.5мм², 80м, Z_ввода=0.15 -> расчёт по формуле петли фаза-ноль', () => {
    const ikz = calculateShortCircuit({
      length: 80,
      section: 1.5,
      material: 'Cu',
      zSupply: 0.15,
    });
    // По формуле ТЗ: I_кз = 220 / (0.15 + 1.5 * 0.0175 * (80/1.5 + 80/1.5)) = 220 / 2.95 = 74.58 А
    const expected = Math.round((220 / (0.15 + 1.5 * 0.0175 * (80 / 1.5 + 80 / 1.5))) * 100) / 100;
    assert.equal(ikz, expected);
    assert.equal(ikz, 74.58);
  });

  it('Корректно определяет S_PE для малых, средних и крупных сечений', () => {
    assert.equal(getPeSection(1.5), 1.5);
    assert.equal(getPeSection(16), 16);
    assert.equal(getPeSection(25), 16);
    assert.equal(getPeSection(35), 16);
    assert.equal(getPeSection(50), 25);
  });

  it('Комплексный расчёт линии calculateLine()', () => {
    const result = calculateLine({
      power: 2,
      network: '1f',
      length: 25,
      material: 'Cu',
      installation: 'pipe',
      cosPhi: 0.95,
      zSupply: 0.15,
    });

    assert.equal(result.current, 9.57);
    assert.equal(result.breakerRating, 10);
    // Для In = 10 А в трубе (2 нагруженные жилы) минимальное сечение Cu с I_доп >= 10 А: 0.75 мм² (11 А)
    assert.equal(result.section, 0.75);
    assert.equal(result.allowableCurrent, 11);
    assert.ok(result.voltageDropPercent > 0);
    assert.ok(result.shortCircuitCurrent > 0);
  });
});
