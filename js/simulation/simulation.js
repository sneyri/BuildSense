// Демонстрационная симуляция разрушения.
// Модель детерминированная и объяснимая (никаких случайных чисел):
//   1) задаётся начальный отказ по сценарию;
//   2) отказ распространяется по графу опирания волнами: элемент отказывает, если у него не осталось
//      опор или доля оставшегося опирания меньше порога; при частичной потере опор он «повреждён»;
//   3) для каждого отказавшего элемента вычисляется наглядное движение: высокие элементы опрокидываются,
//      плоские — проседают с поворотом вокруг уцелевшей опоры, остальные — опускаются.
// Это иллюстрация заданного сценария, а НЕ расчёт прочности или устойчивости.
(function (BS) {
  "use strict";
  const S = BS.shapes;
  const G = BS.geometry;
  const U = BS.util;
  const fmt = U.fmt;

  const DISCLAIMER = "Демонстрационная симуляция иллюстрирует заданный сценарий и не является инженерным расчётом прочности, устойчивости или безопасности здания.";

  const SCENARIOS = {
    remove_support: {
      label: "Отказ опоры", target: "bearing",
      hint: "Выбранный несущий элемент (колонна, стена, опора) условно перестаёт работать. Смотрим, что держалось на нём.",
    },
    slab_overload: {
      label: "Перегрузка перекрытия", target: "slab",
      hint: "К выбранному перекрытию прикладывается заданная нагрузка и сравнивается с условной несущей способностью.",
    },
    wall_buckling: {
      label: "Потеря устойчивости стены", target: "wall",
      hint: "Выбранная стена (или самая гибкая) условно теряет устойчивость и опрокидывается.",
    },
    cascade: {
      label: "Каскадный отказ", target: "any",
      hint: "Отказ выбранного элемента и цепочка отказов соседей при пороге опирания, который вы задаёте.",
    },
    lateral: {
      label: "Боковое воздействие", target: "none",
      hint: "Условная горизонтальная сила (например, ветер). Опрокидываются элементы с низким индексом устойчивости.",
    },
  };

  const TALL_TYPES = ["wall", "column", "round_column", "chimney", "pad_foundation"];

  /**
   * Запуск сценария. Проект не изменяется.
   * options: { targetId, load (кПа), threshold (0..1), intensity (0..1.5), direction (градусы) }
   * @returns {{ ok, error?, steps, failed, damaged, report: string[], assumptions: string[] }}
   */
  function run(project, scenarioId, options = {}) {
    const sc = SCENARIOS[scenarioId];
    if (!sc) return { ok: false, error: `Неизвестный сценарий: ${scenarioId}` };
    const graph = BS.loadGraph.build(project);
    const threshold = options.threshold ?? 0.5;
    const report = [];
    const assumptions = [
      `Отказ передаётся по графу опирания: элемент отказывает, если у него не осталось опор или доля оставшегося опирания меньше ${Math.round(threshold * 100)} %.`,
      "При частичной потере опор элемент отмечается как повреждённый (оранжевый), но остаётся на месте.",
      "Движение элементов на экране — наглядная иллюстрация, а не расчёт деформаций.",
    ];
    const byId = (id) => project.elements.find((e) => e.id === id);

    let initial = [];
    let impact = {};
    if (scenarioId === "lateral") {
      const k = options.intensity ?? 1;
      const dir = options.direction ?? 0;
      impact = { type: "lateral", direction: dir, intensity: k };
      assumptions.push("Условный индекс устойчивости R = (t / h) · (1 + n), где t — толщина (меньший размер сечения), h — высота, n — число примыкающих стен.");
      assumptions.push(`Элемент опрокидывается при R < 0,1 · k, где k = ${fmt(k)} — интенсивность воздействия (безразмерная, задаётся вами).`);
      for (const el of project.elements.filter((e) => TALL_TYPES.includes(e.type) && !BS.types.isFoundation(e))) {
        const R = stabilityIndex(project, el);
        if (R < 0.1 * k) {
          initial.push(el.id);
          report.push(`${el.name}: R = ${fmt(R, 3)} < ${fmt(0.1 * k, 3)} — опрокидывается.`);
        }
      }
      if (!initial.length) report.push(`Ни один элемент не имеет R < ${fmt(0.1 * k, 3)}: при заданной интенсивности опрокидывания нет.`);
    } else {
      let target = options.targetId ? byId(options.targetId) : null;
      if (scenarioId === "wall_buckling" && (!target || target.type !== "wall")) {
        target = project.elements.filter((e) => e.type === "wall").sort((a, b) => b.size.height / b.size.thickness - a.size.height / a.size.thickness)[0];
        if (target) report.push(`Стена не выбрана — взята самая гибкая: ${target.name} (h/t = ${fmt(target.size.height / target.size.thickness, 1)}).`);
      }
      if (scenarioId === "slab_overload" && (!target || target.type !== "slab")) {
        target = project.elements.filter((e) => e.type === "slab").sort((a, b) => b.size.length * b.size.width - a.size.length * a.size.width)[0];
        if (target) report.push(`Перекрытие не выбрано — взято самое большое: ${target.name}.`);
      }
      if (!target) return { ok: false, error: sc.target === "none" ? "Нет элементов для сценария" : "Выберите элемент в модели для этого сценария" };
      if (scenarioId === "remove_support" && !BS.types.isBearing(target) && !BS.types.isFoundation(target)) {
        return { ok: false, error: `«${target.name}» не несущий элемент. Выберите колонну, стену, балку или опору.` };
      }
      impact = { type: scenarioId, targetId: target.id };
      if (scenarioId === "slab_overload") {
        const res = slabCheck(project, target, options.load ?? project.settings.loads.liveLoad);
        report.push(...res.lines);
        assumptions.push(...res.assumptions);
        if (res.fails) initial = [target.id];
        else impact.withstands = true;
      } else {
        initial = [target.id];
        report.push(`Начальный отказ: ${target.name}.`);
      }
    }

    // Распространение отказа волнами
    const failed = new Set(initial);
    const waves = initial.length ? [initial] : [];
    const damaged = new Set();
    for (let guard = 0; guard < 50; guard++) {
      const wave = [];
      for (const [id, node] of graph) {
        if (failed.has(id) || node.grounded || !node.supports.size) continue;
        const { total, left } = BS.loadGraph.remainingSupport(node, failed);
        if (left >= total - 1e-9) continue;
        if (left <= 1e-9 || left / total < threshold) wave.push(id);
        else damaged.add(id);
      }
      if (!wave.length) break;
      wave.forEach((id) => { failed.add(id); damaged.delete(id); });
      waves.push(wave);
    }
    if (impact.type === "slab_overload" && impact.withstands) {
      const t = byId(impact.targetId);
      const res = slabCheck(project, t, options.load ?? project.settings.loads.liveLoad);
      if (res.ratio > 0.8) damaged.add(t.id);
    }

    // Движения
    const motions = {};
    for (const id of failed) {
      const el = byId(id);
      if (!el) continue;
      motions[id] = motionFor(project, graph, el, failed, impact);
    }

    // Шаги для показа
    const steps = [];
    steps.push({ title: "Исходное состояние", description: "Модель до воздействия.", failed: [], newly: [], damaged: [], impact: null, motions: {} });
    steps.push({ title: `Воздействие: ${sc.label.toLowerCase()}`, description: impactText(project, impact, options), failed: [], newly: [],
      damaged: [], impact, highlight: impact.targetId ? [impact.targetId] : initial, motions: {} });
    const cumulative = new Set();
    waves.forEach((wave, i) => {
      wave.forEach((id) => cumulative.add(id));
      const names = wave.map((id) => (byId(id) || {}).name).filter(Boolean);
      steps.push({
        title: i === 0 ? "Начальный отказ" : `Волна отказов ${i}`,
        description: `${i === 0 ? "Отказ" : "Потеряли опору"}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ` и ещё ${names.length - 8}` : ""}.`,
        failed: [...cumulative], newly: wave, damaged: i === waves.length - 1 ? [...damaged] : [], impact,
        motions: Object.fromEntries([...cumulative].map((id) => [id, motions[id]]).filter(([, m]) => m)),
      });
    });
    const solidCount = project.elements.filter((e) => !(BS.types.get(e.type) || {}).nonSolid).length;
    steps.push({
      title: "Итоговое состояние",
      description: failed.size
        ? `Отказали ${failed.size} из ${solidCount} элементов, повреждены (частично потеряли опору) ${damaged.size}.`
        : "Отказов нет: заданное воздействие не нарушило схему опирания.",
      failed: [...failed], newly: [], damaged: [...damaged], impact, final: true,
      motions: Object.fromEntries([...failed].map((id) => [id, motions[id]]).filter(([, m]) => m)),
    });
    report.push(steps[steps.length - 1].description);
    return { ok: true, scenario: scenarioId, steps, failed: [...failed], damaged: [...damaged], report, assumptions, disclaimer: DISCLAIMER };
  }

  /** Условный индекс устойчивости R = (t/h)·(1+n). */
  function stabilityIndex(project, el) {
    const s = el.size;
    const h = s.height;
    const t = el.type === "wall" ? s.thickness : el.type === "round_column" ? s.diameter : Math.min(s.length, s.width);
    let n = 0;
    if (el.type === "wall") {
      const fp = S.footprint(el, project);
      n = project.elements.filter((o) => o.type === "wall" && o.id !== el.id &&
        Math.min(S.top(o, project), S.top(el, project)) - Math.max(S.bottom(o, project), S.bottom(el, project)) > 0.02 &&
        G.polygonDistance(fp, S.footprint(o, project)) <= 0.02).length;
    }
    return (t / h) * (1 + n);
  }

  /** Перекрытие под нагрузкой: q = qпольз + собственный вес; сравнение с условной несущей способностью. */
  function slabCheck(project, slab, liveLoad) {
    const mat = BS.materials.get(slab.material);
    const g = (mat.density * 9.81 * slab.size.height) / 1000; // кПа
    const q = liveLoad + g;
    const cap = project.settings.loads.slabCapacity;
    const ratio = q / cap;
    return {
      fails: q > cap, ratio,
      lines: [
        `Собственный вес: g = ρ·g·t = ${fmt(mat.density, 0)}·9,81·${fmt(slab.size.height)} / 1000 = ${fmt(g)} кПа.`,
        `Полная нагрузка: q = ${fmt(liveLoad)} + ${fmt(g)} = ${fmt(q)} кПа; условная несущая способность ${fmt(cap)} кПа.`,
        q > cap ? `q > ${fmt(cap)} кПа — перекрытие в сценарии отказывает.` : `q ≤ ${fmt(cap)} кПа — перекрытие в сценарии выдерживает (использование ${Math.round(ratio * 100)} %).`,
      ],
      assumptions: [
        "Несущая способность перекрытия — учебное значение из настроек проекта (кПа), а не результат расчёта по нормам.",
        "Нагрузка считается равномерно распределённой по всей площади перекрытия.",
      ],
    };
  }

  function impactText(project, impact, options) {
    if (impact.type === "lateral") return `Горизонтальное воздействие интенсивностью k = ${fmt(impact.intensity)}, направление ${fmt(impact.direction, 0)}°.`;
    const el = project.elements.find((e) => e.id === impact.targetId);
    if (impact.type === "slab_overload") return `Нагрузка ${fmt(options.load ?? project.settings.loads.liveLoad)} кПа на «${el.name}».`;
    if (impact.type === "wall_buckling") return `«${el.name}» теряет устойчивость.`;
    return `Отказ элемента «${el.name}».`;
  }

  /**
   * Наглядное движение отказавшего элемента:
   * { pivot: {x,y,z}, axis: {x,y,z}, angle: рад, dz: м } — поворот вокруг оси через pivot, затем опускание.
   */
  function motionFor(project, graph, el, failed, impact) {
    const t = BS.types.get(el.type) || {};
    if (t.support === "ground") return { pivot: { x: 0, y: 0, z: 0 }, axis: { x: 1, y: 0, z: 0 }, angle: 0, dz: -0.15 };
    const c = S.center(el, project);
    const z0 = S.bottom(el, project);
    const height = S.elementHeight(el);
    const ps = S.planSize(el) || [el.size.diameter || 0.3, el.size.diameter || 0.3];
    const below = BS.support.supportAt(project, c.x, c.y, { below: z0 - 0.05, excludeIds: [...failed] });
    const landing = below ? below.z : 0;
    const dz = Math.min(0, landing - z0);

    if (t.shape === "opening") return { pivot: { x: c.x, y: c.y, z: z0 }, axis: { x: 1, y: 0, z: 0 }, angle: 0, dz: 0, follow: el.hostId };
    if (el.params && el.params.hostWallId) return { pivot: { x: c.x, y: c.y, z: z0 }, axis: { x: 1, y: 0, z: 0 }, angle: 0, dz: 0, follow: el.params.hostWallId };

    // Направление падения: при боковом воздействии — по его направлению; иначе — от уцелевших опор,
    // а если их нет — наружу от стены (сторона v = 0) или по +X.
    let dir;
    if (impact.type === "lateral") {
      dir = { x: Math.cos(impact.direction * G.DEG), y: Math.sin(impact.direction * G.DEG) };
    } else {
      const node = graph.get(el.id);
      const alive = node ? [...node.supports.keys()].filter((id) => !failed.has(id)) : [];
      if (alive.length) {
        const ac = alive.map((id) => S.center(project.elements.find((e) => e.id === id), project));
        const mx = ac.reduce((s, p) => s + p.x, 0) / ac.length, my = ac.reduce((s, p) => s + p.y, 0) / ac.length;
        const len = Math.hypot(c.x - mx, c.y - my) || 1;
        dir = { x: (c.x - mx) / len, y: (c.y - my) / len };
      } else if (el.type === "wall") {
        const a = G.axes(el);
        dir = { x: -a.vx, y: -a.vy };
      } else {
        dir = { x: 1, y: 0 };
      }
    }
    const axis = { x: -dir.y, y: dir.x, z: 0 }; // горизонтальная ось, перпендикулярная направлению падения
    // Стены и колонны опрокидываются вокруг нижнего ребра: высота сравнивается с толщиной (меньшим размером)
    const tall = height > Math.min(ps[0], ps[1]) * 1.2 && TALL_TYPES.includes(el.type);
    if (tall) {
      // Опрокидывание вокруг нижнего ребра на стороне падения
      const half = el.type === "wall" ? el.size.thickness / 2 : Math.min(ps[0], ps[1]) / 2;
      const pivot = { x: c.x + dir.x * half, y: c.y + dir.y * half, z: z0 + dz };
      return { pivot, axis, angle: (75 * Math.PI) / 180, dz };
    }
    // Плоские и прочие: проседание с поворотом вокруг стороны уцелевшей опоры
    const span = Math.max(ps[0], ps[1]);
    const angle = Math.min((15 * Math.PI) / 180, Math.atan2(Math.min(-dz, 1.5), span || 1));
    const pivot = { x: c.x - (dir.x * span) / 2, y: c.y - (dir.y * span) / 2, z: z0 };
    return { pivot, axis, angle: dz < -0.01 ? angle : 0, dz };
  }

  BS.simulation = { DISCLAIMER, SCENARIOS, run, stabilityIndex, slabCheck };
})(globalThis.BuildSense);
