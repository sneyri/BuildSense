// Левая панель «Объекты»: этажи и палитра типов по группам (постепенное раскрытие).
(function (BS) {
  "use strict";
  const { el, iconButton } = BS.dom;
  const OPEN_BY_DEFAULT = new Set(["foundation", "structure", "modules", "roof"]);
  const opened = new Set(OPEN_BY_DEFAULT);

  /**
   * handlers: onTool(type), onAction(name), onLevel(id), onAddLevel()
   * state: { project, activeTool, levelId }
   */
  function render(paletteNode, levelsNode, state, handlers) {
    // Этажи
    const levels = state.project.levels.slice().sort((a, b) => a.elevation - b.elevation);
    levelsNode.replaceChildren(
      el("span", { class: "note", style: "margin:0 4px 0 0" }, "Этаж:"),
      ...levels.map((l) => el("button", {
        type: "button", class: l.id === state.levelId ? "active" : null,
        title: `${l.name}: отметка пола ${BS.util.fmt(l.elevation)} м, высота ${BS.util.fmt(l.height)} м`,
        onclick: () => handlers.onLevel(l.id),
      }, l.name)),
      iconButton("plus", "Этаж", () => handlers.onAddLevel(), { title: "Добавить этаж: перекрытие и копия наружных стен" })
    );

    const groups = BS.types.byGroup();
    const nodes = Object.entries(BS.types.GROUPS).sort((a, b) => a[1].order - b[1].order).map(([gid, g]) => {
      const types = groups[gid] || [];
      const det = el("details", { open: opened.has(gid), ontoggle: () => (det.open ? opened.add(gid) : opened.delete(gid)) },
        el("summary", {}, g.label));
      const grid = el("div", { class: "grid" }, types.map((t) => {
        const b = iconButton(t.icon, t.label, () => handlers.onTool(t.id), {
          title: `${t.label}. ${t.hint || ""}`,
          class: state.activeTool === t.id ? "active" : null,
        });
        return b;
      }));
      det.append(grid);
      const actions = [];
      if (gid === "roof") actions.push(iconButton("roof", "Крыша над домом", () => handlers.onAction("roof-over"), { title: "Крыша по контуру наружных стен верхнего этажа" }));
      if (gid === "structure") actions.push(iconButton("beam", "Перемычки над проёмами", () => handlers.onAction("lintels"), { title: "Для выбранной стены (или всех несущих стен)" }));
      if (actions.length) det.append(el("div", { class: "actions" }, actions));
      return det;
    });
    const modOpen = opened.has("modules");
    const mod = el("details", { open: modOpen, ontoggle: () => (mod.open ? opened.add("modules") : opened.delete("modules")) },
      el("summary", {}, "Модульные узлы (ГОСТ)"),
      el("div", { class: "grid" }, BS.modules.NODES.map((n) => iconButton(n.icon, n.label, () => handlers.onNode(n.id), {
        title: `${n.label}: ${n.standard} «${n.standardTitle}». Строится как «${BS.types.label(n.base)}». ${BS.modules.NOT_VERIFIED}`,
        class: state.activeNode === n.id ? "active" : null,
      }))),
      el("p", { class: "note" }, `Планируются: ${BS.modules.PLANNED.map((p) => `${p.label.toLowerCase()} (${p.standard})`).join(", ")}.`));
    paletteNode.replaceChildren(
      el("p", { class: "note" }, "Выберите объект и постройте его мышью в 3D-сцене. Подсказка о действиях появится над сценой."),
      ...nodes.slice(0, 2), mod, ...nodes.slice(2)
    );
  }

  BS.ui = BS.ui || {};
  BS.ui.palette = { render };
})(globalThis.BuildSense);
