// Упрощённые инженерные расчёты для выбранного элемента: объём, масса, собственный вес,
// заданная нагрузка и — для балки — проверка однопролётной шарнирно опёртой балки с равномерной
// нагрузкой по формулам сопротивления материалов. Каждый результат содержит формулу, исходные
// данные, единицы и допущения. Это не расчёт здания по нормам.
(function (BS) {
  "use strict";
  const U = BS.util;
  const fmt = U.fmt;
  const g = 9.81; // м/с²

  /**
   * @param {object} project
   * @param {object} el
   * @param {{ liveLoad?: number, lineLoad?: number, allowStress?: number, deflectionLimit?: number }} opts
   *   liveLoad — пользовательская нагрузка на плиту, кПа; lineLoad — на балку, кН/м;
   *   allowStress — учебное допустимое напряжение, МПа; deflectionLimit — n в пределе прогиба L/n.
   * @returns {{ items: Array<{title, formula, inputs, result, unit, note?}>, beam?: object, assumptions: string[] }}
   */
  function forElement(project, el, opts = {}) {
    const mat = BS.materials.get(el.material);
    const vol = BS.shapes.volume(el, project);
    const items = [];
    const assumptions = [
      `Плотность материала «${mat.label}» — ${fmt(mat.density, 0)} кг/м³ (типичное справочное значение, может отличаться от реального).`,
      "Ускорение свободного падения g = 9,81 м/с².",
    ];
    items.push({
      title: "Объём", formula: vol.formula, inputs: sizeInputs(el), result: vol.value, unit: "м³",
      note: vol.approx ? "Оценка: форма упрощена" : null,
    });
    const mass = mat.density * vol.value;
    items.push({ title: "Масса", formula: "m = ρ·V", inputs: [["ρ", mat.density, "кг/м³"], ["V", vol.value, "м³"]], result: mass, unit: "кг" });
    const weight = (mass * g) / 1000;
    items.push({ title: "Собственный вес", formula: "G = m·g / 1000", inputs: [["m", mass, "кг"], ["g", g, "м/с²"]], result: weight, unit: "кН" });

    const t = BS.types.get(el.type) || {};
    let beam = null;
    if (["slab", "terrace", "landing", "balcony", "slab_foundation"].includes(el.type)) {
      const A = el.size.length * el.size.width;
      const q = opts.liveLoad ?? project.settings.loads.liveLoad;
      const Q = q * A;
      items.push({ title: "Заданная нагрузка на площадь", formula: "Q = q·A", inputs: [["q", q, "кПа"], ["A", A, "м²"]], result: Q, unit: "кН" });
      items.push({ title: "Суммарная нагрузка", formula: "N = G + Q", inputs: [["G", weight, "кН"], ["Q", Q, "кН"]], result: weight + Q, unit: "кН" });
      assumptions.push("Пользовательская нагрузка q задаётся вами (учебное значение), а не принимается по нормам.");
    }
    if (el.type === "beam" || el.type === "lintel") {
      beam = beamCheck(el, mat, opts);
      items.push(...beam.items);
      assumptions.push(...beam.assumptions);
    }
    if (t.shape === "wall") {
      const lam = el.size.height / el.size.thickness;
      items.push({ title: "Гибкость стены", formula: "λ = h / t", inputs: [["h", el.size.height, "м"], ["t", el.size.thickness, "м"]], result: lam, unit: "" });
    }
    return { items, beam, assumptions };
  }

  function sizeInputs(el) {
    return Object.entries(el.size || {}).map(([k, v]) => [k, v, "м"]);
  }

  /**
   * Однопролётная шарнирно опёртая балка, равномерная нагрузка q = собственный вес + заданная.
   * M = qL²/8, V = qL/2, W = bh²/6, I = bh³/12, σ = M/W, f = 5qL⁴/(384EI).
   */
  function beamCheck(el, mat, opts = {}) {
    const L = el.size.length, b = el.size.width, h = el.size.height;
    const selfLine = (mat.density * g * b * h) / 1000; // кН/м
    const qUser = opts.lineLoad ?? 5;
    const q = selfLine + qUser;
    const M = (q * L * L) / 8; // кН·м
    const V = (q * L) / 2; // кН
    const W = (b * h * h) / 6; // м³
    const I = (b * h ** 3) / 12; // м⁴
    const sigma = M / W / 1000; // МПа (кН/м² → МПа: /1000)
    const items = [
      { title: "Погонная нагрузка", formula: "q = ρ·g·b·h/1000 + qзад", inputs: [["ρ", mat.density, "кг/м³"], ["b", b, "м"], ["h", h, "м"], ["qзад", qUser, "кН/м"]], result: q, unit: "кН/м" },
      { title: "Изгибающий момент", formula: "M = q·L²/8", inputs: [["q", q, "кН/м"], ["L", L, "м"]], result: M, unit: "кН·м" },
      { title: "Поперечная сила", formula: "V = q·L/2", inputs: [["q", q, "кН/м"], ["L", L, "м"]], result: V, unit: "кН" },
      { title: "Момент сопротивления", formula: "W = b·h²/6", inputs: [["b", b, "м"], ["h", h, "м"]], result: W * 1e6, unit: "см³" },
      { title: "Напряжение при изгибе", formula: "σ = M/W", inputs: [["M", M, "кН·м"], ["W", W * 1e6, "см³"]], result: sigma, unit: "МПа" },
    ];
    const assumptions = [
      "Схема: однопролётная балка на двух шарнирных опорах, пролёт L равен длине элемента, нагрузка равномерная.",
      `Заданная погонная нагрузка qзад = ${fmt(qUser)} кН/м — учебное значение, задаётся вами.`,
      "Формулы сопротивления материалов для упругой стадии; не учитываются устойчивость, опорные зоны, коэффициенты надёжности и требования норм.",
    ];
    const result = { items, assumptions, M, V, sigma, verdicts: [] };
    const allow = opts.allowStress ?? mat.allowStress;
    if (allow) {
      const ok = sigma <= allow;
      items.push({ title: "Проверка напряжения", formula: "σ ≤ [σ]", inputs: [["σ", sigma, "МПа"], ["[σ]", allow, "МПа"]], result: sigma / allow, unit: "(использование)", verdict: ok });
      result.verdicts.push({ ok, text: ok ? `σ = ${fmt(sigma)} ≤ ${fmt(allow)} МПа` : `σ = ${fmt(sigma)} > ${fmt(allow)} МПа` });
      assumptions.push(`[σ] = ${fmt(allow)} МПа — учебное допустимое напряжение (задаётся пользователем), а не расчётное сопротивление по нормам.`);
    }
    if (mat.E) {
      const E = mat.E * 1e6; // ГПа → кН/м²
      const f = (5 * q * L ** 4) / (384 * E * I); // м
      const n = opts.deflectionLimit ?? 250;
      const ok = f <= L / n;
      items.push({ title: "Прогиб", formula: "f = 5·q·L⁴ / (384·E·I)", inputs: [["q", q, "кН/м"], ["L", L, "м"], ["E", mat.E, "ГПа"], ["I", I * 1e8, "см⁴"]], result: f * 1000, unit: "мм" });
      items.push({ title: "Проверка прогиба", formula: `f ≤ L/${n}`, inputs: [["f", f * 1000, "мм"], ["L/" + n, (L / n) * 1000, "мм"]], result: (f * n) / L, unit: "(использование)", verdict: ok });
      result.verdicts.push({ ok, text: ok ? `f = ${fmt(f * 1000, 1)} ≤ ${fmt((L / n) * 1000, 1)} мм` : `f = ${fmt(f * 1000, 1)} > ${fmt((L / n) * 1000, 1)} мм` });
      assumptions.push(`Модуль упругости E = ${fmt(mat.E)} ГПа — типичное значение для материала; предел прогиба L/${n} задаётся пользователем.`);
      result.f = f;
    } else {
      assumptions.push("Для материала не задан модуль упругости — прогиб не вычисляется.");
    }
    return result;
  }

  BS.calculations = { forElement, beamCheck, g };
})(globalThis.BuildSense);
