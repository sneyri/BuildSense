// Левая панель: дерево элементов модели (стены с вложенными окнами и дверями).
import { materialColor, typeLabel } from "../model/catalog.js";
import { el } from "./dom.js";

const ORDER = ["foundation", "wall", "floor", "roof"];

export function renderElementList(list, countNode, project, selectedId, onSelect) {
  const items = [];
  const byType = (type) => project.elements.filter((e) => e.type === type);
  const row = (element, child = false) =>
    el("li", {
      class: [child ? "child" : "", element.id === selectedId ? "selected" : ""].join(" ").trim() || null,
      title: `${typeLabel(element.type)} · ${element.id}`,
      onclick: () => onSelect(element.id),
    },
      el("span", { class: "swatch", style: `background:${materialColor(element.material)}` }),
      el("span", { class: "el-name" }, element.name || element.id),
      el("span", { class: "el-id" }, element.id)
    );

  for (const type of ORDER) {
    for (const element of byType(type)) {
      items.push(row(element));
      if (type === "wall") {
        for (const o of project.elements.filter((e) => e.hostId === element.id)) items.push(row(o, true));
      }
    }
  }
  // Проёмы без существующей стены (например, после ручной правки JSON)
  for (const o of project.elements.filter((e) => e.hostId && !project.elements.some((w) => w.id === e.hostId))) {
    items.push(row(o));
  }

  list.replaceChildren(...(items.length ? items : [el("li", { class: "empty" }, "Элементов нет")]));
  countNode.textContent = String(project.elements.length);
}
