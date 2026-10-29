// Правая панель «Симуляция»: выбор сценария, параметры, запуск и пошаговый просмотр.
(function (BS) {
  "use strict";
  const { el, numberField, selectField, iconButton } = BS.dom;
  const fmt = BS.util.fmt;

  /**
   * state: { project, selectedIds, sim: { scenario, params, result, step, ghost } }
   * h: onRun(), onStep(i), onPlay(), onReset(), onGhost(on), onParam(key, value), onScenario(id), onSelect(id)
   */
  function render(root, state, h) {
    const sim = state.sim;
    const sc = BS.simulation.SCENARIOS[sim.scenario];
    const sel = [...state.selectedIds][0];
    const target = sel && state.project.elements.find((e) => e.id === sel);
    const parts = [
      el("div", { class: "warnbox" }, BS.simulation.DISCLAIMER),
      el("h3", { style: "margin-top:12px" }, "Сценарий"),
      selectField({ label: "Воздействие", wide: true, value: sim.scenario,
        options: Object.entries(BS.simulation.SCENARIOS).map(([value, s]) => ({ value, label: s.label })), onChange: h.onScenario }),
      el("p", { class: "note" }, sc.hint),
    ];
    if (sc.target !== "none") {
      parts.push(el("p", { class: "note" }, target ? `Выбран элемент: «${target.name}».` : "Выберите элемент в 3D-сцене или в дереве (для «Устойчивости стены» и «Перегрузки» можно не выбирать — возьмётся подходящий)."));
    }
    if (sim.scenario === "slab_overload") {
      parts.push(numberField({ label: "Нагрузка на перекрытие", unit: "кПа", step: 0.5, value: sim.params.load ?? state.project.settings.loads.liveLoad, onChange: (v) => h.onParam("load", v) }));
      parts.push(numberField({ label: "Условная несущая способность", unit: "кПа", step: 0.5, value: state.project.settings.loads.slabCapacity, onChange: (v) => h.onParam("slabCapacity", v) }));
    }
    if (sim.scenario === "cascade" || sim.scenario === "remove_support") {
      parts.push(numberField({ label: "Порог опирания", unit: "%", step: 5, min: 5, max: 100, value: Math.round((sim.params.threshold ?? 0.5) * 100), onChange: (v) => h.onParam("threshold", Math.min(1, Math.max(0.05, v / 100))) }));
    }
    if (sim.scenario === "lateral") {
      parts.push(numberField({ label: "Интенсивность k", unit: "", step: 0.1, min: 0, max: 3, value: sim.params.intensity ?? 1, onChange: (v) => h.onParam("intensity", v) }));
      parts.push(numberField({ label: "Направление", unit: "°", step: 15, value: sim.params.direction ?? 0, onChange: (v) => h.onParam("direction", v) }));
    }
    parts.push(el("div", { class: "sim-controls" },
      iconButton("play", "Запустить", h.onRun, { class: "primary" }),
      iconButton("reset", "Восстановить исходное", h.onReset, { disabled: !sim.result })));

    if (sim.result && !sim.result.ok) parts.push(el("div", { class: "issue error" }, sim.result.error));
    if (sim.result && sim.result.ok) {
      const r = sim.result;
      parts.push(el("h3", {}, "Ход сценария"),
        el("ol", { class: "sim-steps" }, r.steps.map((s, i) => el("li", { class: i === sim.step ? "cur" : "", onclick: () => h.onStep(i) },
          el("strong", {}, s.title), el("div", { class: "note", style: "margin:2px 0 0" }, s.description)))),
        el("div", { class: "sim-controls" },
          iconButton("back", "Назад", () => h.onStep(sim.step - 1), { disabled: sim.step <= 0 }),
          iconButton("step", "Далее", () => h.onStep(sim.step + 1), { disabled: sim.step >= r.steps.length - 1 }),
          iconButton("play", "Проиграть", h.onPlay),
          el("label", { class: "note", style: "display:flex;gap:6px;align-items:center" },
            el("input", { type: "checkbox", checked: sim.ghost, onchange: (e) => h.onGhost(e.target.checked) }), "До / после (призрак)")),
        el("h3", {}, "Результат"),
        el("ul", { class: "note" }, r.report.map((x) => el("li", {}, x))),
        r.failed.length ? el("p", { class: "note" }, "Отказавшие элементы: ",
          ...r.failed.slice(0, 30).map((id) => el("button", { type: "button", style: "margin:2px;padding:1px 6px;font-size:11px", onclick: () => h.onSelect(id) }, id))) : null,
        el("h3", {}, "Допущения модели"),
        el("ul", { class: "note" }, r.assumptions.map((x) => el("li", {}, x))),
        el("p", { class: "note" }, `Цвета: красный — отказ, оранжевый — частичная потеря опоры, фиолетовый — место воздействия.`));
    }
    BS.dom.fill(root, ...parts);
  }

  BS.ui = BS.ui || {};
  BS.ui.simulationPanel = { render, fmt };
})(globalThis.BuildSense);
