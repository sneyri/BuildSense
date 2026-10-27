// Правая панель «Правила»: реестр правил, добавление пользовательского учебного правила,
// импорт правил из JSON и экспорт пользовательских правил.
(function (BS) {
  "use strict";
  const { el, selectField, textField, iconButton } = BS.dom;
  const C = () => BS.checker;
  const form = { title: "", parameter: "wall.thickness", operator: ">=", value: "0.3", description: "" };

  /** h: onAddRule(form), onDeleteRule(id), onImport(), onExport() */
  function render(root, project, validation, h) {
    const { rules, errors } = BS.ruleRegistry.all(project);
    const units = BS.metrics.units();
    const param = BS.metrics.PARAMETERS[form.parameter] || {};
    const statusBadge = (st) => {
      const cls = { verified: "pass", user: "warning", unverified: "info", demo: "info" }[st] || "info";
      const label = { verified: "сверено", user: "учебное ограничение", unverified: "требует проверки", demo: "демо" }[st] || st;
      return el("span", { class: `badge ${cls}` }, label);
    };
    const list = rules.map((r) => el("article", { class: "issue", style: "cursor:default" },
      el("header", {}, el("strong", {}, r.title || r.id), statusBadge(r.verification.status)),
      el("div", { class: "cat" }, `${r.document.id}${r.clause && r.clause !== "—" ? `, п. ${r.clause}` : ""} · ${r.id}`),
      el("p", {}, `${(BS.metrics.PARAMETERS[r.parameter] || {}).label || r.parameter} ${C().OPERATORS[r.operator] || r.operator} ${Array.isArray(r.value) ? r.value.join("…") : r.value} ${r.unit || ""}`),
      el("details", {}, el("summary", { class: "cat" }, "Подробнее"),
        el("p", { class: "expl" }, r.requirement),
        el("p", {}, `Применимость: ${(r.applicability && r.applicability.description) || "весь проект"}`),
        el("p", {}, `Источник: ${r.source.title}${r.source.url ? ` — ${r.source.url}` : ""}`),
        r.verification.note ? el("p", {}, `Статус: ${r.verification.note}`) : null),
      r.builtin ? null : el("button", { type: "button", class: "danger", style: "margin-top:6px", onclick: () => h.onDeleteRule(r.id) }, "Удалить правило")));

    const paramSel = selectField({
      label: "Параметр", wide: true, value: form.parameter,
      options: Object.entries(BS.metrics.PARAMETERS).filter(([, p]) => p.unit).map(([value, p]) => ({ value, label: `${p.label} (${value})` })),
      onChange: (v) => { form.parameter = v; render(root, project, validation, h); },
    });
    BS.dom.fill(root, 
      el("div", { class: "legend-box" },
        "Официальные нормы добавляются только со статусом «сверено» после проверки по тексту действующей редакции. ",
        "Правила, созданные здесь, — ", el("b", {}, "пользовательские учебные ограничения"), ", а не нормы: в проверке они помечаются отдельно."),
      el("h3", {}, "Новое учебное правило"),
      el("div", { class: "form card" },
        textField({ label: "Название", value: form.title, onChange: (v) => { form.title = v; } }),
        paramSel,
        selectField({ label: "Условие", value: form.operator, options: Object.entries(C().OPERATORS).filter(([k]) => !["in", "not_in"].includes(k)).map(([value, label]) => ({ value, label })), onChange: (v) => { form.operator = v; } }),
        textField({ label: `Значение (${unitText(units[form.parameter])}${form.operator === "between" ? "; два числа через ;" : ""})`, value: form.value, onChange: (v) => { form.value = v; } }),
        textField({ label: "Описание (что требуется и почему)", value: form.description, onChange: (v) => { form.description = v; } }),
        el("p", { class: "note" }, param.note || ""),
        iconButton("plus", "Добавить правило", () => h.onAddRule({ ...form, unit: units[form.parameter], elementType: elementTypeFor(form.parameter) }), { class: "primary" })),
      el("div", { class: "row-actions" },
        iconButton("open", "Импорт правил (JSON)", h.onImport),
        iconButton("save", "Экспорт моих правил", h.onExport, { disabled: !(project.customRules || []).length })),
      errors.length ? el("div", { class: "issue error" }, el("strong", {}, "Правила с ошибками (не применяются)"), el("p", {}, errors.join("; "))) : null,
      el("h3", {}, `Реестр правил (${rules.length})`),
      ...list);
  }

  function unitText(u) {
    return { m: "м", m2: "м²", deg: "°", ratio: "доля", count: "шт" }[u] || u || "";
  }

  /** Тип элемента, к которому относится параметр (wall.thickness → wall). */
  function elementTypeFor(parameter) {
    const prefix = parameter.split(".")[0];
    const map = { wall: "wall", column: "column", beam: "beam", slab: "slab", roof: "roof", window: "window", door: "door", stairs: "stairs", railing: "railing", room: "room", foundation: "slab_foundation" };
    return map[prefix] || undefined;
  }

  BS.ui = BS.ui || {};
  BS.ui.rulesPanel = { render, form };
})(globalThis.BuildSense);
