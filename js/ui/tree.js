// Левая панель «Дерево»: видимость категорий и иерархия Этаж → группа → элементы (проёмы — внутри стен).
(function (BS) {
  "use strict";
  const { el } = BS.dom;

  /**
   * state: { project, selectedIds:Set, issues: Map(id→severity), hiddenGroups:Set }
   * handlers: onSelect(id, additive), onFocus(id), onToggleGroup(group, visible)
   */
  // Сценарий «план → фундамент → стены → перекрытие → крыша» использует только эти категории.
  // Инженерия и мебель не входят в цели проекта: их переключатели видны, только если такие объекты
  // уже есть в проекте (старые файлы) или категория скрыта — чтобы её можно было снова показать.
  const CORE_GROUPS = new Set(["foundation", "structure", "roof", "architecture"]);

  function visibleGroups(state) {
    const present = new Set(state.project.elements.map((e) => (BS.types.get(e.type) || {}).group));
    return Object.entries(BS.types.GROUPS)
      .filter(([gid]) => CORE_GROUPS.has(gid) || present.has(gid) || state.hiddenGroups.has(gid))
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  }

  function render(visNode, treeNode, state, handlers) {
    visNode.replaceChildren(...visibleGroups(state).map(([gid, g]) => {
      const input = el("input", { type: "checkbox", checked: !state.hiddenGroups.has(gid), onchange: () => handlers.onToggleGroup(gid, input.checked) });
      return el("label", { title: `Показать / скрыть: ${g.label}` }, input, g.label);
    }));

    const project = state.project;
    const levels = project.levels.slice().sort((a, b) => a.elevation - b.elevation);
    const row = (e, extraClass = "") => {
      const t = BS.types.get(e.type) || {};
      const sev = state.issues.get(e.id);
      return el("div", {
        class: `row ${state.selectedIds.has(e.id) ? "selected" : ""} ${extraClass}`,
        title: `${t.label || e.type} · ${e.id}. Двойной щелчок — показать в 3D`,
        onclick: (ev) => handlers.onSelect(e.id, ev.ctrlKey || ev.metaKey || ev.shiftKey),
        ondblclick: () => handlers.onFocus(e.id),
      },
        el("span", { class: "sw", style: `background:${BS.materials.color(e.material)}` }),
        el("span", { class: "nm" }, e.name),
        sev ? el("span", { class: `dot ${sev}` }) : null,
        el("span", { class: "id" }, e.id));
    };
    const ul = el("ul");
    for (const lv of levels) {
      const items = project.elements.filter((e) => e.levelId === lv.id && !e.hostId);
      const li = el("li", {}, el("div", { class: "grp" }, `${lv.name} · ${BS.util.fmt(lv.elevation)} м · ${items.length} объектов`));
      const inner = el("ul");
      for (const [gid, g] of Object.entries(BS.types.GROUPS)) {
        const list = items.filter((e) => (BS.types.get(e.type) || {}).group === gid);
        if (!list.length) continue;
        const gli = el("li", {}, el("div", { class: "grp" }, g.label));
        const gul = el("ul");
        for (const e of list) {
          const eli = el("li", {}, row(e));
          const kids = project.elements.filter((o) => o.hostId === e.id || (o.params && o.params.hostWallId === e.id));
          if (kids.length) eli.append(el("ul", {}, kids.map((k) => el("li", {}, row(k)))));
          gul.append(eli);
        }
        gli.append(gul);
        inner.append(gli);
      }
      li.append(inner);
      ul.append(li);
    }
    const orphans = project.elements.filter((e) => e.hostId && !project.elements.some((w) => w.id === e.hostId));
    if (orphans.length) ul.append(el("li", {}, el("div", { class: "grp" }, "Без стены-основы"), el("ul", {}, orphans.map((o) => el("li", {}, row(o))))));
    treeNode.replaceChildren(project.elements.length ? ul : el("p", { class: "empty" }, "Проект пуст. Начертите контур на 2D-плане или поставьте фундамент; мастер проведёт по шагам."));
  }

  BS.ui = BS.ui || {};
  BS.ui.tree = { render };
})(globalThis.BuildSense);
