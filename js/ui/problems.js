// Правая панель «Проблемы»: результаты проверок с фильтрами по серьёзности и категории.
// Щелчок по сообщению наводит камеру на элемент и подсвечивает его.
(function (BS) {
  "use strict";
  const { el } = BS.dom;
  const V = () => BS.validation;
  const filters = { severity: new Set(["error", "warning", "info"]), category: "all" };

  /** h: onFocus(issue), onFix(action) */
  function render(root, validation, h) {
    if (!validation) return BS.dom.fill(root, el("p", { class: "empty" }, "Проверки ещё не выполнены."));
    const s = validation.summary;
    const chip = (sev, label) => el("button", {
      type: "button", class: `chip ${sev} ${filters.severity.has(sev) ? "" : "off"}`,
      title: "Показать / скрыть",
      onclick: () => { filters.severity.has(sev) ? filters.severity.delete(sev) : filters.severity.add(sev); render(root, validation, h); },
    }, `${label} ${s[sev]}`);
    const catSel = el("select", { onchange: () => { filters.category = catSel.value; render(root, validation, h); } },
      el("option", { value: "all" }, "Все категории"),
      Object.entries(V().CATEGORIES).map(([id, label]) => el("option", { value: id, selected: filters.category === id }, label)));

    const order = { error: 0, warning: 1, info: 2, pass: 3 };
    const list = validation.issues
      .filter((i) => filters.severity.has(i.severity) && (filters.category === "all" || i.category === filters.category))
      .sort((a, b) => order[a.severity] - order[b.severity]);

    const items = list.map((i) => el("article", {
      class: `issue ${i.severity}`,
      title: i.elementIds && i.elementIds.length ? "Показать элемент в 3D" : null,
      onclick: () => h.onFocus(i),
    },
      el("header", {}, el("strong", {}, i.title), el("span", { class: `badge ${i.severity}` }, V().SEVERITY[i.severity])),
      el("div", { class: "cat" }, `${V().CATEGORIES[i.category]} · ${i.checkId}`),
      i.description ? el("p", {}, i.description) : null,
      el("details", { onclick: (e) => e.stopPropagation() }, el("summary", { class: "cat" }, "Что проверить"), el("p", { class: "expl" }, i.explanation || "")),
      i.fix ? el("button", { type: "button", class: "primary", style: "margin-top:6px", onclick: (e) => { e.stopPropagation(); h.onFix(i.fix.action); } }, `Исправить: ${i.fix.label}`) : null));

    BS.dom.fill(root, 
      el("div", { class: "legend-box" },
        el("b", {}, "Красный"), " — ошибка, ", el("b", {}, "оранжевый"), " — предупреждение, ",
        el("b", {}, "синий"), " — информация, ", el("b", {}, "зелёный"), " — проверка пройдена. ",
        "Конструктивные результаты — это потенциальные проблемы: требуется инженерная проверка, а не вывод о разрушении."),
      el("div", { class: "filters" }, chip("error", "Ошибки"), chip("warning", "Предупр."), chip("info", "Инфо"), chip("pass", "Пройдено"), catSel),
      validation.ruleErrors.length ? el("div", { class: "issue error" }, el("strong", {}, "Ошибки в правилах (пропущены):"), el("p", {}, validation.ruleErrors.join("; "))) : null,
      ...(items.length ? items : [el("p", { class: "empty" }, "Нет сообщений с выбранными фильтрами.")])
    );
  }

  BS.ui = BS.ui || {};
  BS.ui.problems = { render, filters };
})(globalThis.BuildSense);
