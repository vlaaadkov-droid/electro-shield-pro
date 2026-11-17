/**
 * @file src/norms.js
 * Нормативные базы и константы по ПУЭ (7-е изд., табл. 1.3.4, 1.3.5, п. 1.7.126) и ГОСТ 31996.
 */

/**
 * Удельные электрические сопротивления проводников при 20 °C, Ом·мм²/м
 */
export const RESISTIVITY_20 = Object.freeze({
  Cu: 0.0175,
  Al: 0.028,
});

/**
 * Стандартный ряд номинальных токов автоматических выключателей, А
 */
export const BREAKER_RATINGS = Object.freeze([
  1, 2, 3, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125,
]);

/**
 * Стандартные ряды сечений кабельно-проводниковой продукции, мм²
 */
export const SECTIONS_CU = Object.freeze([
  0.5, 0.75, 1.0, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50,
]);

export const SECTIONS_AL = Object.freeze([
  2.5, 4, 6, 10, 16, 25, 35, 50,
]);

/**
 * Допустимые длительные токи для медных проводников (Cu), А (ПУЭ табл. 1.3.4, ГОСТ 31996).
 * Ключи:
 * - pipe.cores2: прокладка в трубе / коробе / скрыто, 2 нагруженные жилы (1ф, 24В DC, вход ПЧ 1ф)
 * - pipe.cores3: прокладка в трубе / коробе / скрыто, 3 нагруженные жилы (3ф)
 * - open.cores2: прокладка открыто, 2 нагруженные жилы (1ф, 24В DC, вход ПЧ 1ф)
 * - open.cores3: прокладка открыто, 3 нагруженные жилы (3ф)
 */
export const AMPACITY_CU = Object.freeze([
  { section: 0.5,  pipe: { cores2: 8,   cores3: 7   }, open: { cores2: 11,  cores3: 10  } },
  { section: 0.75, pipe: { cores2: 11,  cores3: 10  }, open: { cores2: 15,  cores3: 13  } },
  { section: 1.0,  pipe: { cores2: 14,  cores3: 12  }, open: { cores2: 17,  cores3: 15  } },
  { section: 1.5,  pipe: { cores2: 19,  cores3: 17  }, open: { cores2: 23,  cores3: 19  } },
  { section: 2.5,  pipe: { cores2: 27,  cores3: 25  }, open: { cores2: 30,  cores3: 27  } },
  { section: 4,    pipe: { cores2: 38,  cores3: 35  }, open: { cores2: 41,  cores3: 38  } },
  { section: 6,    pipe: { cores2: 46,  cores3: 42  }, open: { cores2: 50,  cores3: 46  } },
  { section: 10,   pipe: { cores2: 70,  cores3: 60  }, open: { cores2: 80,  cores3: 70  } },
  { section: 16,   pipe: { cores2: 85,  cores3: 80  }, open: { cores2: 100, cores3: 90  } },
  { section: 25,   pipe: { cores2: 115, cores3: 100 }, open: { cores2: 140, cores3: 115 } },
  { section: 35,   pipe: { cores2: 135, cores3: 125 }, open: { cores2: 170, cores3: 140 } },
  { section: 50,   pipe: { cores2: 185, cores3: 160 }, open: { cores2: 215, cores3: 175 } },
]);

/**
 * Допустимые длительные токи для алюминиевых проводников (Al), А (ПУЭ табл. 1.3.5, ГОСТ 31996).
 * Сечения от 2.5 до 50 мм².
 */
export const AMPACITY_AL = Object.freeze([
  { section: 2.5, pipe: { cores2: 20,  cores3: 19  }, open: { cores2: 24,  cores3: 20  } },
  { section: 4,   pipe: { cores2: 28,  cores3: 28  }, open: { cores2: 32,  cores3: 28  } },
  { section: 6,   pipe: { cores2: 36,  cores3: 32  }, open: { cores2: 39,  cores3: 36  } },
  { section: 10,  pipe: { cores2: 50,  cores3: 47  }, open: { cores2: 60,  cores3: 50  } },
  { section: 16,  pipe: { cores2: 60,  cores3: 60  }, open: { cores2: 75,  cores3: 60  } },
  { section: 25,  pipe: { cores2: 85,  cores3: 75  }, open: { cores2: 105, cores3: 85  } },
  { section: 35,  pipe: { cores2: 100, cores3: 90  }, open: { cores2: 130, cores3: 100 } },
  { section: 50,  pipe: { cores2: 140, cores3: 120 }, open: { cores2: 165, cores3: 140 } },
]);

/**
 * Сводный справочник таблиц допустимых токов по материалу
 */
export const AMPACITY_TABLES = Object.freeze({
  Cu: AMPACITY_CU,
  Al: AMPACITY_AL,
});
