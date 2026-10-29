// Правая панель «Свойства»: параметры выбранного элемента, перемещение и поворот, действия,
// проблемы этого элемента и упрощённые расчёты.
(function (BS) {
  "use strict";
  const { el, numberField, selectField, textField, checkField, readonly, iconButton } = BS.dom;
  const fmt = BS.util.fmt;

  /**
   * state: { project, selectedIds, grid, validation, calcOpen }
   * h: onChange(id, patch), onMove(id, dx, dy, dz), onRotate(id, deg), onDuplicate(ids), onCopyToLevel(ids, levelId),
   *    onDelete(ids), onIsolate(ids), onFocus(ids), onAddOpening(type, wallId), onLintels(wallId), onSettings(patch), onSelect(id)
   */
  function render(root, state, h) {
    const ids = [...state.selectedIds];
    const project = state.project;
    if (!ids.length) return BS.dom.fill(root, summary(project, state.validation));
    if (ids.length > 1) {
      return BS.dom.fill(root, el("div", { class: "form" },
        el("h3", {}, `Выбрано объектов: ${ids.length}`),
        el("p", { class: "note" }, "Ctrl/Shift + щелчок в дереве добавляет объект к выбору."),
        actionsRow(project, ids, h)));
    }
    const e = project.elements.find((x) => x.id === ids[0]);
    if (!e) return BS.dom.fill(root, summary(project, state.validation));
    const t = BS.types.get(e.type);
    const parts = [];
    parts.push(el("h3", {}, t.label), readonly("Идентификатор", e.id));
    parts.push(textField({ label: "Название", value: e.name, onChange: (v) => h.onChange(e.id, { name: v || e.id }) }));
    if (t.categories) {
      parts.push(selectField({ label: "Категория", value: e.category, options: Object.entries(t.categories).map(([value, label]) => ({ value, label })), onChange: (v) => h.onChange(e.id, { category: v }) }));
    }
    if (t.materials.length > 1) {
      parts.push(selectField({ label: "Материал", value: e.material, options: t.materials.map((m) => ({ value: m, label: BS.materials.label(m) })), onChange: (v) => h.onChange(e.id, { material: v }) }));
    } else parts.push(readonly("Материал", BS.materials.label(e.material)));
    if (!e.hostId) {
      parts.push(selectField({ label: "Этаж", value: e.levelId, options: project.levels.map((l) => ({ value: l.id, label: l.name })), onChange: (v) => h.onChange(e.id, { levelId: v }) }));
    }
    for (const [path, def] of Object.entries((t.selects) || {})) {
      const [g, k] = path.split(".");
      parts.push(selectField({ label: def.label, value: e[g][k], options: Object.entries(def.options).map(([value, label]) => ({ value, label })), onChange: (v) => h.onChange(e.id, { [g]: { [k]: v } }) }));
    }
    for (const [path, label] of Object.entries((t.texts) || {})) {
      const [g, k] = path.split(".");
      parts.push(textField({ label, value: e[g][k], onChange: (v) => h.onChange(e.id, { [g]: { [k]: v } }) }));
    }
    for (const [path, label] of Object.entries((t.checks) || {})) {
      const [g, k] = path.split(".");
      parts.push(checkField({ label, value: e[g][k], onChange: (v) => h.onChange(e.id, { [g]: { [k]: v } }) }));
    }
    parts.push(el("hr", { class: "sep" }), el("h3", {}, "Размеры"));
    const prism = BS.shapes.isPrism(e);
    for (const [path, f] of Object.entries(t.fields)) {
      const [g, k] = path.split(".");
      if (prism && g === "size" && (k === "length" || k === "width")) continue; // габариты задаёт контур
      if (e.type === "roof" && k === "thickness" && e.params.roofType !== "flat") continue;
      if (e.type === "roof" && k === "slope" && e.params.roofType === "flat") continue;
      parts.push(numberField({ label: f.label, unit: f.unit, step: f.step, min: f.min, max: f.max, value: e[g][k],
        title: `Допустимо: ${fmt(f.min)}–${fmt(f.max)} ${f.unit}`, onChange: (v) => h.onChange(e.id, { [g]: { [k]: v } }) }));
    }
    if (prism) {
      parts.push(readonly("Контур", `${e.params.points.length} вершин, ${fmt(Math.abs(BS.geometry.polygonArea(e.params.points)), 2)} м²`));
      parts.push(readonly("Габариты", `${fmt(e.size.length)} × ${fmt(e.size.width)} м`));
    }
    if (e.type === "roof") parts.push(readonly("Высота подъёма", `${fmt(BS.shapes.roofRise(e))} м`));
    if (e.type === "room") parts.push(readonly("Площадь", `${fmt(e.size.length * e.size.width, 2)} м²`));
    if (t.shape === "opening") {
      const host = project.elements.find((w) => w.id === e.hostId);
      parts.push(selectField({ label: "Стена", value: e.hostId, options: project.elements.filter((w) => w.type === "wall").map((w) => ({ value: w.id, label: `${w.name}` })), onChange: (v) => h.onChange(e.id, { hostId: v }) }));
      if (host) parts.push(readonly("Площадь проёма", `${fmt(e.size.width * e.size.height, 2)} м²`));
    } else {
      parts.push(el("hr", { class: "sep" }), el("h3", {}, "Положение"), xyz(e, h, state.grid));
      parts.push(numberField({ label: "Поворот вокруг Z", unit: "°", step: 5, value: e.rotation || 0, onChange: (v) => h.onChange(e.id, { rotation: v }) }));
      parts.push(el("div", { class: "nudge" },
        iconButton("rotate", "−90°", () => h.onRotate(e.id, -90)), iconButton("rotate", "+90°", () => h.onRotate(e.id, 90))));
      parts.push(readonly("Низ / верх", `${fmt(BS.shapes.bottom(e, project))} / ${fmt(BS.shapes.top(e, project))} м`));
    }
    if (e.params && e.params.contourId) {
      parts.push(el("p", { class: "note" }, `Построено по контуру плана ${e.params.contourId}. Толщина и высота применяются ко всему контуру: соседние стены, пол и крыша перестраиваются. Форму меняйте на 2D-плане.`));
    } else if (e.shell) parts.push(el("p", { class: "note" }, "Элемент стартового дома."));

    parts.push(el("hr", { class: "sep" }), actionsRow(project, [e.id], h));
    if (e.type === "wall") {
      parts.push(el("div", { class: "row-actions" },
        iconButton("window", "Окно", () => h.onAddOpening("window", e.id)),
        iconButton("door", "Дверь", () => h.onAddOpening("door", e.id)),
        iconButton("beam", "Перемычки", () => h.onLintels(e.id), { title: "Перемычки над проёмами этой стены" })));
    }
    if (e.hostId) parts.push(el("div", { class: "row-actions" }, el("button", { type: "button", onclick: () => h.onSelect(e.hostId) }, "Перейти к стене")));

    // Проблемы элемента
    const own = (state.validation ? state.validation.issues : []).filter((i) => i.severity !== "pass" && (i.elementIds || []).includes(e.id));
    parts.push(el("hr", { class: "sep" }), el("h3", {}, `Проблемы элемента (${own.length})`));
    parts.push(own.length ? el("div", {}, own.map((i) => el("div", { class: `issue ${i.severity}` },
      el("header", {}, el("strong", {}, i.title), el("span", { class: `badge ${i.severity}` }, BS.validation.SEVERITY[i.severity])),
      el("p", {}, i.description || "")))) : el("p", { class: "note" }, "Для этого элемента проблем не найдено."));

    // Расчёт
    parts.push(calcBlock(project, e, state, h));
    BS.dom.fill(root, el("div", { class: "form" }, parts));
  }

  function xyz(e, h, grid) {
    const box = el("div", { class: "xyz" });
    for (const k of ["x", "y", "z"]) {
      const input = el("input", { type: "number", step: grid, value: BS.dom.fmtNum(e.position[k]),
        onchange: () => { const v = Number(input.value); if (Number.isFinite(v)) h.onChange(e.id, { position: { [k]: v } }); } });
      box.append(el("label", {}, k.toUpperCase(), input));
    }
    const nudges = el("div", { class: "nudge" });
    for (const [label, dx, dy, dz] of [["X−", -1, 0, 0], ["X+", 1, 0, 0], ["Y−", 0, -1, 0], ["Y+", 0, 1, 0], ["Z−", 0, 0, -1], ["Z+", 0, 0, 1]]) {
      nudges.append(el("button", { type: "button", title: `Сдвиг на шаг сетки (${fmt(grid)} м)`, onclick: () => h.onMove(e.id, dx * grid, dy * grid, dz * grid) }, label));
    }
    return el("div", {}, box, nudges);
  }

  function actionsRow(project, ids, h) {
    const lvSel = el("select", { title: "Этаж для копии" }, project.levels.map((l) => el("option", { value: l.id }, l.name)));
    return el("div", {},
      el("div", { class: "row-actions" },
        iconButton("copy", "Дублировать", () => h.onDuplicate(ids), { title: "Копия рядом (Ctrl+D)" }),
        iconButton("eye", "Изолировать", () => h.onIsolate(ids), { title: "Показать только выбранное (I)" }),
        iconButton("fit", "Показать", () => h.onFocus(ids)),
        iconButton("trash", "Удалить", () => h.onDelete(ids), { class: "danger", title: "Удалить (Del)" })),
      el("div", { class: "row-actions" }, lvSel, el("button", { type: "button", onclick: () => h.onCopyToLevel(ids, lvSel.value) }, "Копировать на этаж")));
  }

  function calcBlock(project, e, state, h) {
    const det = el("details", { class: "more", open: state.calcOpen }, el("summary", {}, "Расчёт (упрощённый)"));
    det.addEventListener("toggle", () => { state.calcOpen = det.open; });
    const res = BS.calculations.forElement(project, e, {
      liveLoad: project.settings.loads.liveLoad, lineLoad: project.settings.loads.lineLoad ?? 5,
      allowStress: e.params && e.params.allowStress, deflectionLimit: project.settings.loads.deflectionLimit ?? 250,
    });
    const rows = res.items.map((it) => el("tr", {},
      el("td", {}, el("div", {}, it.title), el("div", { class: "f" }, it.formula),
        el("div", { class: "f" }, it.inputs.map(([n, v, u]) => `${n} = ${fmt(v, 3)} ${u}`).join("; ")),
        it.note ? el("div", { class: "f" }, it.note) : null),
      el("td", { class: it.verdict === undefined ? "" : it.verdict ? "ok" : "bad" },
        it.verdict === undefined ? `${fmt(it.result, 3)} ${it.unit}` : `${it.verdict ? "✓" : "✗"} ${fmt(it.result, 2)}`)));
    det.append(el("table", { class: "calc" }, rows));
    if (e.type === "beam" || e.type === "lintel") {
      det.append(numberField({ label: "Заданная нагрузка на балку", unit: "кН/м", step: 0.5, value: project.settings.loads.lineLoad ?? 5, onChange: (v) => h.onSettings({ loads: { lineLoad: v } }) }));
      det.append(numberField({ label: "Учебное допустимое напряжение", unit: "МПа", step: 1, value: (e.params && e.params.allowStress) ?? BS.materials.get(e.material).allowStress ?? 0, onChange: (v) => h.onChange(e.id, { params: { allowStress: v } }) }));
    }
    if (["slab", "terrace", "landing", "balcony", "slab_foundation"].includes(e.type)) {
      det.append(numberField({ label: "Пользовательская нагрузка", unit: "кПа", step: 0.5, value: project.settings.loads.liveLoad, onChange: (v) => h.onSettings({ loads: { liveLoad: v } }) }));
    }
    det.append(el("p", { class: "note" }, "Допущения:"), el("ul", { class: "note" }, res.assumptions.map((a) => el("li", {}, a))));
    det.append(el("p", { class: "note" }, "Это не расчёт здания: вывод о безопасности реального дома требует полной инженерной модели, применимых норм и проверки специалистом."));
    return det;
  }

  function summary(project, validation) {
    const count = (g) => project.elements.filter((e) => (BS.types.get(e.type) || {}).group === g).length;
    return el("div", { class: "form" },
      el("h3", {}, "Проект"),
      el("p", { class: "note" }, "Объект не выбран. Щёлкните элемент в 3D-сцене или в дереве."),
      ...Object.entries(BS.types.GROUPS).filter(([g, d]) => !d.hidden || count(g)).map(([g, d]) => readonly(d.label, count(g))),
      readonly("Этажей", project.levels.length),
      el("hr", { class: "sep" }),
      el("h3", {}, "Как читать проверки"),
      el("div", { class: "legend-box" },
        el("p", {}, el("b", {}, "Геометрическая ошибка"), " — модель построена неверно: нулевые размеры, зазор между стеной и опорой, проём за пределами стены, пересечения. Это можно точно проверить по геометрии."),
        el("p", {}, el("b", {}, "Потенциальная конструктивная проблема"), " — эвристика: «элемент не опирается», «большой пролёт», «тонкая стена». Алгоритм не доказывает разрушение — требуется инженерная проверка."),
        el("p", {}, el("b", {}, "Нормы и правила"), " — пункты документов (статус «сверено») и ваши учебные ограничения. Непроверенные значения показываются как информация.")),
      validation ? readonly("Итог проверок", `ошибки ${validation.summary.error} · предупр. ${validation.summary.warning} · инфо ${validation.summary.info}`) : null);
  }

  BS.ui = BS.ui || {};
  BS.ui.properties = { render };
})(globalThis.BuildSense);
